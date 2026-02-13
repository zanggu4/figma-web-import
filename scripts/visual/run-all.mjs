import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CASE_DIR, getOutputDir, parseArgs, readJson } from './common.mjs';
import { runCase } from './run-case.mjs';

async function listCaseFiles(caseDir) {
  const entries = await fs.readdir(caseDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(caseDir, entry.name))
    .sort();
}

async function main() {
  const args = parseArgs();
  const caseDir = args['case-dir']
    ? path.resolve(args['case-dir'])
    : DEFAULT_CASE_DIR;
  const mode = String(args.mode || 'compare');
  const noWait = args['no-wait'] === true || mode !== 'full';

  if (!['full', 'capture', 'compare'].includes(mode)) {
    throw new Error(`Invalid --mode: ${mode}. Use full | capture | compare`);
  }

  const caseFiles = await listCaseFiles(caseDir);

  if (caseFiles.length === 0) {
    throw new Error(`No case files found in ${caseDir}`);
  }

  const failures = [];

  for (const caseFile of caseFiles) {
    const caseData = await readJson(caseFile);
    const caseId = caseData.id || path.basename(caseFile, path.extname(caseFile));
    const outDir = getOutputDir(caseId, args['out-dir']);

    console.log(`\n=== Running case: ${caseId} (${mode}) ===`);

    try {
      const report = await runCase({ caseData, caseId, outDir, mode, noWait });
      if (report && !report.pass) {
        failures.push({ caseId, reason: 'visual threshold failed' });
      }
    } catch (error) {
      failures.push({
        caseId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failures.length > 0) {
    console.error('\nVisual run failed:');
    for (const failure of failures) {
      console.error(`- ${failure.caseId}: ${failure.reason}`);
    }
    process.exit(1);
  }

  console.log('\nAll visual cases passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
