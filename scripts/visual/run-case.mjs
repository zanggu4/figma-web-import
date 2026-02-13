import readline from 'node:readline/promises';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { captureWebAndJson } from './capture-web-json.mjs';
import { compareImages } from './compare-images.mjs';
import { fetchFigmaImage } from './fetch-figma-image.mjs';
import { getOutputDir, getOutputPaths, loadCase, parseArgs } from './common.mjs';

async function waitForImportStep(paths) {
  if (!process.stdin.isTTY) {
    throw new Error(
      `Manual import step requires TTY. Use --no-wait if you already imported and want compare-only.\nCapture JSON: ${paths.captureJson}`
    );
  }

  const rl = readline.createInterface({ input, output });

  try {
    console.log('');
    console.log('Manual step required:');
    console.log(`1) Open Figma plugin Web Import`);
    console.log(`2) Paste JSON from: ${paths.captureJson}`);
    console.log('3) Click Import in Figma plugin');
    console.log('');
    await rl.question('Import를 완료하셨으면 Enter를 눌러 계속 진행하세요...');
  } finally {
    rl.close();
  }
}

export async function runCase({ caseData, caseId, outDir, mode = 'full', noWait = false }) {
  const outputDir = outDir || getOutputDir(caseId);
  const paths = getOutputPaths(outputDir);

  if (mode === 'full' || mode === 'capture') {
    await captureWebAndJson({ caseData, caseId, outDir: outputDir });
    console.log(`Captured assets at: ${outputDir}`);
  }

  if (mode === 'full' && !noWait) {
    await waitForImportStep(paths);
  }

  if (mode === 'full' || mode === 'compare') {
    await fetchFigmaImage({ caseData, caseId, outDir: outputDir });
    const report = await compareImages({ caseData, caseId, outDir: outputDir });
    console.log(`Result: ${report.pass ? 'PASS' : 'FAIL'} | diff=${report.diffRatio.toFixed(6)} ssim=${report.ssim.toFixed(6)}`);
    return report;
  }

  return null;
}

async function main() {
  const args = parseArgs();
  const mode = String(args.mode || 'full');

  if (!['full', 'capture', 'compare'].includes(mode)) {
    throw new Error(`Invalid --mode: ${mode}. Use full | capture | compare`);
  }

  const { caseData, caseId } = await loadCase(args.case);
  const outDir = getOutputDir(caseId, args['out-dir']);
  const noWait = Boolean(args['no-wait']);

  const report = await runCase({ caseData, caseId, outDir, mode, noWait });

  if (report && !report.pass) {
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
