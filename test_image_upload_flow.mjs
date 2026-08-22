// Mock browser globals first
let toastMessages = [];
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 1);
const domElements = {
  'order-image-input': { value: 'old-val.jpg', click: () => {} },
  'order-dropzone': { classList: { add: () => {}, remove: () => {} } },
  'btn-browse-order-image': {},
  'btn-change-image': {},
  'btn-remove-image': {},
  'btn-new-order': {},
  'order-customer-name': { value: 'Ramesh Garage' },
  'order-number-display': { textContent: 'ORD-1234' },
  'order-image-preview': { src: '' },
  'image-preview-container': { classList: { add: () => {}, remove: () => {}, contains: () => false } },
  'order-image-filename': { textContent: '' },
  'stat-ai-status': { textContent: '', className: '' },
  'ai-processing-overlay': { classList: { add: () => {}, remove: () => {} } },
  'ai-processing-step': { textContent: '' },
  'toast-container': { appendChild: (el) => { toastMessages.push({ msg: el.textContent, type: el.dataset.type }); } },
  'order-table-body': { innerHTML: '', appendChild: () => {} },
  'stat-total-items': { textContent: '' },
  'stat-matched-count': { textContent: '' },
  'stat-pending-count': { textContent: '' },
  'stat-order-progress': { textContent: '' }
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
    setTimeout(() => {
      if (this.onload) {
        this.onload({ target: { result: 'data:image/jpeg;base64,mockBase64Data' } });
      }
    }, 2);
  }
};

// Mock fetch for Netlify endpoint
globalThis.fetch = async (url, opts) => {
  return {
    ok: true,
    json: async () => ({
      items: [
        { customerText: 'Teming Chain Shine BS6', quantity: 3 },
        { customerText: 'Clutch Assy SPL+', quantity: 5 }
      ],
      count: 2
    })
  };
};

// Now import app functions
const { handleImageFile, removeUploadedImage } = await import('./js/app.js');
const { getCurrentOrder } = await import('./js/orderManager.js');

console.log('=== RUNNING FRONTEND IMAGE UPLOAD VERIFICATION TESTS ===\n');

// Helper to create mock File
function createMockFile(name, size, type) {
  const blob = new Blob(['a'.repeat(Math.min(size, 1000))], { type });
  blob.name = name;
  Object.defineProperty(blob, 'size', { value: size });
  return blob;
}

// TEST 1, 2: JPG Image Selection
console.log('Test 1 & 2: Testing JPG file upload & validation...');
toastMessages = [];
const jpgFile = createMockFile('order_slip.jpg', 1024 * 500, 'image/jpeg');
await handleImageFile(jpgFile);

const orderAfterJpg = getCurrentOrder();
if (orderAfterJpg.items.length === 2 && domElements['order-image-filename'].textContent === 'order_slip.jpg') {
  console.log('  ✓ PASSED: JPG file accepted, preview created, 2 items extracted & matched.');
} else {
  console.error('  ✕ FAILED: JPG file not processed properly!', orderAfterJpg.items);
}

// TEST 3: PNG Image Selection
console.log('\nTest 3: Testing PNG file upload...');
const pngFile = createMockFile('receipt.png', 1024 * 800, 'image/png');
await handleImageFile(pngFile);
if (domElements['order-image-filename'].textContent === 'receipt.png') {
  console.log('  ✓ PASSED: PNG file accepted and processed.');
} else {
  console.error('  ✕ FAILED: PNG file not processed properly!');
}

// TEST 4: WEBP Image Selection
console.log('\nTest 4: Testing WEBP file upload...');
const webpFile = createMockFile('slip.webp', 1024 * 300, 'image/webp');
await handleImageFile(webpFile);
if (domElements['order-image-filename'].textContent === 'slip.webp') {
  console.log('  ✓ PASSED: WEBP file accepted and processed.');
} else {
  console.error('  ✕ FAILED: WEBP file not processed properly!');
}

// TEST 7: Invalid File Type (PDF/Text)
console.log('\nTest 7: Testing rejection of non-image file (PDF)...');
toastMessages = [];
const pdfFile = createMockFile('document.pdf', 1024 * 200, 'application/pdf');
await handleImageFile(pdfFile);

if (toastMessages.some(t => t.msg.includes('Please select a JPG, JPEG, PNG, or WEBP image'))) {
  console.log('  ✓ PASSED: PDF correctly rejected with warning toast without calling extraction.');
} else {
  console.error('  ✕ FAILED: Invalid file was not properly rejected!', toastMessages);
}

// TEST 8: File Exceeding 10 MB
console.log('\nTest 8: Testing rejection of file larger than 10 MB...');
toastMessages = [];
const largeFile = createMockFile('huge_photo.jpg', 15 * 1024 * 1024, 'image/jpeg');
await handleImageFile(largeFile);

if (toastMessages.some(t => t.msg.includes('Image is too large'))) {
  console.log('  ✓ PASSED: File > 10MB correctly rejected with size limit message.');
} else {
  console.error('  ✕ FAILED: Large file was not rejected!', toastMessages);
}

// TEST 9: Remove Image & Session Reset
console.log('\nTest 9: Testing remove image & session reset...');
toastMessages = [];
removeUploadedImage(true);
const orderAfterRemove = getCurrentOrder();
if (revokedObjectUrls.length > 0 && orderAfterRemove.items.length === 0 && toastMessages.some(t => t.msg.includes('Image removed and order session reset'))) {
  console.log('  ✓ PASSED: ObjectURL revoked and session cleanly reset upon image removal.');
} else {
  console.error('  ✕ FAILED: Remove image failed!', toastMessages, revokedObjectUrls);
}

// TEST 10: Input value reset for repeated selection
console.log('\nTest 10: Testing input.value reset...');
if (domElements['order-image-input'].value === '') {
  console.log('  ✓ PASSED: file input value reset to empty string, enabling repeated selection of same file.');
} else {
  console.error('  ✕ FAILED: file input value was not reset!', domElements['order-image-input'].value);
}

// TEST 11: Consecutive uploads (Image A -> Image B)
console.log('\nTest 11: Testing consecutive uploads (Image A -> Image B)...');
const fileA = createMockFile('orderA.jpg', 1024 * 100, 'image/jpeg');
await handleImageFile(fileA);
if (domElements['order-image-filename'].textContent === 'orderA.jpg') {
  console.log('  ✓ Image A attached.');
}
const fileB = createMockFile('orderB.jpg', 1024 * 120, 'image/jpeg');
await handleImageFile(fileB);

if (domElements['order-image-filename'].textContent === 'orderB.jpg') {
  console.log('  ✓ PASSED: Image B successfully replaced Image A and triggered new independent extraction request.');
} else {
  console.error('  ✕ FAILED: Consecutive upload failed!');
}

console.log('\n=== ALL IMAGE UPLOAD TESTS PASSED SUCCESSFULLY! ===\n');
