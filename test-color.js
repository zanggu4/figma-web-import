// Test color parsing
const colorUtils = require('./packages/shared/src/converters/color-utils.ts');

const testColors = [
  'rgb(255, 255, 255)',
  'rgb(255,255,255)',
  'rgba(255, 255, 255, 1)',
  'rgba(255,255,255,1)',
  'white',
  '#ffffff',
  '#fff',
];

testColors.forEach(color => {
  console.log(`Input: "${color}"`);
  const parsed = colorUtils.parseColor(color);
  console.log('  Parsed:', parsed);
  console.log('');
});
