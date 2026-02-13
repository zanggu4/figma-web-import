import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { ssim } from 'ssim.js';
import {
  clampRect,
  fileExists,
  getOutputDir,
  getOutputPaths,
  getThresholds,
  loadCase,
  parseArgs,
  writeJson,
} from './common.mjs';

function readPng(filePath) {
  return fs.readFile(filePath).then((buf) => PNG.sync.read(buf));
}

function writePng(filePath, png) {
  const buffer = PNG.sync.write(png);
  return fs.writeFile(filePath, buffer);
}

function cropTopLeft(source, width, height) {
  const out = new PNG({ width, height });
  PNG.bitblt(source, out, 0, 0, width, height, 0, 0);
  return out;
}

function applyMasks(pngA, pngB, masks = []) {
  const width = pngA.width;
  const height = pngA.height;

  let maskedPixels = 0;

  for (const rawMask of masks) {
    const mask = clampRect(rawMask, width, height);
    if (mask.width === 0 || mask.height === 0) {
      continue;
    }

    for (let y = mask.y; y < mask.y + mask.height; y++) {
      for (let x = mask.x; x < mask.x + mask.width; x++) {
        const idx = (y * width + x) * 4;
        // Set both images to identical transparent black so masked areas are ignored.
        pngA.data[idx] = 0;
        pngA.data[idx + 1] = 0;
        pngA.data[idx + 2] = 0;
        pngA.data[idx + 3] = 0;

        pngB.data[idx] = 0;
        pngB.data[idx + 1] = 0;
        pngB.data[idx + 2] = 0;
        pngB.data[idx + 3] = 0;
      }
    }

    maskedPixels += mask.width * mask.height;
  }

  return maskedPixels;
}

function buildMarkdownReport(report) {
  const status = report.pass ? 'PASS' : 'FAIL';

  return [
    `# Visual Compare Report: ${report.caseId}`,
    '',
    `- Status: **${status}**`,
    `- Diff ratio: \`${report.diffRatio.toFixed(6)}\` (max \`${report.thresholds.maxDiffRatio}\`)`,
    `- SSIM: \`${report.ssim.toFixed(6)}\` (min \`${report.thresholds.minSSIM}\`)`,
    `- Compared pixels: ${report.comparedPixels}`,
    `- Masked pixels: ${report.maskedPixels}`,
    '',
    '## Files',
    '',
    `- Web: ${report.files.webPng}`,
    `- Figma: ${report.files.figmaPng}`,
    `- Diff: ${report.files.diffPng}`,
    `- Capture JSON: ${report.files.captureJson}`,
    '',
  ].join('\n');
}

export async function compareImages({ caseData, caseId, outDir }) {
  const outputDir = outDir || getOutputDir(caseId);
  const paths = getOutputPaths(outputDir);
  const thresholds = getThresholds(caseData);

  const hasWeb = await fileExists(paths.webPng);
  const hasFigma = await fileExists(paths.figmaPng);

  if (!hasWeb) {
    throw new Error(`Missing web screenshot: ${paths.webPng}`);
  }
  if (!hasFigma) {
    throw new Error(`Missing Figma screenshot: ${paths.figmaPng}`);
  }

  const [webRaw, figmaRaw] = await Promise.all([readPng(paths.webPng), readPng(paths.figmaPng)]);

  const width = Math.min(webRaw.width, figmaRaw.width);
  const height = Math.min(webRaw.height, figmaRaw.height);

  if (width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions for comparison.');
  }

  const web = cropTopLeft(webRaw, width, height);
  const figma = cropTopLeft(figmaRaw, width, height);

  const maskedPixels = applyMasks(web, figma, caseData?.masks || []);

  const diff = new PNG({ width, height });
  const mismatchedPixels = pixelmatch(web.data, figma.data, diff.data, width, height, {
    threshold: thresholds.pixelmatchThreshold,
  });

  const comparedPixels = Math.max(1, width * height - maskedPixels);
  const diffRatio = mismatchedPixels / comparedPixels;

  const { mssim } = ssim(web, figma);

  await writePng(paths.diffPng, diff);

  const pass = diffRatio <= thresholds.maxDiffRatio && mssim >= thresholds.minSSIM;

  const report = {
    caseId,
    pass,
    diffRatio,
    ssim: mssim,
    mismatchedPixels,
    comparedPixels,
    maskedPixels,
    width,
    height,
    thresholds,
    generatedAt: new Date().toISOString(),
    files: paths,
  };

  await writeJson(paths.reportJson, report);
  await fs.writeFile(paths.reportMd, `${buildMarkdownReport(report)}\n`, 'utf8');

  return report;
}

async function main() {
  const args = parseArgs();
  const { caseData, caseId } = await loadCase(args.case);
  const outDir = getOutputDir(caseId, args['out-dir']);

  const report = await compareImages({ caseData, caseId, outDir });

  console.log(`Diff ratio: ${report.diffRatio.toFixed(6)}`);
  console.log(`SSIM: ${report.ssim.toFixed(6)}`);
  console.log(`Report: ${report.files.reportJson}`);

  if (!report.pass) {
    process.exit(1);
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
