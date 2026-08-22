/**
 * Unit Test Script for Exact 5-Item Handwritten Order & Matching Engine
 */

import { INITIAL_PRODUCTS } from './js/sampleData.js';

// Setup IndexedDB mock for Node.js test runner
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
        transaction: () => ({
          objectStore: () => ({
            count: () => {
              const r = { onsuccess: null, onerror: null };
              setTimeout(() => {
                r.result = INITIAL_PRODUCTS.length;
                if (r.onsuccess) r.onsuccess();
              }, 5);
              return r;
            },
            openCursor: () => {
              let idx = 0;
              const r = { onsuccess: null, onerror: null };
              const iterate = () => {
                if (idx < INITIAL_PRODUCTS.length) {
                  const val = INITIAL_PRODUCTS[idx++];
                  r.result = {
                    value: val,
                    continue: () => setTimeout(iterate, 1)
                  };
                  if (r.onsuccess) r.onsuccess({ target: r });
                } else {
                  r.result = null;
                  if (r.onsuccess) r.onsuccess({ target: r });
                }
              };
              setTimeout(iterate, 5);
              return r;
            }
          })
        })
      };
      if (req.onsuccess) req.onsuccess({ target: { result: db } });
    }, 5);
    return req;
  }
};

// Import matching engine
const { matchCustomerItem } = await import('./js/matchingEngine.js');

console.log('=== STARTING TEST FOR 5-ITEM HANDWRITTEN SLIP ===\n');

async function runTests() {
  const sampleItems = [
    { customerText: 'Teming Chain Shine BS6', quantity: 3, expectedPart: '14401K0ND00' },
    { customerText: 'Clutch Assy SPL+', quantity: 5, expectedPart: 'K22222HF100DS' },
    { customerText: 'Teming C Kit S SPL', quantity: 2, expectedPart: 'K14144KTCE900S' },
    { customerText: 'Petrol T-Cock Valve SPL', quantity: 5, expectedPart: '16950-KCC-900' },
    { customerText: 'Air Filter Element SPL/PS', quantity: 15, expectedPart: '17211-KCC-900' }
  ];

  console.log('Testing 5-item handwritten extraction matching against initial catalogue:');
  
  for (const item of sampleItems) {
    const res = await matchCustomerItem(item.customerText);
    console.log(`\nInput: "${item.customerText}" (Qty: ${item.quantity})`);
    if (res.matchedProduct) {
      console.log(`  -> MATCHED: [${res.matchedProduct.partNumber}] ${res.matchedProduct.productName} (Rack: ${res.matchedProduct.rack}, Stock: ${res.matchedProduct.stockQty}) | Conf: ${res.confidence}% (${res.tier})`);
    } else {
      console.log(`  -> NO MATCH (tier: ${res.tier}, confidence: ${res.confidence}) - Prompts [Select Manually]`);
    }
  }

  // Negative test: Unrelated query containing "SPL"
  console.log('\n--- Negative Test: Unrelated query with "SPL" ---');
  const negQuery = "Random Unknown Lever SPL";
  const negRes = await matchCustomerItem(negQuery);
  console.log(`Input: "${negQuery}"`);
  if (negRes.matchedProduct && negRes.confidence >= 50) {
    console.error(`  ✕ FAILED: Falsely matched [${negRes.matchedProduct.partNumber}] ${negRes.matchedProduct.productName}`);
  } else {
    console.log(`  ✓ PASSED: Correctly returned NO MATCH without false match.`);
  }

  console.log('\n=== ALL TESTS FINISHED ===');
}

runTests().catch(console.error);
