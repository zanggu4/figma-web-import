/**
 * Test to verify overlay transparency handling
 *
 * This test validates that semi-transparent backgrounds like bg-black/50
 * are correctly parsed and converted to Figma fills with proper opacity.
 */

import { parseBackground } from './packages/shared/src/converters/style-parser';
import { parseColor } from './packages/shared/src/converters/color-utils';

// Mock CSSStyleDeclaration
function createMockStyles(props: Record<string, string>): CSSStyleDeclaration {
  return new Proxy({} as CSSStyleDeclaration, {
    get(target, prop: string) {
      return props[prop] || '';
    }
  });
}

console.log('Testing overlay transparency handling...\n');

// Test 1: Semi-transparent black overlay (bg-black/50)
console.log('Test 1: Semi-transparent black overlay (bg-black/50)');
const overlayStyles = createMockStyles({
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  backgroundImage: 'none',
  color: 'rgb(0, 0, 0)'
});
const overlayFills = parseBackground(overlayStyles);
console.log('  Fills count:', overlayFills.length);
console.log('  Fill[0]:', JSON.stringify(overlayFills[0], null, 2));
if (overlayFills.length === 1 &&
    overlayFills[0].type === 'SOLID' &&
    overlayFills[0].color.a === 0.5) {
  console.log('  ✓ PASS: Semi-transparent overlay parsed correctly\n');
} else {
  console.log('  ✗ FAIL: Incorrect parsing\n');
}

// Test 2: Element with both background-image and background-color
console.log('Test 2: Element with background-image AND background-color');
const combinedStyles = createMockStyles({
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  backgroundImage: 'url("https://example.com/image.jpg")',
  color: 'rgb(0, 0, 0)'
});
const combinedFills = parseBackground(combinedStyles);
console.log('  Fills count:', combinedFills.length);
console.log('  Fill[0] (image):', combinedFills[0]?.type);
console.log('  Fill[1] (color):', combinedFills[1]?.type, combinedFills[1]?.color?.a);
if (combinedFills.length === 2 &&
    combinedFills[0].type === 'IMAGE' &&
    combinedFills[1].type === 'SOLID' &&
    combinedFills[1].color.a === 0.5) {
  console.log('  ✓ PASS: Both fills parsed correctly\n');
} else {
  console.log('  ✗ FAIL: Missing or incorrect fills\n');
}

// Test 3: Different opacity levels
console.log('Test 3: Different opacity levels (25%, 50%, 75%)');
const opacities = [0.25, 0.5, 0.75];
let allPass = true;
opacities.forEach(opacity => {
  const styles = createMockStyles({
    backgroundColor: `rgba(0, 0, 0, ${opacity})`,
    backgroundImage: 'none',
    color: 'rgb(0, 0, 0)'
  });
  const fills = parseBackground(styles);
  const pass = fills.length === 1 && fills[0].color.a === opacity;
  console.log(`  ${opacity * 100}% opacity:`, pass ? '✓ PASS' : '✗ FAIL');
  if (!pass) allPass = false;
});
console.log(allPass ? '  Overall: ✓ PASS\n' : '  Overall: ✗ FAIL\n');

// Test 4: Modern CSS syntax (space-separated)
console.log('Test 4: Modern CSS syntax (space-separated)');
const modernColor = parseColor('rgb(0 0 0 / 0.5)');
console.log('  Parsed color:', modernColor);
if (modernColor.r === 0 && modernColor.g === 0 && modernColor.b === 0 && modernColor.a === 0.5) {
  console.log('  ✓ PASS: Modern syntax parsed correctly\n');
} else {
  console.log('  ✗ FAIL: Modern syntax not working\n');
}

// Test 5: Fully transparent should be filtered out
console.log('Test 5: Fully transparent background (should be filtered out)');
const transparentStyles = createMockStyles({
  backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none',
  color: 'rgb(0, 0, 0)'
});
const transparentFills = parseBackground(transparentStyles);
console.log('  Fills count:', transparentFills.length);
if (transparentFills.length === 0) {
  console.log('  ✓ PASS: Fully transparent correctly filtered out\n');
} else {
  console.log('  ✗ FAIL: Transparent fill should not be added\n');
}

console.log('All tests completed!');
