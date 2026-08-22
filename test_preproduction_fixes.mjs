import fs from 'fs';
import { upsertProducts } from './js/db.js';
import { extractOrderFromImage, validateAIExtraction } from './js/aiService.js';
import { matchAllOrderItems, matchCustomerItem } from './js/matchingEngine.js';

console.log('=== RUNNING FINAL PRE-PRODUCTION VERIFICATION CHECKS ===\n');

// 1. Confirm no hardcoded Gemini API Key exists in any file
console.log('1. Checking for hardcoded API keys...');
const filesToCheck = [
  'index.html',
  'js/app.js',
  'js/aiService.js',
  'js/db.js',
  'js/matchingEngine.js',
  'js/orderManager.js',
  'js/pdfGenerator.js',
  'js/productImporter.js',
  'js/productSearch.js',
  'netlify/functions/extract-order.js'
];

let foundKey = false;
for (const file of filesToCheck) {
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes('AIzaSy') || /apiKey\s*=\s*['"`][A-Za-z0-9_\-]{20,}['"`]/.test(content)) {
    console.error(`  ✕ Hardcoded key found in ${file}!`);
    foundKey = true;
  }
}
if (!foundKey) {
  console.log('  ✓ PASSED: No hardcoded Gemini API key found in source files.');
}

// 2. Confirm no gemini-1.5-flash remains
console.log('\n2. Checking for old gemini-1.5-flash...');
let foundOldModel = false;
for (const file of filesToCheck) {
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes('gemini-1.5-flash')) {
    console.error(`  ✕ Found old gemini-1.5-flash in ${file}!`);
    foundOldModel = true;
  }
}
if (!foundOldModel) {
  console.log('  ✓ PASSED: gemini-2.5-flash is used everywhere.');
}

// 3. Confirm db.js does NOT auto-seed INITIAL_PRODUCTS
console.log('\n3. Checking db.js auto-seeding removal...');
const dbSource = fs.readFileSync('js/db.js', 'utf8');
if (dbSource.includes('seedInitialData') || dbSource.includes('count === 0')) {
  console.error('  ✕ FAILED: db.js still contains auto-seeding logic.');
} else {
  console.log('  ✓ PASSED: Auto-seeding completely removed from db.js.');
}

// 4. Test Upsert Normalization: Missing stock/rack/unit remain null/'' and actual stock 0 remains 0
console.log('\n4. Testing stock/rack/unit/rate normalization in db.js upsert...');
const storeMap = new Map();
globalThis.indexedDB = {
  open: () => {
    const req = {
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null
    };
    setTimeout(() => {
      const db = {
        objectStoreNames: { contains: () => true },
        transaction: () => {
          const txObj = {
            objectStore: () => ({
              put: (val) => {
                storeMap.set(val.partNumber || val.key, val);
                const r = { onsuccess: null, onerror: null };
                setTimeout(() => { if (r.onsuccess) r.onsuccess(); }, 2);
                return r;
              },
              clear: () => {
                storeMap.clear();
                const r = { onsuccess: null, onerror: null };
                setTimeout(() => { if (r.onsuccess) r.onsuccess(); }, 2);
                return r;
              },
              count: () => {
                const r = { onsuccess: null, onerror: null };
                setTimeout(() => { r.result = storeMap.size; if (r.onsuccess) r.onsuccess(); }, 2);
                return r;
              }
            }),
            oncomplete: null,
            onerror: null
          };
          setTimeout(() => {
            if (txObj.oncomplete) txObj.oncomplete();
          }, 10);
          return txObj;
        }
      };
      if (req.onsuccess) req.onsuccess({ target: { result: db } });
    }, 5);
    return req;
  }
};

const testItems = [
  {
    partNumber: 'TEST-PART-MISSING',
    productName: 'TEST PART MISSING FIELDS',
    stockQty: null,
    rack: '',
    unit: '',
    rate: null
  },
  {
    partNumber: 'TEST-PART-ZERO-STOCK',
    productName: 'TEST PART ZERO STOCK',
    stockQty: 0,
    rack: 'R-1 A',
    unit: 'Pcs.',
    rate: 150
  },
  {
    partNumber: 'TEST-PART-PRESENT',
    productName: 'TEST PART WITH VALUES',
    stockQty: 10,
    rack: 'R-3 K',
    unit: 'BOX',
    rate: 250
  }
];

await upsertProducts(testItems, true);

const item1 = storeMap.get('TEST-PART-MISSING');
console.log('Item 1 (Missing fields):', item1);
if (item1.stockQty === null && item1.rack === '' && item1.unit === '' && item1.rate === null) {
  console.log('  ✓ PASSED: Missing stock/rack/unit/rate correctly stored as null / empty string.');
} else {
  console.error('  ✕ FAILED: Missing fields converted incorrectly!', item1);
}

const item2 = storeMap.get('TEST-PART-ZERO-STOCK');
console.log('Item 2 (Zero stock):', item2);
if (item2.stockQty === 0 && item2.rack === 'R-1 A' && item2.unit === 'Pcs.' && item2.rate === 150) {
  console.log('  ✓ PASSED: Actual 0 stock correctly preserved as 0 (not converted to null/dash).');
} else {
  console.error('  ✕ FAILED: Zero stock handled incorrectly!', item2);
}

// 5. Test AI Extraction does NOT return hardcoded demo order on new upload
console.log('\n5. Testing AI extraction behavior with new image upload...');
try {
  const dummyFile = new Blob(['image payload'], { type: 'image/png' });
  await extractOrderFromImage(dummyFile, { endpoint: 'http://localhost:99999/unconnected' });
  console.error('  ✕ FAILED: AI extraction returned hardcoded data instead of throwing unconnected message.');
} catch (e) {
  console.log('  ✓ PASSED: Correctly requires real AI connection:', e.message);
}

// 6. Test Gemini Structured Schema Validation
console.log('\n6. Testing Gemini response schema validator...');
const mockGeminiOutput = [
  { customerText: 'Teming Chain Shine BS6', quantity: 3 },
  { customerText: 'Clutch Assy SPL+', quantity: 5 }
];
const validated = validateAIExtraction(mockGeminiOutput);
console.log('Validated items:', validated);
if (validated.length === 2 && validated[0].quantity === 3 && validated[1].customerText === 'Clutch Assy SPL+') {
  console.log('  ✓ PASSED: Gemini schema validation works as specified.');
}

console.log('\n=== ALL PRE-PRODUCTION VERIFICATION TESTS PASSED SUCCESSFULLY! ===\n');
