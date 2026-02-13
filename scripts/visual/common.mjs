import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const DEFAULT_CASE_DIR = path.join(REPO_ROOT, 'visual', 'cases');
export const DEFAULT_ARTIFACTS_DIR = path.join(REPO_ROOT, 'visual', 'artifacts');

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const eqIndex = trimmed.indexOf('=');
  if (eqIndex <= 0) {
    return null;
  }

  const key = trimmed.slice(0, eqIndex).trim();
  let value = trimmed.slice(eqIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);

    for (const line of lines) {
      const parsed = parseEnvLine(line);
      if (!parsed) {
        continue;
      }

      if (process.env[parsed.key] === undefined) {
        process.env[parsed.key] = parsed.value;
      }
    }
  } catch (error) {
    // Ignore missing files; only rethrow unexpected read errors.
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

let envLoaded = false;

export async function loadEnvFiles() {
  if (envLoaded) {
    return;
  }

  await loadEnvFile(path.join(REPO_ROOT, '.env'));
  await loadEnvFile(path.join(REPO_ROOT, '.env.local'));
  envLoaded = true;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }

  return args;
}

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function resolveFromRepo(maybeRelativePath) {
  if (path.isAbsolute(maybeRelativePath)) {
    return maybeRelativePath;
  }
  return path.resolve(REPO_ROOT, maybeRelativePath);
}

export async function loadCase(casePathInput) {
  if (!casePathInput) {
    throw new Error('Missing --case argument. Example: --case visual/cases/example.local.json');
  }

  const casePath = resolveFromRepo(casePathInput);
  const caseData = await readJson(casePath);

  if (!caseData?.target?.url) {
    throw new Error(`Case file is missing target.url: ${casePath}`);
  }

  return {
    casePath,
    caseData,
    caseId: caseData.id || path.basename(casePath, path.extname(casePath)),
  };
}

export function getThresholds(caseData) {
  return {
    maxDiffRatio: caseData?.comparison?.maxDiffRatio ?? 0.03,
    minSSIM: caseData?.comparison?.minSSIM ?? 0.97,
    pixelmatchThreshold: caseData?.comparison?.pixelmatchThreshold ?? 0.1,
  };
}

export function getViewport(caseData) {
  return {
    width: caseData?.viewport?.width ?? 1440,
    height: caseData?.viewport?.height ?? 900,
  };
}

export function getWaitOptions(caseData) {
  return {
    selector: caseData?.wait?.selector,
    timeoutMs: caseData?.wait?.timeoutMs ?? 20000,
    networkIdle: caseData?.wait?.networkIdle ?? true,
    delayMs: caseData?.wait?.delayMs ?? 1000,
  };
}

export function getCaptureSelector(caseData) {
  return caseData?.capture?.selector ?? null;
}

export function getOutputDir(caseId, outDirArg) {
  if (outDirArg) {
    return resolveFromRepo(outDirArg);
  }
  return path.join(DEFAULT_ARTIFACTS_DIR, caseId);
}

export function getOutputPaths(outDir) {
  return {
    outputDir: outDir,
    captureJson: path.join(outDir, 'capture.json'),
    webPng: path.join(outDir, 'web.png'),
    figmaPng: path.join(outDir, 'figma.png'),
    diffPng: path.join(outDir, 'diff.png'),
    reportJson: path.join(outDir, 'report.json'),
    reportMd: path.join(outDir, 'report.md'),
  };
}

export function requiredEnv(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Missing required value: ${name}`);
  }
  return value;
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function clampRect(mask, width, height) {
  const x = Math.max(0, Math.floor(mask.x ?? 0));
  const y = Math.max(0, Math.floor(mask.y ?? 0));
  const w = Math.max(0, Math.floor(mask.width ?? 0));
  const h = Math.max(0, Math.floor(mask.height ?? 0));

  return {
    x,
    y,
    width: Math.min(w, Math.max(0, width - x)),
    height: Math.min(h, Math.max(0, height - y)),
  };
}

export function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}
