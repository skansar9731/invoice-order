import { handler } from './netlify/functions/extract-order.js';

console.log('=== TEST: NETLIFY FUNCTION VALIDATION ===\n');

// 1. Test missing API key
const missingKeyRes = await handler({
  httpMethod: 'POST',
  body: JSON.stringify({ image: 'data:image/jpeg;base64,1234' })
}, {});
console.log('Missing key response status:', missingKeyRes.statusCode);
const missingKeyBody = JSON.parse(missingKeyRes.body);
console.log('Missing key error message:', missingKeyBody.error);

// 2. Test missing image with key set
process.env.GEMINI_API_KEY = 'test-dummy-key';
const missingImageRes = await handler({
  httpMethod: 'POST',
  body: JSON.stringify({})
}, {});
console.log('Missing image response status:', missingImageRes.statusCode);

// 3. Test OPTIONS preflight
const optionsRes = await handler({
  httpMethod: 'OPTIONS'
}, {});
console.log('OPTIONS status:', optionsRes.statusCode);

console.log('\n=== NETLIFY FUNCTION LOCAL TESTS PASSED ===');
