// Test color parsing to verify white text fix
import { parseColor } from './packages/shared/dist/index.mjs';

const testCases = [
  { input: 'rgb(255, 255, 255)', expected: { r: 1, g: 1, b: 1, a: 1 } },
  { input: 'rgb(255,255,255)', expected: { r: 1, g: 1, b: 1, a: 1 } },
  { input: 'rgba(255, 255, 255, 1)', expected: { r: 1, g: 1, b: 1, a: 1 } },
  { input: 'rgba(255, 255, 255, 0.5)', expected: { r: 1, g: 1, b: 1, a: 0.5 } },
  { input: 'white', expected: { r: 1, g: 1, b: 1, a: 1 } },
  { input: '#ffffff', expected: { r: 1, g: 1, b: 1, a: 1 } },
  { input: '#fff', expected: { r: 1, g: 1, b: 1, a: 1 } },
  { input: 'rgb(0, 0, 0)', expected: { r: 0, g: 0, b: 0, a: 1 } },
  { input: 'rgba(255, 0, 0, 1)', expected: { r: 1, g: 0, b: 0, a: 1 } },
];

console.log('Testing color parsing...\n');

let passed = 0;
let failed = 0;

for (const test of testCases) {
  const result = parseColor(test.input);
  const matches =
    Math.abs(result.r - test.expected.r) < 0.001 &&
    Math.abs(result.g - test.expected.g) < 0.001 &&
    Math.abs(result.b - test.expected.b) < 0.001 &&
    Math.abs(result.a - test.expected.a) < 0.001;

  if (matches) {
    console.log(`✓ PASS: "${test.input}"`);
    console.log(`  Got: ${JSON.stringify(result)}`);
    passed++;
  } else {
    console.log(`✗ FAIL: "${test.input}"`);
    console.log(`  Expected: ${JSON.stringify(test.expected)}`);
    console.log(`  Got:      ${JSON.stringify(result)}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
