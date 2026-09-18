import { INITIAL_PRODUCTS } from './js/sampleData.js';

console.log('=== TESTING PRODUCT SEARCH BY GROUP ===\n');

const storeMap = new Map();
INITIAL_PRODUCTS.forEach(p => storeMap.set(p.partNumber, p));

globalThis.indexedDB = {
  open: () => {
    const req = { onsuccess: null, onerror: null };
    setTimeout(() => {
      const db = {
        objectStoreNames: { contains: () => true },
        transaction: () => ({
          objectStore: () => ({
            openCursor: () => {
              const r = { onsuccess: null, onerror: null };
              const entries = Array.from(storeMap.values());
              let idx = 0;
              setTimeout(() => {
                const step = () => {
                  if (idx < entries.length) {
                    const cursor = {
                      value: entries[idx++],
                      continue: () => setTimeout(step, 1)
                    };
                    if (r.onsuccess) r.onsuccess({ target: { result: cursor } });
                  } else {
                    if (r.onsuccess) r.onsuccess({ target: { result: null } });
                  }
                };
                step();
              }, 2);
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

const { searchLocalProducts, invalidateSearchCache } = await import('./js/productSearch.js');

invalidateSearchCache();

const heroSearch = await searchLocalProducts('HERO', 50);
console.log(`Searching "HERO": found ${heroSearch.items.length} items`);
if (heroSearch.items.length === 0) {
  console.error('✕ FAILED: Searching for "HERO" returned 0 results!');
  process.exit(1);
}

const castrolSearch = await searchLocalProducts('CASTROL', 10);
console.log(`Searching "CASTROL": found ${castrolSearch.items.length} items`);
if (castrolSearch.items.length === 0 || (castrolSearch.items[0].group !== 'CASTROL' && castrolSearch.items[0].parentGroup !== 'CASTROL')) {
  console.error('✕ FAILED: Searching for "CASTROL" did not return Castrol group items!');
  process.exit(1);
}

console.log('✓ PASSED: Search by group ("HERO", "CASTROL") functions accurately.');
console.log('\n=== ALL SEARCH TESTS PASSED! ===\n');
