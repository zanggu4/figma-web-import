import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureDir,
  getOutputDir,
  getOutputPaths,
  loadCase,
  loadEnvFiles,
  parseArgs,
  requiredEnv,
  writeJson,
} from './common.mjs';

async function fetchJson(url, token, label) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'X-Figma-Token': token,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} request failed: ${reason}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} failed (${response.status}): ${body}`);
  }

  return response.json();
}

function collectExportableNodes(node, nodes) {
  if (!node || typeof node !== 'object') {
    return;
  }

  const exportableTypes = new Set([
    'FRAME',
    'GROUP',
    'SECTION',
    'COMPONENT',
    'COMPONENT_SET',
    'INSTANCE',
  ]);

  if (node.id && typeof node.name === 'string' && exportableTypes.has(node.type)) {
    nodes.push({
      id: node.id,
      name: node.name,
      type: node.type || 'UNKNOWN',
    });
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectExportableNodes(child, nodes);
    }
  }
}

function normalizeNodeId(input) {
  if (!input) return '';
  let raw = String(input).trim();
  if (!raw) return '';

  // Accept full Figma URL as input.
  if (raw.includes('figma.com/')) {
    try {
      const parsed = new URL(raw);
      const fromQuery = parsed.searchParams.get('node-id');
      if (fromQuery) {
        raw = fromQuery;
      }
    } catch {
      // Keep raw input if URL parsing fails.
    }
  }

  // Sometimes the node-id may include extra params after copy/paste.
  raw = raw.split('&')[0].split('?')[0].trim();

  // Figma URL uses hyphen separator (e.g. 41-2), API expects colon (41:2).
  if (/^\d+-\d+$/.test(raw)) {
    raw = raw.replace('-', ':');
  }

  return raw;
}

function describeImagePayload(payload, requestedNodeId) {
  const err = payload?.err ? ` err=${payload.err}` : '';
  const imageMap = payload?.images && typeof payload.images === 'object' ? payload.images : {};
  const keys = Object.keys(imageMap);
  const hasRequestedKey = keys.includes(requestedNodeId);
  const requestedValue = hasRequestedKey ? imageMap[requestedNodeId] : undefined;
  return `requestedNodeId=${requestedNodeId}, images.keys=[${keys.join(', ')}], requestedValue=${requestedValue ?? 'undefined'}${err}`;
}

function buildImagesApiUrl(fileKey, nodeId, scale) {
  const url = new URL(`https://api.figma.com/v1/images/${fileKey}`);
  url.searchParams.set('ids', nodeId);
  url.searchParams.set('format', 'png');
  url.searchParams.set('scale', String(scale));
  url.searchParams.set('use_absolute_bounds', 'true');
  return url;
}

async function fetchImageUrlForNode(config, nodeId) {
  const url = buildImagesApiUrl(config.fileKey, nodeId, config.scale);
  const payload = await fetchJson(url, config.token, 'Figma images API');
  const imageUrl = payload?.images?.[nodeId] || Object.values(payload?.images || {})[0];
  return { payload, imageUrl };
}

async function resolveNodeIdByFrameName(config) {
  const url = new URL(`https://api.figma.com/v1/files/${config.fileKey}`);
  url.searchParams.set('depth', String(config.fileDepth));

  const payload = await fetchJson(url, config.token, 'Figma files API');
  const pages = (payload?.document?.children || []).filter((n) => n.type === 'CANVAS');

  const scopedPages = config.pageName
    ? pages.filter((p) => p.name === config.pageName)
    : pages;

  if (scopedPages.length === 0) {
    throw new Error(
      config.pageName
        ? `Could not find page "${config.pageName}" in Figma file`
        : 'Could not find any pages in Figma file'
    );
  }

  const nodes = [];

  for (const page of scopedPages) {
    collectExportableNodes(page, nodes);
  }

  const targetName = config.frameName.trim();
  const exactMatches = nodes.filter((n) => n.name === targetName);
  const partialMatches = exactMatches.length === 0
    ? nodes.filter((n) => n.name.toLowerCase().includes(targetName.toLowerCase()))
    : [];
  const matches = exactMatches.length > 0 ? exactMatches : partialMatches;

  if (matches.length === 0) {
    const candidates = [...new Set(nodes.map((n) => n.name))]
      .slice(-12)
      .join(', ');
    throw new Error(
      `Could not find frame name "${config.frameName}". Recent candidate names: [${candidates}]. Set FIGMA_NODE_ID directly or adjust FIGMA_FRAME_NAME.`
    );
  }

  // Use the last match so repeated imports with the same frame name resolve to the newest node.
  return matches[matches.length - 1].id;
}

function resolveFigmaConfig(caseData) {
  const token = requiredEnv('FIGMA_TOKEN', caseData?.figma?.token);
  const fileKey = requiredEnv('FIGMA_FILE_KEY', caseData?.figma?.fileKey);
  const nodeId = normalizeNodeId(process.env.FIGMA_NODE_ID || caseData?.figma?.nodeId || '');
  const frameName = process.env.FIGMA_FRAME_NAME || caseData?.figma?.frameName || '';

  if (!nodeId && !frameName) {
    throw new Error('Missing required value: FIGMA_NODE_ID or FIGMA_FRAME_NAME');
  }

  return {
    token,
    fileKey,
    nodeId,
    frameName,
    pageName: process.env.FIGMA_PAGE_NAME || caseData?.figma?.pageName || '',
    fileDepth: Number(process.env.FIGMA_FILE_DEPTH || caseData?.figma?.fileDepth || 3),
    scale: Number(process.env.FIGMA_IMAGE_SCALE || caseData?.figma?.scale || 1),
  };
}

export async function fetchFigmaImage({ caseData, caseId, outDir }) {
  await loadEnvFiles();

  const outputDir = outDir || getOutputDir(caseId);
  const paths = getOutputPaths(outputDir);
  const config = resolveFigmaConfig(caseData);

  await ensureDir(outputDir);

  // Prefer explicit node ID over frame-name lookup.
  // This avoids accidental mismatches when case JSON still has a stale frameName.
  const resolvedNodeIdRaw = config.nodeId
    ? config.nodeId
    : (config.frameName ? await resolveNodeIdByFrameName(config) : '');
  const resolvedNodeId = normalizeNodeId(resolvedNodeIdRaw);

  if (!resolvedNodeId) {
    throw new Error('Could not resolve FIGMA node id. Set FIGMA_FRAME_NAME or FIGMA_NODE_ID.');
  }

  if (!config.nodeId && config.frameName) {
    console.log(`Resolved FIGMA_NODE_ID from frame name "${config.frameName}": ${resolvedNodeId}`);
  }

  let exportedNodeId = resolvedNodeId;
  let { payload: imagesPayload, imageUrl } = await fetchImageUrlForNode(config, exportedNodeId);

  // If explicit node ID is stale/non-renderable, fall back to latest frame-name match.
  if ((!imageUrl || typeof imageUrl !== 'string') && config.nodeId && config.frameName) {
    const fallbackNodeId = normalizeNodeId(await resolveNodeIdByFrameName(config));
    if (fallbackNodeId && fallbackNodeId !== exportedNodeId) {
      const fallbackResult = await fetchImageUrlForNode(config, fallbackNodeId);
      if (fallbackResult.imageUrl && typeof fallbackResult.imageUrl === 'string') {
        console.warn(
          `FIGMA_NODE_ID "${exportedNodeId}" returned no image. Falling back to frame "${config.frameName}" -> "${fallbackNodeId}".`
        );
        exportedNodeId = fallbackNodeId;
        imagesPayload = fallbackResult.payload;
        imageUrl = fallbackResult.imageUrl;
      }
    }
  }

  if (!imageUrl || typeof imageUrl !== 'string') {
    const detail = describeImagePayload(imagesPayload, exportedNodeId);
    throw new Error(
      `Figma images API did not return an image URL. Check node selection and FIGMA_FILE_KEY. ${detail}`
    );
  }

  let imageResponse;
  try {
    imageResponse = await fetch(imageUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to download Figma image: ${reason}`);
  }
  if (!imageResponse.ok) {
    const body = await imageResponse.text();
    throw new Error(`Failed to download Figma image (${imageResponse.status}): ${body}`);
  }

  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  await fs.writeFile(paths.figmaPng, buffer);

  await writeJson(`${paths.figmaPng}.meta.json`, {
    nodeId: exportedNodeId,
    frameName: config.frameName || null,
    fileKey: config.fileKey,
    pageName: config.pageName || null,
    scale: config.scale,
    requestedAt: new Date().toISOString(),
    figmaImageUrl: imageUrl,
  });

  return {
    outputDir,
    ...paths,
  };
}

async function main() {
  const args = parseArgs();
  const { caseData, caseId } = await loadCase(args.case);
  const outDir = getOutputDir(caseId, args['out-dir']);

  const result = await fetchFigmaImage({ caseData, caseId, outDir });
  console.log(`Fetched Figma screenshot: ${result.figmaPng}`);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
