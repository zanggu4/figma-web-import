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
  const response = await fetch(url, {
    headers: {
      'X-Figma-Token': token,
    },
  });

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
  const nodeId = process.env.FIGMA_NODE_ID || caseData?.figma?.nodeId || '';
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

  const resolvedNodeId = config.frameName
    ? await resolveNodeIdByFrameName(config)
    : config.nodeId;

  if (!resolvedNodeId) {
    throw new Error('Could not resolve FIGMA node id. Set FIGMA_FRAME_NAME or FIGMA_NODE_ID.');
  }

  if (config.frameName) {
    console.log(`Resolved FIGMA_NODE_ID from frame name "${config.frameName}": ${resolvedNodeId}`);
  }

  const url = new URL(`https://api.figma.com/v1/images/${config.fileKey}`);
  url.searchParams.set('ids', resolvedNodeId);
  url.searchParams.set('format', 'png');
  url.searchParams.set('scale', String(config.scale));
  url.searchParams.set('use_absolute_bounds', 'true');

  const imagesPayload = await fetchJson(url, config.token, 'Figma images API');
  const imageUrl = imagesPayload?.images?.[resolvedNodeId] || Object.values(imagesPayload?.images || {})[0];

  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Error('Figma images API did not return an image URL. Check node selection and FIGMA_FILE_KEY.');
  }

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    const body = await imageResponse.text();
    throw new Error(`Failed to download Figma image (${imageResponse.status}): ${body}`);
  }

  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  await fs.writeFile(paths.figmaPng, buffer);

  await writeJson(`${paths.figmaPng}.meta.json`, {
    nodeId: resolvedNodeId,
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
