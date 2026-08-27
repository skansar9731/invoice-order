import { prepareBusyExportRows } from './js/exportDataService.js';
import { generateBusyOrderExcel } from './js/excelGenerator.js';
import { generateBusyOrderPDF } from './js/pdfGenerator.js';

console.log('=== RUNNING EXACT PRODUCT MASTER EXPORT VERIFICATION TEST ===');

// Mock Product Master in IndexedDB
const mockDbProducts = new Map([
  [
    '21K211S',
    {
      partNumber: '21K211S',
      productName: 'BOR KIT GLAMOUR FI 2011 3310/-',
      rack: 'R-1 A',
      unit: 'Pcs.',
      stockQty: 2,
      rate: 3310
    }
  ],
  [
    '14401K0ND00',
    {
      partNumber: '14401K0ND00',
      productName: 'TEMING CHAINE SHINE BS6 193/-',
      rack: 'R-3 K',
      unit: 'Pcs.',
      stockQty: 7,
      rate: 193
    }
  ],
  [
    'VERY-LONG-DESC-PART-12345',
    {
      partNumber: 'VERY-LONG-DESC-PART-12345',
      productName: 'EXTRAORDINARILY LONG COMPREHENSIVE CYLINDER BOR KIT ASSEMBLY SPECIAL EDITION MODEL 2026 WITH SPECIAL GASKET & O-RING PACKING 9999/-',
      itemDetails: 'VERY-LONG-DESC-PART-12345 EXTRAORDINARILY LONG COMPREHENSIVE CYLINDER BOR KIT ASSEMBLY SPECIAL EDITION MODEL 2026 WITH SPECIAL GASKET & O-RING PACKING 9999/-',
      rack: 'R-99 Z',
      unit: 'Kit',
      stockQty: 0, // Actual 0 stock!
      rate: 9999
    }
  ],
  [
    'PART-WITH-MISSING-METADATA',
    {
      partNumber: 'PART-WITH-MISSING-METADATA',
      productName: 'PLAIN PART WITHOUT RACK OR UNIT OR MRP',
      itemDetails: 'PLAIN PART WITHOUT RACK OR UNIT OR MRP',
      rack: '',     // Missing rack
      unit: '',     // Missing unit
      stockQty: null, // Missing stock
      rate: null    // Missing MRP
    }
  ]
]);

// Mock IndexedDB getDB / getProduct
globalThis.indexedDB = {
  open: () => ({
    result: {
      transaction: () => ({
        objectStore: () => ({
          get: (key) => {
            const req = { result: mockDbProducts.get(key) || null };
            setTimeout(() => {
              if (req.onsuccess) req.onsuccess({ target: req });
            }, 0);
            return req;
          }
        })
      })
    },
    set onsuccess(fn) { fn({ target: this }); }
  })
};

// Mock window for Excel and PDF
let writtenExcelFiles = [];
const mockXLSX = {
  utils: {
    book_new: () => ({ Sheets: {}, SheetNames: [] }),
    aoa_to_sheet: (data) => ({ '!data': data }),
    book_append_sheet: (wb, ws, name) => {
      wb.SheetNames.push(name);
      wb.Sheets[name] = ws;
      writtenExcelFiles.push({ wb, name, ws });
    }
  },
  writeFile: (wb, filename) => {
    writtenExcelFiles[writtenExcelFiles.length - 1].filename = filename;
  }
};

let drawnPDFTable = null;
let savedPDFFilename = '';
class MockPDFDoc {
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
  autoTable(config) { drawnPDFTable = config; }
  save(fn) { savedPDFFilename = fn; }
}

globalThis.window = {
  XLSX: mockXLSX,
  jspdf: { jsPDF: MockPDFDoc }
};

// Construct Test Order
const testOrder = {
  orderNo: 'ORD-260826-TEST',
  customerName: 'Shree Krishna Auto',
  orderDate: '2026-08-26',
  orderTime: '12:45 PM',
  items: [
    // 1. Automatic match
    {
      id: 'i1',
      customerText: 'BOR KIT GLAMOUR FI',
      quantity: 1,
      isManual: false,
      confidence: 95,
      matchedProduct: {
        partNumber: '21K211S',
        productName: 'BOR KIT GLAMOUR FI' // Intentionally shorter in UI representation
      }
    },
    // 2. Manual selection
    {
      id: 'i2',
      customerText: 'Shine bs6 timing chn',
      quantity: 3,
      isManual: true,
      confidence: 100,
      matchedProduct: {
        partNumber: '14401K0ND00',
        productName: 'TEMING CHAINE SHINE BS6' // Intentionally without price in UI
      }
    },
    // 3. Very long description & 0 stock
    {
      id: 'i3',
      customerText: 'Long Cylinder Bor Kit',
      quantity: 1,
      isManual: false,
      confidence: 92,
      matchedProduct: {
        partNumber: 'VERY-LONG-DESC-PART-12345',
        productName: 'SHORT NAME'
      }
    },
    // 4. Missing rack, unit, stock, mrp
    {
      id: 'i4',
      customerText: 'Plain Part',
      quantity: 5,
      isManual: false,
      confidence: 90,
      matchedProduct: {
        partNumber: 'PART-WITH-MISSING-METADATA',
        productName: 'PART-WITH-MISSING-METADATA'
      }
    },
    // 5. Unmatched item
    {
      id: 'i5',
      customerText: 'Unknown Random Part XYZ',
      quantity: 2,
      isManual: false,
      confidence: 0,
      matchedProduct: null
    }
  ]
};

// TEST 1: Verify prepareBusyExportRows retrieves exact Product Master records
console.log('\n--- TEST 1: prepareBusyExportRows Data Resolution ---');
const exportRows = await prepareBusyExportRows(testOrder);
console.log(`Resolved ${exportRows.length} export rows.`);

// Item 1 Check
const row1 = exportRows[0];
console.log('Row 1 (Auto match):', row1);
if (row1.exactItemName !== '21K211S BOR KIT GLAMOUR FI 2011 3310/-') {
  console.error(`✕ FAILED: Row 1 exactItemName should be '21K211S BOR KIT GLAMOUR FI 2011 3310/-', got '${row1.exactItemName}'`);
  process.exit(1);
}
if (row1.mrp !== 3310 || row1.rackNo !== 'R-1 A' || row1.availableStock !== 2 || row1.unit !== 'Pcs.') {
  console.error('✕ FAILED: Row 1 metadata mismatch!', row1);
  process.exit(1);
}
console.log('✓ PASSED: Row 1 resolved exact Product Master item name, MRP, Rack, Unit, and Stock.');

// Item 2 Check (Manual selection)
const row2 = exportRows[1];
console.log('Row 2 (Manual selection):', row2);
if (row2.exactItemName !== '14401K0ND00 TEMING CHAINE SHINE BS6 193/-') {
  console.error(`✕ FAILED: Row 2 exactItemName should be '14401K0ND00 TEMING CHAINE SHINE BS6 193/-', got '${row2.exactItemName}'`);
  process.exit(1);
}
if (row2.confidence !== 'Manual' || row2.action !== 'Manual') {
  console.error('✕ FAILED: Row 2 confidence/action should be Manual!', row2);
  process.exit(1);
}
console.log('✓ PASSED: Row 2 (Manual) resolved exact Product Master item name with Manual status.');

// Item 3 Check (Long description & actual 0 stock)
const row3 = exportRows[2];
console.log('Row 3 (Long description):', row3);
if (row3.exactItemName !== 'VERY-LONG-DESC-PART-12345 EXTRAORDINARILY LONG COMPREHENSIVE CYLINDER BOR KIT ASSEMBLY SPECIAL EDITION MODEL 2026 WITH SPECIAL GASKET & O-RING PACKING 9999/-') {
  console.error(`✕ FAILED: Row 3 long name was truncated! Got: '${row3.exactItemName}'`);
  process.exit(1);
}
if (row3.availableStock !== 0) {
  console.error(`✕ FAILED: Actual 0 stock should be preserved as 0, got: '${row3.availableStock}'`);
  process.exit(1);
}
if (row3.action !== 'Low Stock') {
  console.error(`✕ FAILED: Action for 0 stock item should be 'Low Stock', got: '${row3.action}'`);
  process.exit(1);
}
console.log('✓ PASSED: Row 3 preserves 100% full long description and actual 0 stock without truncation.');

// Item 4 Check (Missing fields remain blank)
const row4 = exportRows[3];
console.log('Row 4 (Missing fields):', row4);
if (row4.rackNo !== '' || row4.unit !== '' || row4.mrp !== '' || row4.availableStock !== '') {
  console.error('✕ FAILED: Missing fields must be empty string, got:', row4);
  process.exit(1);
}
console.log('✓ PASSED: Row 4 missing metadata cleanly exported as blank cells (no fake - or fake Pcs.).');

// Item 5 Check (Unmatched)
const row5 = exportRows[4];
console.log('Row 5 (Unmatched):', row5);
if (!row5.exactItemName.includes('[UNMATCHED]') || row5.action !== 'Unmatched') {
  console.error('✕ FAILED: Row 5 unmatched format incorrect!', row5);
  process.exit(1);
}
console.log('✓ PASSED: Row 5 unmatched item marked clearly.');

// TEST 2: Verify Excel Export Headings & Sheet Data
console.log('\n--- TEST 2: Excel Export Headings & Structure ---');
const excelFilename = await generateBusyOrderExcel(testOrder);
console.log('Generated Excel file:', excelFilename);

const excelSheet = writtenExcelFiles.find(f => f.name === 'Busy Entry Sheet');
if (!excelSheet) {
  console.error('✕ FAILED: Busy Entry Sheet not found in Excel export!');
  process.exit(1);
}

const excelHeaders = excelSheet.ws['!data'][0];
console.log('Excel Headings:', excelHeaders);

const expectedHeaders = [
  'S. No',
  'Customer Handwritten Text',
  'Qty',
  'Item (Matched from Original Stock)',
  'Unit',
  'MRP',
  'Available stock',
  'Rack No',
  'Confidence',
  'Action'
];

if (JSON.stringify(excelHeaders) !== JSON.stringify(expectedHeaders)) {
  console.error('✕ FAILED: Excel headings do not match exact 10 required headings!', excelHeaders);
  process.exit(1);
}
console.log('✓ PASSED: Excel export contains EXACT 10 required column headings.');

// Check row values in Excel
const excelDataRows = excelSheet.ws['!data'].slice(1);
if (excelDataRows[0][3] !== '21K211S BOR KIT GLAMOUR FI 2011 3310/-') {
  console.error('✕ FAILED: Excel Column D does not match original Product Master!', excelDataRows[0][3]);
  process.exit(1);
}
console.log('✓ PASSED: Excel Column D contains character-for-character Product Master item name.');

// TEST 3: Verify PDF Export Structure
console.log('\n--- TEST 3: PDF Export Exact Data Verification ---');
const pdfFilename = await generateBusyOrderPDF(testOrder);
console.log('Generated PDF file:', pdfFilename);

if (!drawnPDFTable) {
  console.error('✕ FAILED: doc.autoTable not called for PDF!');
  process.exit(1);
}

const pdfBodyRows = drawnPDFTable.body;
console.log('PDF Body Rows count:', pdfBodyRows.length);
if (pdfBodyRows[0][0] !== '21K211S BOR KIT GLAMOUR FI 2011 3310/-') {
  console.error('✕ FAILED: PDF Item Details does not match original Product Master!', pdfBodyRows[0][0]);
  process.exit(1);
}
if (pdfBodyRows[2][0] !== 'VERY-LONG-DESC-PART-12345 EXTRAORDINARILY LONG COMPREHENSIVE CYLINDER BOR KIT ASSEMBLY SPECIAL EDITION MODEL 2026 WITH SPECIAL GASKET & O-RING PACKING 9999/-') {
  console.error('✕ FAILED: PDF Item Details long name was truncated!', pdfBodyRows[2][0]);
  process.exit(1);
}
console.log('✓ PASSED: PDF export uses identical Product Master data with full text wrapping.');

console.log('\n=== ALL EXACT PRODUCT MASTER EXPORT VERIFICATION TESTS PASSED 100%! ===');
