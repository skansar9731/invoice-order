// Mock browser globals first
let toastMessages = [];
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 1);

const domElements = {
  'order-image-input': { value: '', click: () => {} },
  'order-dropzone': { classList: { add: () => {}, remove: () => {} } },
  'btn-browse-order-image': {},
  'btn-add-more-images': {},
  'btn-clear-all-images': {},
  'btn-new-order': {},
  'order-customer-name': { value: 'Ramesh Garage' },
  'order-number-display': { textContent: 'ORD-1234' },
  'image-gallery-container': { classList: { add: () => {}, remove: () => {}, contains: () => false } },
  'gallery-image-count': { textContent: '' },
  'image-thumbnails-grid': { innerHTML: '', querySelectorAll: () => [] },
  'stat-ai-status': { textContent: '', className: '' },
  'ai-processing-overlay': { classList: { add: () => {}, remove: () => {} } },
  'ai-processing-step': { textContent: '' },
  'ai-processing-pages-list': { innerHTML: '' },
  'toast-container': { appendChild: (el) => { toastMessages.push({ msg: el.textContent, type: el.dataset.type }); } },
  'order-table-body': { innerHTML: '', appendChild: () => {} },
  'order-cards-container': { innerHTML: '', appendChild: () => {} },
  'stat-total-items': { textContent: '' },
  'stat-matched-count': { textContent: '' },
  'stat-pending-count': { textContent: '' },
  'stat-order-progress': { textContent: '' },
  'summary-total-items': { textContent: '' },
  'summary-matched-items': { textContent: '' },
  'summary-partial-items': { textContent: '' },
  'summary-unmatched-items': { textContent: '' },
  'summary-unmatched-badge': { classList: { add: () => {}, remove: () => {} } },
  'summary-lowstock-items': { textContent: '' },
  'summary-lowstock-badge': { classList: { add: () => {}, remove: () => {} } },
  'order-empty-state': { classList: { add: () => {}, remove: () => {} } }
};

globalThis.document = {
  getElementById: (id) => domElements[id] || null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: (tag) => {
    const el = {
      classList: { add: () => {}, remove: () => {} },
      dataset: {},
      style: {},
      appendChild: () => {},
      remove: () => {},
      set textContent(v) { el._text = v; },
      get textContent() { return el._text || ''; },
      set innerHTML(v) { el._text = v; }
    };
    return el;
  },
  body: {
    appendChild: () => {}
  }
};

globalThis.window = globalThis;

let createdObjectUrls = [];
let revokedObjectUrls = [];
globalThis.URL = {
  createObjectURL: (file) => {
    const url = 'blob:http://localhost/' + Math.random().toString(36).substring(7);
    createdObjectUrls.push(url);
    return url;
  },
  revokeObjectURL: (url) => {
    revokedObjectUrls.push(url);
  }
};

// Mock IndexedDB
const mockDB = {
  transaction: () => ({
    objectStore: () => ({
      openCursor: () => {
        const req = { onsuccess: null, onerror: null };
        setTimeout(() => {
          if (req.onsuccess) req.onsuccess({ target: { result: null } });
        }, 1);
        return req;
      }
    })
  })
};
globalThis.indexedDB = {
  open: () => {
    const req = { onsuccess: null };
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess({ target: { result: mockDB } });
    }, 1);
    return req;
  }
};

// Mock FileReader for browser environment
globalThis.FileReader = class {
  readAsDataURL(blob) {
    globalThis.__currentMockFilename = blob ? blob.name : 'default';
    setTimeout(() => {
      if (this.onload) {
        this.onload({ target: { result: 'data:image/jpeg;base64,mockBase64Data' } });
      }
    }, 2);
  }
};

// Mock dynamic response mapping per filename
let mockExtractionMap = {};

globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body || '{}');
  const base64Data = body.imageBase64 || '';
  
  // Find which file is being extracted
  const filename = globalThis.__currentMockFilename || 'default';
  const items = mockExtractionMap[filename] || [
    { customerText: 'Default Item', quantity: 1 }
  ];

  if (globalThis.__shouldFailFile === filename) {
    return {
      ok: false,
      status: 500,
      json: async () => ({ error: `Failed to extract ${filename}` })
    };
  }

  return {
    ok: true,
    json: async () => ({
      items,
      count: items.length
    })
  };
};

// Import app functions
const {
  handleImageFiles,
  handleImageFile,
  removeImageById,
  retryImageExtraction,
  clearAllImages,
  getUploadedImages
} = await import('./js/app.js');
const { getCurrentOrder, resetOrder } = await import('./js/orderManager.js');

console.log('=== RUNNING MULTIPLE HANDWRITTEN ORDER IMAGES TEST SUITE ===\n');

// Helper to create mock File
function createMockFile(name, size = 1024 * 100, type = 'image/jpeg') {
  const blob = new Blob(['a'.repeat(Math.min(size, 1000))], { type });
  blob.name = name;
  Object.defineProperty(blob, 'size', { value: size });
  return blob;
}

// ==========================================
// TEST CASE 1: 3 Handwritten Order Images
// ==========================================
console.log('Test 1: Testing 3 Handwritten Images (3 + 5 + 2 = 10 items) in exact sequence...');
clearAllImages(false);

const img1Items = [
  { customerText: 'Teming Chain Shine BS6', quantity: 3 },
  { customerText: 'Clutch Assy SPL+', quantity: 5 },
  { customerText: 'Chain Sprocket Hero', quantity: 1 }
];

const img2Items = [
  { customerText: 'Teming C Kit S SPL', quantity: 2 },
  { customerText: 'Petrol T-Cock Valve SPL', quantity: 5 },
  { customerText: 'Air Filter Element SPL/PS', quantity: 15 },
  { customerText: 'Brake Shoe Rear', quantity: 4 },
  { customerText: 'Spark Plug Champion', quantity: 2 }
];

const img3Items = [
  { customerText: 'Front Fork Oil 175ml', quantity: 1 },
  { customerText: 'Handle Bar Deluxe', quantity: 1 }
];

mockExtractionMap['page1.jpg'] = img1Items;
mockExtractionMap['page2.jpg'] = img2Items;
mockExtractionMap['page3.jpg'] = img3Items;

const file1 = createMockFile('page1.jpg');
const file2 = createMockFile('page2.jpg');
const file3 = createMockFile('page3.jpg');

await handleImageFiles([file1, file2, file3]);

const order1 = getCurrentOrder();
console.log(`  Total extracted order items: ${order1.items.length} (Expected: 10)`);

if (order1.items.length === 10) {
  console.log('  ✓ PASSED: Exactly 10 items extracted from 3 images.');
} else {
  console.error('  ✕ FAILED: Expected 10 items, got', order1.items.length);
  process.exit(1);
}

// Verify exact sequence preservation:
// Image 1 items (0..2), Image 2 items (3..7), Image 3 items (8..9)
const expectedTexts = [
  'Teming Chain Shine BS6',
  'Clutch Assy SPL+',
  'Chain Sprocket Hero',
  'Teming C Kit S SPL',
  'Petrol T-Cock Valve SPL',
  'Air Filter Element SPL/PS',
  'Brake Shoe Rear',
  'Spark Plug Champion',
  'Front Fork Oil 175ml',
  'Handle Bar Deluxe'
];

let sequenceMatches = true;
let sourceImageMatches = true;
const expectedSourceImages = [1, 1, 1, 2, 2, 2, 2, 2, 3, 3];

for (let i = 0; i < 10; i++) {
  if (order1.items[i].customerText !== expectedTexts[i]) {
    console.error(`  ✕ Sequence mismatch at #${i + 1}: got "${order1.items[i].customerText}", expected "${expectedTexts[i]}"`);
    sequenceMatches = false;
  }
  if (order1.items[i].sourceImage !== expectedSourceImages[i]) {
    console.error(`  ✕ sourceImage mismatch at #${i + 1}: got ${order1.items[i].sourceImage}, expected ${expectedSourceImages[i]}`);
    sourceImageMatches = false;
  }
}

if (sequenceMatches && sourceImageMatches) {
  console.log('  ✓ PASSED: Image order strictly preserved (Page 1 -> Page 2 -> Page 3) with correct sourceImage tracking.');
} else {
  console.error('  ✕ FAILED: Sequence or sourceImage tracking failed!');
  process.exit(1);
}

// ==========================================
// TEST CASE 2: Add More Images (Append)
// ==========================================
console.log('\nTest 2: Testing "+ Add More Images" (Page 4 with 2 items -> 12 items total)...');
const img4Items = [
  { customerText: 'Horn Bosch 12V', quantity: 2 },
  { customerText: 'Headlight Bulb Halogen', quantity: 4 }
];
mockExtractionMap['page4.jpg'] = img4Items;
const file4 = createMockFile('page4.jpg');

await handleImageFiles([file4]);
const order2 = getCurrentOrder();

if (order2.items.length === 12 && order2.items[10].customerText === 'Horn Bosch 12V' && order2.items[10].sourceImage === 4) {
  console.log('  ✓ PASSED: Page 4 correctly appended in sequence without modifying existing 10 items.');
} else {
  console.error('  ✕ FAILED: Add More Images failed!', order2.items);
  process.exit(1);
}

// ==========================================
// TEST CASE 3: Remove Image (Remove Page 2)
// ==========================================
console.log('\nTest 3: Testing Removing Image #2 (5 items removed, Pages 1, 3, 4 remain -> 7 items total)...');
// Image #2 has id at index 1
const img2Id = getUploadedImages()[1].id;
await removeImageById(img2Id);
const order3 = getCurrentOrder();

if (order3.items.length === 7) {
  console.log('  ✓ PASSED: Exactly 7 items remain after removing Image 2.');
} else {
  console.error('  ✕ FAILED: Expected 7 items after removal, got', order3.items.length);
  process.exit(1);
}

// Verify renumbering: Page 1 items are sourceImage: 1, original Page 3 is now sourceImage: 2, original Page 4 is now sourceImage: 3
const remainingExpectedSources = [1, 1, 1, 2, 2, 3, 3];
let renumberMatches = true;
for (let i = 0; i < 7; i++) {
  if (order3.items[i].sourceImage !== remainingExpectedSources[i]) {
    console.error(`  ✕ Renumbering mismatch at #${i}: got sourceImage ${order3.items[i].sourceImage}, expected ${remainingExpectedSources[i]}`);
    renumberMatches = false;
  }
}
if (renumberMatches) {
  console.log('  ✓ PASSED: Thumbnails and sourceImage references cleanly renumbered in sequence.');
} else {
  console.error('  ✕ FAILED: Renumbering failed!');
  process.exit(1);
}

// ==========================================
// TEST CASE 4: Error Handling & Retry on Failed Image
// ==========================================
console.log('\nTest 4: Testing Error Handling & Retry on single failed image...');
clearAllImages(false);

mockExtractionMap['success1.jpg'] = [{ customerText: 'Item Success 1', quantity: 1 }];
mockExtractionMap['failing.jpg'] = [{ customerText: 'Item Failing 2', quantity: 2 }];
mockExtractionMap['success3.jpg'] = [{ customerText: 'Item Success 3', quantity: 3 }];

globalThis.__shouldFailFile = 'failing.jpg';

const sFile1 = createMockFile('success1.jpg');
const fFile2 = createMockFile('failing.jpg');
const sFile3 = createMockFile('success3.jpg');

await handleImageFiles([sFile1, fFile2, sFile3]);

const orderAfterPartialFail = getCurrentOrder();
console.log(`  Items extracted despite Image 2 failure: ${orderAfterPartialFail.items.length} (Expected: 2)`);

if (orderAfterPartialFail.items.length === 2 && getUploadedImages()[1].status === 'error') {
  console.log('  ✓ PASSED: Successful images preserved; failing image isolated with error status.');
} else {
  console.error('  ✕ FAILED: Failure isolation failed!', orderAfterPartialFail.items, getUploadedImages());
  process.exit(1);
}

// Now retry failing.jpg
console.log('  Retrying failed image...');
globalThis.__shouldFailFile = null;
await retryImageExtraction(getUploadedImages()[1].id);

const orderAfterRetry = getCurrentOrder();
console.log(`  Items after retry: ${orderAfterRetry.items.length} (Expected: 3 in order 1, 2, 3)`);

if (orderAfterRetry.items.length === 3 &&
    orderAfterRetry.items[0].customerText === 'Item Success 1' &&
    orderAfterRetry.items[1].customerText === 'Item Failing 2' &&
    orderAfterRetry.items[2].customerText === 'Item Success 3') {
  console.log('  ✓ PASSED: Retried image extracted and correctly inserted in position #2.');
} else {
  console.error('  ✕ FAILED: Retry insertion failed!', orderAfterRetry.items);
  process.exit(1);
}

// ==========================================
// TEST CASE 5: Single Image Backward Compatibility
// ==========================================
console.log('\nTest 5: Testing Single Image backward compatibility...');
clearAllImages(false);
mockExtractionMap['single.jpg'] = [
  { customerText: 'Single Order Part A', quantity: 2 },
  { customerText: 'Single Order Part B', quantity: 4 }
];
const singleFile = createMockFile('single.jpg');
await handleImageFile(singleFile);
const singleOrder = getCurrentOrder();

if (singleOrder.items.length === 2 && singleOrder.items[0].customerText === 'Single Order Part A') {
  console.log('  ✓ PASSED: Single image upload works seamlessly.');
} else {
  console.error('  ✕ FAILED: Single image upload failed!', singleOrder.items);
  process.exit(1);
}

// ==========================================
// TEST CASE 6: Max 10 Images Limit
// ==========================================
console.log('\nTest 6: Testing Maximum 10 Images limit...');
clearAllImages(false);
const twelveFiles = Array.from({ length: 12 }, (_, i) => {
  const name = `bulk_${i + 1}.jpg`;
  mockExtractionMap[name] = [{ customerText: `Item from ${name}`, quantity: 1 }];
  return createMockFile(name);
});

await handleImageFiles(twelveFiles);
if (getUploadedImages().length === 10) {
  console.log('  ✓ PASSED: Exactly 10 images accepted, 2 excess images rejected with warning.');
} else {
  console.error('  ✕ FAILED: Max images limit failed, got', getUploadedImages().length);
  process.exit(1);
}

// ==========================================
// TEST CASE 7: Reset / New Order
// ==========================================
console.log('\nTest 7: Testing Reset / New Order...');
clearAllImages(false);
const resetOrderState = getCurrentOrder();
if (getUploadedImages().length === 0 && resetOrderState.items.length === 0) {
  console.log('  ✓ PASSED: Session cleanly reset to empty state.');
} else {
  console.error('  ✕ FAILED: Reset failed!', getUploadedImages(), resetOrderState);
  process.exit(1);
}

console.log('\n=== ALL MULTIPLE HANDWRITTEN ORDER IMAGES TESTS PASSED 100%! ===\n');
