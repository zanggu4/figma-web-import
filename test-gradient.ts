import { parseGradient } from './packages/shared/src/converters/color-utils';

// Test case: gradient with rgba() colors
const testGradient = 'linear-gradient(to right, rgba(255,0,0,0.5), rgba(0,0,255,0.5))';

console.log('Testing gradient:', testGradient);
const result = parseGradient(testGradient);

if (result) {
  console.log('\nParsed successfully!');
  console.log('Type:', result.type);
  console.log('Angle:', result.angle);
  console.log('Stops:');
  result.stops.forEach((stop, idx) => {
    console.log(`  Stop ${idx}: position=${stop.position}, r=${stop.color.r}, g=${stop.color.g}, b=${stop.color.b}, a=${stop.color.a}`);
  });
} else {
  console.log('ERROR: Failed to parse gradient');
}
