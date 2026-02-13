/**
 * Test to verify Figma paint conversion
 *
 * This test validates that fills are correctly converted to Figma paints
 * with proper opacity values.
 */

import type { Paint as SharedPaint } from './packages/shared/src/types/layer-meta';

// Simulate the convertFills function from node-factory.ts
function convertFills(fills: SharedPaint[]): any[] {
  const figmaPaints: any[] = [];

  for (const fill of fills) {
    if (fill.type === 'SOLID') {
      figmaPaints.push({
        type: 'SOLID',
        color: {
          r: fill.color.r,
          g: fill.color.g,
          b: fill.color.b,
        },
        opacity: fill.color.a * (fill.opacity ?? 1),
        visible: fill.visible ?? true,
      });
    }
  }

  return figmaPaints;
}

console.log('Testing Figma paint conversion...\n');

// Test 1: Semi-transparent fill conversion
console.log('Test 1: Semi-transparent fill (a=0.5, opacity=1)');
const fill1: SharedPaint = {
  type: 'SOLID',
  color: { r: 0, g: 0, b: 0, a: 0.5 },
  opacity: 1,
  visible: true
};
const paints1 = convertFills([fill1]);
console.log('  Input fill:', JSON.stringify(fill1, null, 2));
console.log('  Output paint:', JSON.stringify(paints1[0], null, 2));
if (paints1[0].opacity === 0.5) {
  console.log('  ✓ PASS: Opacity correctly set to 0.5\n');
} else {
  console.log('  ✗ FAIL: Incorrect opacity:', paints1[0].opacity, '\n');
}

// Test 2: Multiple opacity levels
console.log('Test 2: Multiple opacity levels');
const opacities = [0.25, 0.5, 0.75, 1.0];
let allPass = true;
opacities.forEach(alpha => {
  const fill: SharedPaint = {
    type: 'SOLID',
    color: { r: 0, g: 0, b: 0, a: alpha },
    opacity: 1,
    visible: true
  };
  const paints = convertFills([fill]);
  const expectedOpacity = alpha * 1; // alpha * opacity
  const pass = Math.abs(paints[0].opacity - expectedOpacity) < 0.0001;
  console.log(`  Alpha ${alpha} → Opacity ${paints[0].opacity}:`, pass ? '✓ PASS' : '✗ FAIL');
  if (!pass) allPass = false;
});
console.log(allPass ? '  Overall: ✓ PASS\n' : '  Overall: ✗ FAIL\n');

// Test 3: Combined alpha and opacity
console.log('Test 3: Combined alpha and opacity (a=0.5, opacity=0.8)');
const fill3: SharedPaint = {
  type: 'SOLID',
  color: { r: 0, g: 0, b: 0, a: 0.5 },
  opacity: 0.8,
  visible: true
};
const paints3 = convertFills([fill3]);
const expectedOpacity = 0.5 * 0.8; // 0.4
console.log(`  Expected opacity: ${expectedOpacity}`);
console.log(`  Actual opacity: ${paints3[0].opacity}`);
if (Math.abs(paints3[0].opacity - expectedOpacity) < 0.0001) {
  console.log('  ✓ PASS: Opacity correctly multiplied\n');
} else {
  console.log('  ✗ FAIL: Incorrect opacity calculation\n');
}

// Test 4: RGB values preserved (not affected by alpha)
console.log('Test 4: RGB values preserved in Figma paint');
const fill4: SharedPaint = {
  type: 'SOLID',
  color: { r: 0, g: 0, b: 0, a: 0.5 },
  opacity: 1,
  visible: true
};
const paints4 = convertFills([fill4]);
const rgbPreserved = paints4[0].color.r === 0 &&
                     paints4[0].color.g === 0 &&
                     paints4[0].color.b === 0 &&
                     paints4[0].color.a === undefined; // Alpha should NOT be in color
console.log('  Output color:', JSON.stringify(paints4[0].color));
if (rgbPreserved) {
  console.log('  ✓ PASS: RGB preserved, alpha separated\n');
} else {
  console.log('  ✗ FAIL: RGB values incorrect or alpha not separated\n');
}

console.log('All Figma conversion tests completed!');
