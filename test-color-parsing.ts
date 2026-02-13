// Test color parsing for rgba values
import { parseColor } from './packages/shared/src/converters/color-utils';

// Test cases
const testCases = [
  'rgba(0, 0, 0, 0.5)',
  'rgba(0,0,0,0.5)',
  'rgb(0 0 0 / 0.5)',
  'rgb(0 0 0 / 50%)',
  'rgba(0 0 0 / 0.5)',
];

console.log('Testing color parsing:');
testCases.forEach(color => {
  const parsed = parseColor(color);
  console.log(`${color} => r:${parsed.r}, g:${parsed.g}, b:${parsed.b}, a:${parsed.a}`);
});
