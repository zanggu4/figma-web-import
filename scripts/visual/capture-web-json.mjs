import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  REPO_ROOT,
  ensureDir,
  fileExists,
  getCaptureSelector,
  getOutputDir,
  getOutputPaths,
  getViewport,
  getWaitOptions,
  loadCase,
  parseArgs,
  writeJson,
} from './common.mjs';

const SHARED_IIFE_PATH = path.join(REPO_ROOT, 'packages', 'shared', 'dist', 'index.global.js');

export async function captureWebAndJson({ caseData, caseId, outDir }) {
  const outputDir = outDir || getOutputDir(caseId);
  const paths = getOutputPaths(outputDir);
  const viewport = getViewport(caseData);
  const wait = getWaitOptions(caseData);
  const selector = getCaptureSelector(caseData);

  await ensureDir(outputDir);

  const iifeExists = await fileExists(SHARED_IIFE_PATH);
  if (!iifeExists) {
    throw new Error(
      `Missing shared IIFE bundle at ${SHARED_IIFE_PATH}. Run: pnpm --filter @figma-web-import/shared build:iife`
    );
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();

    await page.goto(caseData.target.url, {
      waitUntil: 'domcontentloaded',
      timeout: wait.timeoutMs,
    });

    if (wait.selector) {
      await page.waitForSelector(wait.selector, { timeout: wait.timeoutMs });
    }

    if (wait.networkIdle) {
      await page.waitForLoadState('networkidle', { timeout: wait.timeoutMs });
    }

    if (wait.delayMs > 0) {
      await page.waitForTimeout(wait.delayMs);
    }

    // Reduce visual noise from ongoing animations/transitions.
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation: none !important;
          transition: none !important;
          caret-color: transparent !important;
        }
      `,
    });

    await page.addScriptTag({ path: SHARED_IIFE_PATH });

    const captureData = await page.evaluate((captureSelector) => {
      const root = captureSelector
        ? window.__figmaCapture.captureElement(captureSelector)
        : window.__figmaCapture.captureDocument();

      if (!root) {
        throw new Error(
          captureSelector
            ? `Failed to capture selector: ${captureSelector}`
            : 'Failed to capture document body'
        );
      }

      return {
        version: window.__figmaCapture.VERSION,
        capturedAt: new Date().toISOString(),
        sourceUrl: window.location.href,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        root,
      };
    }, selector);

    await page.screenshot({
      path: paths.webPng,
      fullPage: false,
    });

    await writeJson(paths.captureJson, captureData);

    return {
      outputDir,
      ...paths,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs();
  const { caseData, caseId } = await loadCase(args.case);
  const outDir = getOutputDir(caseId, args['out-dir']);

  const result = await captureWebAndJson({ caseData, caseId, outDir });

  console.log(`Captured web screenshot: ${result.webPng}`);
  console.log(`Captured import JSON: ${result.captureJson}`);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
