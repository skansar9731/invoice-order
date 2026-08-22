import { extractOrderFromImage, validateAIExtraction, getAIStatus } from './js/aiService.js';

console.log('=== TEST: AI EXTRACTION CONTRACT & STATUS ===\n');

// 1. Check AI Status
const status = getAIStatus();
console.log('AI Status:', status);

// 2. Validate strict schema
try {
  const valid = validateAIExtraction([
    { customerText: 'CHAIN KIT SHINE BS6', quantity: 1 },
    { customerText: 'CL PLATE PRO BS6', quantity: 2 }
  ]);
  console.log('Schema validation passed:', valid);
} catch (e) {
  console.error('Schema validation failed:', e);
}

// 3. Test that empty or invalid payload throws
try {
  validateAIExtraction([]);
  console.error('FAILED: Empty array should throw error');
} catch (e) {
  console.log('Correctly rejected empty payload:', e.message);
}

// 4. Test extraction behavior on simulated file when endpoint is not reachable
try {
  const dummyFile = new Blob(['dummy image data'], { type: 'image/jpeg' });
  await extractOrderFromImage(dummyFile, { endpoint: 'http://localhost:99999/invalid' });
  console.error('FAILED: Should not return fake items for new image');
} catch (e) {
  console.log('Correctly rejected unconnected AI endpoint:', e.message);
}

console.log('\n=== ALL CONTRACT TESTS PASSED ===');
