import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { ssim } from 'ssim.js';
import {
  clampRect,
  fileExists,
  getAlignmentOptions,
  getComparisonTargets,
  getOutputDir,
  getOutputPaths,
  getSectionGates,
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

function clonePng(source) {
  const out = new PNG({ width: source.width, height: source.height });
  source.data.copy(out.data);
  return out;
}

function shiftPng(source, dx, dy) {
  const out = new PNG({ width: source.width, height: source.height });

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const outIdx = (y * source.width + x) * 4;
      const srcX = x + dx;
      const srcY = y + dy;

      if (srcX < 0 || srcY < 0 || srcX >= source.width || srcY >= source.height) {
        out.data[outIdx] = 0;
        out.data[outIdx + 1] = 0;
        out.data[outIdx + 2] = 0;
        out.data[outIdx + 3] = 0;
        continue;
      }

      const srcIdx = (srcY * source.width + srcX) * 4;
      out.data[outIdx] = source.data[srcIdx];
      out.data[outIdx + 1] = source.data[srcIdx + 1];
      out.data[outIdx + 2] = source.data[srcIdx + 2];
      out.data[outIdx + 3] = source.data[srcIdx + 3];
    }
  }

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

function quickMismatchRatio(pngA, pngB, dx, dy, sampleStep = 4) {
  const width = pngA.width;
  const height = pngA.height;
  const threshold = 48;

  let total = 0;
  let mismatched = 0;

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      total += 1;
      const srcX = x + dx;
      const srcY = y + dy;

      if (srcX < 0 || srcY < 0 || srcX >= width || srcY >= height) {
        mismatched += 1;
        continue;
      }

      const idxA = (srcY * width + srcX) * 4;
      const idxB = (y * width + x) * 4;

      const diff =
        Math.abs(pngA.data[idxA] - pngB.data[idxB]) +
        Math.abs(pngA.data[idxA + 1] - pngB.data[idxB + 1]) +
        Math.abs(pngA.data[idxA + 2] - pngB.data[idxB + 2]) +
        Math.abs(pngA.data[idxA + 3] - pngB.data[idxB + 3]);

      if (diff > threshold) {
        mismatched += 1;
      }
    }
  }

  return mismatched / Math.max(1, total);
}

function findBestAlignment(pngA, pngB, options) {
  const sampleStep = Math.max(1, Math.floor(options.downsample));
  const coarseStep = Math.max(1, sampleStep * 2);
  const maxShiftX = Math.max(0, Math.floor(options.maxShiftX));
  const maxShiftY = Math.max(0, Math.floor(options.maxShiftY));

  let best = {
    dx: 0,
    dy: 0,
    score: quickMismatchRatio(pngA, pngB, 0, 0, sampleStep),
  };

  for (let dy = -maxShiftY; dy <= maxShiftY; dy += coarseStep) {
    for (let dx = -maxShiftX; dx <= maxShiftX; dx += coarseStep) {
      const score = quickMismatchRatio(pngA, pngB, dx, dy, sampleStep);
      if (score < best.score) {
        best = { dx, dy, score };
      }
    }
  }

  if (options.refine) {
    const refineMinX = Math.max(-maxShiftX, best.dx - coarseStep);
    const refineMaxX = Math.min(maxShiftX, best.dx + coarseStep);
    const refineMinY = Math.max(-maxShiftY, best.dy - coarseStep);
    const refineMaxY = Math.min(maxShiftY, best.dy + coarseStep);

    for (let dy = refineMinY; dy <= refineMaxY; dy += 1) {
      for (let dx = refineMinX; dx <= refineMaxX; dx += 1) {
        const score = quickMismatchRatio(pngA, pngB, dx, dy, sampleStep);
        if (score < best.score) {
          best = { dx, dy, score };
        }
      }
    }
  }

  return best;
}

function runPixelCompare(pngA, pngB, threshold) {
  const diff = new PNG({ width: pngA.width, height: pngA.height });
  const mismatchedPixels = pixelmatch(
    pngA.data,
    pngB.data,
    diff.data,
    pngA.width,
    pngA.height,
    { threshold }
  );

  const { mssim } = ssim(pngA, pngB);

  return {
    diff,
    mismatchedPixels,
    ssim: mssim,
  };
}

function getDiffRatio(mismatchedPixels, width, height) {
  return mismatchedPixels / Math.max(1, width * height);
}

function clampRegion(region, width, height) {
  const clamped = clampRect(region, width, height);
  if (clamped.width === 0 || clamped.height === 0) {
    return null;
  }
  return {
    x: clamped.x,
    y: clamped.y,
    width: clamped.width,
    height: clamped.height,
  };
}

function compareRegion(pngWeb, pngFigma, threshold, region) {
  const area = clampRegion(region, pngWeb.width, pngWeb.height);
  if (!area) {
    return {
      rect: { x: 0, y: 0, width: 0, height: 0 },
      mismatchedPixels: 0,
      diffRatio: 0,
      ssim: 1,
    };
  }
  const webRegion = new PNG({ width: area.width, height: area.height });
  const figmaRegion = new PNG({ width: area.width, height: area.height });

  PNG.bitblt(pngWeb, webRegion, area.x, area.y, area.width, area.height, 0, 0);
  PNG.bitblt(pngFigma, figmaRegion, area.x, area.y, area.width, area.height, 0, 0);

  const compared = runPixelCompare(webRegion, figmaRegion, threshold);
  return {
    rect: area,
    mismatchedPixels: compared.mismatchedPixels,
    diffRatio: getDiffRatio(compared.mismatchedPixels, area.width, area.height),
    ssim: compared.ssim,
  };
}

function buildMarkdownReport(report) {
  const status = report.pass ? 'PASS' : 'FAIL';
  const alignmentSummary = report.alignment?.enabled
    ? `dx=${report.alignment.dx}, dy=${report.alignment.dy}`
    : 'disabled';
  const globalTargets = report.targets?.global || {};
  const sections = Array.isArray(report.sections) ? report.sections : [];
  const topOffenders = report.summary?.topOffenders || [];

  const lines = [
    `# Visual Compare Report: ${report.caseId}`,
    '',
    `- Status: **${status}**`,
    `- Global pass: **${report.summary?.globalPass ? 'PASS' : 'FAIL'}**`,
    `- Section gates pass: **${report.summary?.sectionGatesPass ? 'PASS' : 'FAIL'}**`,
    `- Raw diff ratio: \`${report.rawDiffRatio.toFixed(6)}\` (max \`${globalTargets.rawDiffMax}\`)`,
    `- Raw SSIM: \`${report.rawSSIM.toFixed(6)}\` (min \`${globalTargets.rawSSIMMin}\`)`,
    `- Aligned diff ratio: \`${report.alignedDiffRatio.toFixed(6)}\` (max \`${globalTargets.alignedDiffMax}\`)`,
    `- Aligned SSIM: \`${report.alignedSSIM.toFixed(6)}\` (min \`${globalTargets.alignedSSIMMin}\`)`,
    `- Alignment: ${alignmentSummary}`,
    `- Compared pixels: ${report.comparedPixels}`,
    `- Masked pixels: ${report.maskedPixels}`,
    '',
  ];

  if (sections.length > 0) {
    lines.push('## Section Gates', '');
    lines.push('| Section | Pass | Raw Diff | Raw Max | Aligned Diff | Aligned Max | Raw SSIM | Raw Min | Aligned SSIM | Aligned Min |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const section of sections) {
      const rawMin = section.targets.rawSSIMMin === undefined ? '-' : section.targets.rawSSIMMin;
      const alignedMin = section.targets.alignedSSIMMin === undefined ? '-' : section.targets.alignedSSIMMin;
      lines.push(
        `| ${section.name} | ${section.pass ? 'PASS' : 'FAIL'} | ${section.rawDiffRatio.toFixed(6)} | ${section.targets.rawDiffMax} | ${section.alignedDiffRatio.toFixed(6)} | ${section.targets.alignedDiffMax} | ${section.rawSSIM.toFixed(6)} | ${rawMin} | ${section.alignedSSIM.toFixed(6)} | ${alignedMin} |`
      );
    }
    lines.push('');
  }

  if (topOffenders.length > 0) {
    lines.push('## Top Offenders', '');
    for (const offender of topOffenders) {
      lines.push(
        `- ${offender.name}: raw=${offender.rawDiffRatio.toFixed(6)}, aligned=${offender.alignedDiffRatio.toFixed(6)}`
      );
    }
    lines.push('');
  }

  lines.push(
    '## Files',
    '',
    `- Web: ${report.files.webPng}`,
    `- Figma: ${report.files.figmaPng}`,
    `- Diff: ${report.files.diffPng}`,
    `- Capture JSON: ${report.files.captureJson}`,
    '',
  );

  return lines.join('\n');
}

export async function compareImages({ caseData, caseId, outDir }) {
  const outputDir = outDir || getOutputDir(caseId);
  const paths = getOutputPaths(outputDir);
  const thresholds = getThresholds(caseData);
  const alignmentOptions = getAlignmentOptions(caseData);
  const targets = getComparisonTargets(caseData);
  const sectionGates = getSectionGates(caseData, targets);

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

  const baseWeb = cropTopLeft(webRaw, width, height);
  const baseFigma = cropTopLeft(figmaRaw, width, height);

  const rawWeb = clonePng(baseWeb);
  const rawFigma = clonePng(baseFigma);
  const maskedPixels = applyMasks(rawWeb, rawFigma, caseData?.masks || []);
  const comparedPixels = Math.max(1, width * height - maskedPixels);

  const rawStats = runPixelCompare(rawWeb, rawFigma, thresholds.pixelmatchThreshold);
  const rawDiffRatio = getDiffRatio(rawStats.mismatchedPixels, width, height);
  const rawSSIM = rawStats.ssim;

  let alignedWeb = rawWeb;
  let alignment = {
    enabled: false,
    dx: 0,
    dy: 0,
    score: rawDiffRatio,
    options: alignmentOptions,
  };

  if (alignmentOptions.enabled) {
    const best = findBestAlignment(rawWeb, rawFigma, alignmentOptions);
    alignedWeb = shiftPng(rawWeb, best.dx, best.dy);
    alignment = {
      enabled: true,
      dx: best.dx,
      dy: best.dy,
      score: best.score,
      options: alignmentOptions,
    };
  }

  const alignedStats = runPixelCompare(alignedWeb, rawFigma, thresholds.pixelmatchThreshold);
  const alignedDiffRatio = getDiffRatio(alignedStats.mismatchedPixels, width, height);
  const alignedSSIM = alignedStats.ssim;

  const sections = sectionGates.map((gate) => {
    const rawSection = compareRegion(rawWeb, rawFigma, thresholds.pixelmatchThreshold, gate.rect);
    const alignedSection = compareRegion(
      alignedWeb,
      rawFigma,
      thresholds.pixelmatchThreshold,
      gate.rect
    );
    const rawSsimPass = gate.rawSSIMMin === undefined || rawSection.ssim >= gate.rawSSIMMin;
    const alignedSsimPass =
      gate.alignedSSIMMin === undefined || alignedSection.ssim >= gate.alignedSSIMMin;
    const sectionPass =
      rawSection.diffRatio <= gate.rawDiffMax &&
      alignedSection.diffRatio <= gate.alignedDiffMax &&
      rawSsimPass &&
      alignedSsimPass;

    return {
      name: gate.name,
      rect: rawSection.rect,
      rawDiffRatio: rawSection.diffRatio,
      alignedDiffRatio: alignedSection.diffRatio,
      rawSSIM: rawSection.ssim,
      alignedSSIM: alignedSection.ssim,
      rawMismatchedPixels: rawSection.mismatchedPixels,
      alignedMismatchedPixels: alignedSection.mismatchedPixels,
      pass: sectionPass,
      targets: {
        rawDiffMax: gate.rawDiffMax,
        alignedDiffMax: gate.alignedDiffMax,
        rawSSIMMin: gate.rawSSIMMin,
        alignedSSIMMin: gate.alignedSSIMMin,
      },
    };
  });

  const diffRatio = alignedDiffRatio;
  const mssim = alignedSSIM;
  const mismatchedPixels = alignedStats.mismatchedPixels;

  await writePng(paths.diffPng, alignedStats.diff);

  const globalPass =
    rawDiffRatio <= targets.global.rawDiffMax &&
    alignedDiffRatio <= targets.global.alignedDiffMax &&
    rawSSIM >= targets.global.rawSSIMMin &&
    alignedSSIM >= targets.global.alignedSSIMMin;
  const sectionGatesPass = sections.every((section) => section.pass);
  const pass = globalPass && sectionGatesPass;

  const topOffenders = [...sections]
    .sort((a, b) => b.rawDiffRatio + b.alignedDiffRatio - (a.rawDiffRatio + a.alignedDiffRatio))
    .slice(0, 3)
    .map((section) => ({
      name: section.name,
      rawDiffRatio: section.rawDiffRatio,
      alignedDiffRatio: section.alignedDiffRatio,
      pass: section.pass,
    }));

  const report = {
    caseId,
    pass,
    diffRatio,
    ssim: mssim,
    rawDiffRatio,
    alignedDiffRatio,
    rawSSIM,
    alignedSSIM,
    alignment,
    mismatchedPixels,
    rawMismatchedPixels: rawStats.mismatchedPixels,
    alignedMismatchedPixels: alignedStats.mismatchedPixels,
    comparedPixels,
    maskedPixels,
    width,
    height,
    thresholds,
    targets,
    sections,
    summary: {
      globalPass,
      sectionGatesPass,
      failingSections: sections.filter((section) => !section.pass).map((section) => section.name),
      topOffenders,
    },
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
