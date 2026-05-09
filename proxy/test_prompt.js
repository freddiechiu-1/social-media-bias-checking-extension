import { analyze } from './analyze.js';

const input = process.argv.slice(2).join(' ');
if (!input) {
  console.error('usage: node test_prompt.js "<tweet text or URL>"');
  process.exit(1);
}

console.log('Analyzing:', input.slice(0, 80) + (input.length > 80 ? '...' : ''));
console.log('---');

try {
  const out = await analyze(input);
  console.log(JSON.stringify(out, null, 2));
} catch (err) {
  console.error('ERROR:', err.message);
  process.exit(1);
}
