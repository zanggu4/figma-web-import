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

function resolveFigmaConfig(caseData) {
  return {
    token: requiredEnv('FIGMA_TOKEN', caseData?.figma?.token),
    fileKey: requiredEnv('FIGMA_FILE_KEY', caseData?.figma?.fileKey),
    nodeId: requiredEnv('FIGMA_NODE_ID', caseData?.figma?.nodeId),
    scale: Number(process.env.FIGMA_IMAGE_SCALE || caseData?.figma?.scale || 1),
  };
}

export async function fetchFigmaImage({ caseData, caseId, outDir }) {
  await loadEnvFiles();

  const outputDir = outDir || getOutputDir(caseId);
  const paths = getOutputPaths(outputDir);
  const config = resolveFigmaConfig(caseData);

  await ensureDir(outputDir);

  const url = new URL(`https://api.figma.com/v1/images/${config.fileKey}`);
  url.searchParams.set('ids', config.nodeId);
  url.searchParams.set('format', 'png');
  url.searchParams.set('scale', String(config.scale));
  url.searchParams.set('use_absolute_bounds', 'true');

  const imagesResponse = await fetch(url, {
    headers: {
      'X-Figma-Token': config.token,
    },
  });

  if (!imagesResponse.ok) {
    const body = await imagesResponse.text();
    throw new Error(`Figma images API failed (${imagesResponse.status}): ${body}`);
  }

  const imagesPayload = await imagesResponse.json();
  const imageUrl = imagesPayload?.images?.[config.nodeId] || Object.values(imagesPayload?.images || {})[0];

  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Error('Figma images API did not return an image URL. Check FIGMA_NODE_ID and FIGMA_FILE_KEY.');
  }

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    const body = await imageResponse.text();
    throw new Error(`Failed to download Figma image (${imageResponse.status}): ${body}`);
  }

  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  await fs.writeFile(paths.figmaPng, buffer);

  await writeJson(`${paths.figmaPng}.meta.json`, {
    nodeId: config.nodeId,
    fileKey: config.fileKey,
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
