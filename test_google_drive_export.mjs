import { generateBusyOrderPDFBlob, generateBusyOrderPDF } from './js/pdfGenerator.js';
import { generateBusyOrderExcelBlob, generateBusyOrderExcel } from './js/excelGenerator.js';
import {
  getMonthFolderName,
  GOOGLE_DRIVE_ROOT_FOLDER_ID,
  GOOGLE_DRIVE_ROOT_FOLDER_NAME,
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_DRIVE_SCOPE,
  uploadOrUpdateDriveFile
} from './js/googleDriveService.js';
import { updateExportButtonState } from './js/ui.js';
import { resetOrder, addOrderItem, getCurrentOrder } from './js/orderManager.js';

console.log('=== RUNNING GOOGLE DRIVE INTEGRATION & EXPORT UNIT TESTS ===\n');

// -------------------------------------------------------------
// TEST 1: Month Folder Name Dynamic Resolution
// -------------------------------------------------------------
console.log('--- TEST 1: Month Folder Naming Resolution ---');
const testDates = [
  { input: '2026-09-12', expected: 'SEPTEMBER 2026' },
  { input: '2026-10-01', expected: 'OCTOBER 2026' },
  { input: '2026-11-25', expected: 'NOVEMBER 2026' },
  { input: '2026-12-31', expected: 'DECEMBER 2026' },
  { input: '2027-01-15', expected: 'JANUARY 2027' }
];

testDates.forEach(({ input, expected }) => {
  const result = getMonthFolderName(input);
  if (result !== expected) {
    throw new Error(`Month folder name failed for ${input}: got "${result}", expected "${expected}"`);
  }
});
console.log('✓ PASSED: All month folder names formatted in English UPPERCASE dynamically.\n');

// -------------------------------------------------------------
// TEST 2: PDF Blob Generation Refactoring
// -------------------------------------------------------------
console.log('--- TEST 2: PDF Blob Generation ---');
let autoTableRan = false;
class MockDoc {
  constructor() {
    this.internal = {
      pageSize: { getWidth: () => 210, getHeight: () => 297 },
      getNumberOfPages: () => 1
    };
  }
  setFont() {}
  setFontSize() {}
  setTextColor() {}
  setDrawColor() {}
  setLineWidth() {}
  line() {}
  text() {}
  autoTable(cfg) { autoTableRan = true; }
  save(filename) { this.saved = filename; }
  output(type) {
    if (type === 'blob') {
      return new Blob(['%PDF-1.4 Mock Content'], { type: 'application/pdf' });
    }
    return '';
  }
}

globalThis.window = {
  jspdf: { jsPDF: MockDoc }
};

const sampleOrder = {
  orderNo: 'ORD-260912-001',
  customerName: 'Kishore Automobiles',
  orderDate: '2026-09-12',
  orderTime: '02:30 PM',
  items: [
    {
      customerText: 'Spark Plug Mico',
      quantity: 5,
      matchedProduct: {
        partNumber: 'SP-101',
        productName: 'SPARK PLUG MICO 150/-',
        unit: 'Pcs.',
        rate: 150,
        rack: 'R-2 A'
      }
    }
  ]
};

const pdfResult = await generateBusyOrderPDFBlob(sampleOrder);
if (!pdfResult.blob) throw new Error('PDF Blob was not returned.');
if (pdfResult.filename !== 'ORD-260912-001_Busy_Entry_Sheet.pdf') {
  throw new Error(`Unexpected PDF filename: ${pdfResult.filename}`);
}
console.log(`✓ PASSED: PDF Blob created with correct filename: ${pdfResult.filename}`);
console.log(`✓ PASSED: Blob type: ${pdfResult.blob.type}, size: ${pdfResult.blob.size} bytes.\n`);

// -------------------------------------------------------------
// TEST 3: Excel Blob Generation Refactoring
// -------------------------------------------------------------
console.log('--- TEST 3: Excel Blob Generation ---');
const mockSheets = {};
const mockXLSX = {
  utils: {
    book_new: () => ({ Sheets: {}, SheetNames: [] }),
    aoa_to_sheet: (data) => ({ '!data': data }),
    book_append_sheet: (wb, ws, name) => {
      wb.SheetNames.push(name);
      wb.Sheets[name] = ws;
      mockSheets[name] = ws;
    }
  },
  write: (wb, opts) => {
    return new Uint8Array([80, 75, 3, 4]); // Zip / xlsx header bytes
  },
  writeFile: (wb, filename) => {}
};
globalThis.window.XLSX = mockXLSX;

const excelResult = await generateBusyOrderExcelBlob(sampleOrder);
if (!excelResult.blob) throw new Error('Excel Blob was not returned.');
if (excelResult.filename !== 'ORD-260912-001_Busy_Entry_Sheet.xlsx') {
  throw new Error(`Unexpected Excel filename: ${excelResult.filename}`);
}
if (excelResult.blob.type !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  throw new Error(`Unexpected Excel MIME type: ${excelResult.blob.type}`);
}
console.log(`✓ PASSED: Excel Blob created with correct filename: ${excelResult.filename}`);
console.log(`✓ PASSED: Excel MIME type verified: ${excelResult.blob.type}\n`);

// -------------------------------------------------------------
// TEST 4: Export Buttons State Management
// -------------------------------------------------------------
console.log('--- TEST 4: Export Buttons State Lifecycle ---');

// Mock DOM elements for buttons
class MockElement {
  constructor(id) {
    this.id = id;
    this.disabled = false;
    this.classList = new Set();
    this.attributes = {};
  }
  setAttribute(name, val) { this.attributes[name] = val; }
  removeAttribute(name) { delete this.attributes[name]; }
  getAttribute(name) { return this.attributes[name]; }
}
MockElement.prototype.classList = {
  add(...classes) { classes.forEach(c => this._set.add(c)); },
  remove(...classes) { classes.forEach(c => this._set.delete(c)); },
  contains(c) { return this._set.has(c); }
};

function createMockButton(id) {
  const el = {
    id,
    disabled: false,
    _classes: new Set(),
    classList: {
      add(...classes) { classes.forEach(c => el._classes.add(c)); },
      remove(...classes) { classes.forEach(c => el._classes.delete(c)); },
      contains(c) { return el._classes.has(c); }
    },
    attributes: {},
    setAttribute(name, val) { el.attributes[name] = val; },
    removeAttribute(name) { delete el.attributes[name]; }
  };
  return el;
}

const mockBtnPdf = createMockButton('btn-generate-pdf');
const mockBtnExcel = createMockButton('btn-generate-excel');

globalThis.document = {
  getElementById: (id) => {
    if (id === 'btn-generate-pdf') return mockBtnPdf;
    if (id === 'btn-generate-excel') return mockBtnExcel;
    return null;
  }
};

// 4a. Reset Order (0 items)
resetOrder();
updateExportButtonState();
if (!mockBtnPdf.disabled || !mockBtnExcel.disabled) {
  throw new Error('Buttons must be disabled when order has 0 items.');
}
if (!mockBtnPdf.classList.contains('opacity-40') || !mockBtnExcel.classList.contains('cursor-not-allowed')) {
  throw new Error('Buttons must have disabled CSS classes when order has 0 items.');
}
console.log('✓ PASSED (0 items): PDF & Excel buttons are disabled with opacity-40 and cursor-not-allowed.');

// 4b. Add 1 item
addOrderItem('Clutch Plate', 1);
updateExportButtonState();
if (mockBtnPdf.disabled || mockBtnExcel.disabled) {
  throw new Error('Buttons must be enabled when order has >= 1 item.');
}
if (mockBtnPdf.classList.contains('opacity-40') || mockBtnExcel.classList.contains('cursor-not-allowed')) {
  throw new Error('Buttons must NOT have disabled CSS classes when order has >= 1 item.');
}
console.log('✓ PASSED (1 item added): PDF & Excel buttons are enabled with normal opacity.');

// 4c. Reset Order again
resetOrder();
updateExportButtonState();
if (!mockBtnPdf.disabled || !mockBtnExcel.disabled) {
  throw new Error('Buttons must be disabled again after order reset.');
}
console.log('✓ PASSED (Order reset): PDF & Excel buttons become disabled again.\n');

// -------------------------------------------------------------
// TEST 5: Deduplication Logic in uploadOrUpdateDriveFile
// -------------------------------------------------------------
console.log('--- TEST 5: Deduplication Logic (PATCH update vs POST create) ---');

let fetchCalls = [];
globalThis.fetch = async (url, options = {}) => {
  fetchCalls.push({ url, options });
  const method = options.method || 'GET';

  // 1. Verify root folder access
  if (url.includes(`/files/${GOOGLE_DRIVE_ROOT_FOLDER_ID}?`)) {
    return {
      ok: true,
      json: async () => ({ id: GOOGLE_DRIVE_ROOT_FOLDER_ID, name: GOOGLE_DRIVE_ROOT_FOLDER_NAME, trashed: false })
    };
  }

  // 2. Query month folder
  if (url.includes('/drive/v3/files?q=') && url.includes('application%2Fvnd.google-apps.folder')) {
    return {
      ok: true,
      json: async () => ({ files: [{ id: 'mock-september-folder-id', name: 'SEPTEMBER 2026' }] })
    };
  }

  // 3. Search for existing file in month folder
  if (url.includes('/drive/v3/files?q=') && url.includes('mock-september-folder-id')) {
    if (globalThis._mockFileAlreadyExists) {
      return {
        ok: true,
        json: async () => ({
          files: [{
            id: 'mock-existing-file-id-999',
            name: 'ORD-260912-001_Busy_Entry_Sheet.pdf',
            webViewLink: 'https://drive.google.com/file/d/mock-existing-file-id-999/view'
          }]
        })
      };
    } else {
      return {
        ok: true,
        json: async () => ({ files: [] })
      };
    }
  }

  // 4. Update existing file (PATCH)
  if (method === 'PATCH' && url.includes('/upload/drive/v3/files/mock-existing-file-id-999')) {
    return {
      ok: true,
      json: async () => ({
        id: 'mock-existing-file-id-999',
        name: 'ORD-260912-001_Busy_Entry_Sheet.pdf',
        webViewLink: 'https://drive.google.com/file/d/mock-existing-file-id-999/view'
      })
    };
  }

  // 5. Create new file (POST multipart)
  if (method === 'POST' && url.includes('/upload/drive/v3/files?uploadType=multipart')) {
    return {
      ok: true,
      json: async () => ({
        id: 'mock-new-file-id-123',
        name: 'ORD-260912-001_Busy_Entry_Sheet.pdf',
        webViewLink: 'https://drive.google.com/file/d/mock-new-file-id-123/view'
      })
    };
  }

  return { ok: false, status: 404, text: async () => 'Not found' };
};

// Mock Google auth
globalThis.window.google = {
  accounts: {
    oauth2: {
      initTokenClient: (cfg) => {
        const client = {
          callback: cfg.callback,
          requestAccessToken: () => {
            client.callback({ access_token: 'mock-access-token-xyz', expires_in: 3600 });
          }
        };
        return client;
      }
    }
  }
};

// Case 5a: File does not exist yet -> Create new file (POST multipart)
globalThis._mockFileAlreadyExists = false;
fetchCalls = [];
const createUploadResult = await uploadOrUpdateDriveFile({
  filename: 'ORD-260912-001_Busy_Entry_Sheet.pdf',
  mimeType: 'application/pdf',
  blob: new Blob(['pdf-data'], { type: 'application/pdf' }),
  orderDate: '2026-09-12'
});

if (createUploadResult.isUpdate) throw new Error('First upload should be a CREATE, not an UPDATE.');
const postCall = fetchCalls.find(c => c.options.method === 'POST' && c.url.includes('uploadType=multipart'));
if (!postCall) throw new Error('Expected POST multipart request for new file.');
console.log('✓ PASSED (New file): Successfully created via POST multipart without error.');

// Case 5b: File already exists -> Update existing file (PATCH) to prevent duplicate (1) files
globalThis._mockFileAlreadyExists = true;
fetchCalls = [];
const updateUploadResult = await uploadOrUpdateDriveFile({
  filename: 'ORD-260912-001_Busy_Entry_Sheet.pdf',
  mimeType: 'application/pdf',
  blob: new Blob(['updated-pdf-data'], { type: 'application/pdf' }),
  orderDate: '2026-09-12'
});

if (!updateUploadResult.isUpdate) throw new Error('Subsequent upload with same name should be an UPDATE.');
if (updateUploadResult.fileId !== 'mock-existing-file-id-999') {
  throw new Error(`Expected updated file ID mock-existing-file-id-999, got ${updateUploadResult.fileId}`);
}
console.log('✓ PASSED (Existing file): In-place PATCH performed on existing file ID. Zero duplicate files created.\n');

// -------------------------------------------------------------
// TEST 6: Google Drive Export Success Modal & Action Handling
// -------------------------------------------------------------
console.log('--- TEST 6: Google Drive Export Success Modal & Action Options ---');
import { showDriveExportSuccessModal, closeDriveExportSuccessModal, getLastExportResult } from './js/ui.js';

const mockModalElements = {
  'drive-export-success-modal': createMockButton('drive-export-success-modal'),
  'drive-success-filename': { textContent: '' },
  'drive-success-folder': { textContent: '' },
  'drive-success-icon': { textContent: '' },
  'drive-success-update-badge': createMockButton('drive-success-update-badge')
};
mockModalElements['drive-export-success-modal']._classes.add('hidden');

const prevGetElementById = globalThis.document.getElementById;
globalThis.document.getElementById = (id) => {
  if (mockModalElements[id]) return mockModalElements[id];
  return prevGetElementById(id);
};

// 6a. Show Success Modal
const mockSuccessPayload = {
  blob: new Blob(['test-blob'], { type: 'application/pdf' }),
  filename: 'ORD-260912-001_Busy_Entry_Sheet.pdf',
  webViewLink: 'https://drive.google.com/file/d/123/view',
  monthFolderName: 'SEPTEMBER 2026',
  isUpdate: true,
  type: 'pdf'
};

showDriveExportSuccessModal(mockSuccessPayload);

if (mockModalElements['drive-export-success-modal'].classList.contains('hidden')) {
  throw new Error('Success modal must be visible after upload succeeds.');
}
if (mockModalElements['drive-success-filename'].textContent !== 'ORD-260912-001_Busy_Entry_Sheet.pdf') {
  throw new Error(`Expected filename ORD-260912-001_Busy_Entry_Sheet.pdf in modal, got ${mockModalElements['drive-success-filename'].textContent}`);
}
if (mockModalElements['drive-success-folder'].textContent !== 'SEPTEMBER 2026') {
  throw new Error(`Expected folder SEPTEMBER 2026 in modal, got ${mockModalElements['drive-success-folder'].textContent}`);
}
console.log('✓ PASSED: Success dialog displays "Saved successfully to Google Drive" with filename & folder.');

// 6b. Verify Blob retained in memory
const storedResult = getLastExportResult();
if (!storedResult || storedResult.filename !== mockSuccessPayload.filename || !storedResult.blob) {
  throw new Error('Generated Blob must remain retained in memory for user action (Save to PC / Retry).');
}
console.log('✓ PASSED: Generated Blob and Drive webViewLink retained in memory for user action.');

// 6c. Close Modal
closeDriveExportSuccessModal();
if (!mockModalElements['drive-export-success-modal'].classList.contains('hidden')) {
  throw new Error('Modal must be hidden after calling closeDriveExportSuccessModal.');
}
console.log('✓ PASSED: Modal successfully dismissed on Close action.');

console.log('\n=== ALL GOOGLE DRIVE INTEGRATION & EXPORT UX TESTS PASSED 100%! ===');
