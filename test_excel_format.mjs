import { generateBusyOrderExcel } from './js/excelGenerator.js';

console.log('=== RUNNING EXCEL GENERATION FORMAT VERIFICATION TEST ===');

// Mock window.XLSX
let writtenFiles = [];

const mockXLSX = {
  utils: {
    book_new: () => ({ Sheets: {}, SheetNames: [] }),
    aoa_to_sheet: (data) => ({ '!data': data }),
    book_append_sheet: (wb, ws, name) => {
      wb.SheetNames.push(name);
      wb.Sheets[name] = ws;
      writtenFiles.push({ wb, name, ws });
    }
  },
  writeFile: (wb, filename) => {
    writtenFiles[writtenFiles.length - 1].filename = filename;
  }
};

globalThis.window = {
  XLSX: mockXLSX
};

const sampleOrder = {
  orderNo: 'ORD-260826-5555',
  customerName: 'Ramesh Auto Works',
  orderDate: '2026-08-26',
  orderTime: '12:00 PM',
  items: [
    {
      customerText: 'Borkit S Spl Goe',
      quantity: 3,
      confidence: 95,
      isManual: false,
      matchedProduct: {
        partNumber: '01016MKLSD0000C1',
        productName: 'BORKIT S SPL GOE 2910/-',
        unit: 'Pcs.',
        rate: 2910,
        rack: ''
      }
    },
    {
      customerText: 'Bor kit SPL+',
      quantity: 41,
      confidence: 100,
      isManual: true,
      matchedProduct: {
        partNumber: '21K130LS',
        productName: 'BOR KIT SPL+ 2050/- 2255/-',
        unit: 'Pcs.',
        rate: 2255,
        rack: 'R-1 G',
        stockQty: 41
      }
    },
    {
      customerText: 'Bor kit D Yuga',
      quantity: 2,
      confidence: 90,
      isManual: false,
      matchedProduct: {
        partNumber: '01210K14900',
        productName: 'BOR KIT D YUGA 3290/--',
        unit: 'Pcs.',
        rate: 3290,
        rack: '12',
        stockQty: 0
      }
    }
  ]
};

// TEST 1: SheetJS (.xlsx) Export
console.log('Test 1: Testing XLSX export with SheetJS...');
const excelResult = await generateBusyOrderExcel(sampleOrder);
console.log('Result filename:', excelResult);

if (excelResult !== 'ORD-260826-5555_Busy_Entry_Sheet.xlsx') {
  console.error('✕ FAILED: Unexpected Excel filename:', excelResult);
  process.exit(1);
}
console.log('✓ PASSED: Correct Excel filename generated.');

if (writtenFiles.length === 0) {
  console.error('✕ FAILED: XLSX.writeFile was not called!');
  process.exit(1);
}

const busySheet = writtenFiles[0].wb.Sheets['Busy Entry Sheet'];
if (!busySheet) {
  console.error('✕ FAILED: "Busy Entry Sheet" was not created in workbook!');
  process.exit(1);
}

const busySheetData = busySheet['!data'];
const headerRow = busySheetData[0];
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

if (JSON.stringify(headerRow) !== JSON.stringify(expectedHeaders)) {
  console.error('✕ FAILED: Headers do not match required 10 Excel headings:', headerRow);
  process.exit(1);
}
console.log('✓ PASSED: Excel columns match exact 10 required headings.');

// Check Row 1
const r1 = busySheetData[1];
if (r1[0] !== 1 || r1[1] !== 'Borkit S Spl Goe' || r1[2] !== 3 || r1[3] !== '01016MKLSD0000C1 BORKIT S SPL GOE 2910/-' || r1[5] !== 2910) {
  console.error('✕ FAILED: Sheet 1 Row 1 mismatch!', r1);
  process.exit(1);
}
console.log('✓ PASSED: Excel Row 1 matches exact values.');

// Check Row 2 (Manual)
const r2 = busySheetData[2];
if (r2[0] !== 2 || r2[3] !== '21K130LS BOR KIT SPL+ 2050/- 2255/-' || r2[4] !== 'Pcs.' || r2[5] !== 2255 || r2[6] !== 41 || r2[7] !== 'R-1 G' || r2[8] !== 'Manual' || r2[9] !== 'Manual') {
  console.error('✕ FAILED: Sheet 1 Row 2 mismatch!', r2);
  process.exit(1);
}
console.log('✓ PASSED: Excel Row 2 matches exact values (Manual, 41 stock, R-1 G).');

// TEST 2: Fallback CSV mode
console.log('\nTest 2: Testing fallback CSV export...');
delete window.XLSX;
let createdBlob = null;
let downloadedName = '';
globalThis.Blob = class {
  constructor(parts) {
    this.content = parts.join('');
    createdBlob = this;
  }
};
globalThis.URL = {
  createObjectURL: () => 'blob:mock',
  revokeObjectURL: () => {}
};
globalThis.document = {
  body: {
    appendChild: () => {},
    removeChild: () => {}
  },
  createElement: (tag) => ({
    set href(v) {},
    set download(v) { downloadedName = v; },
    click: () => {}
  })
};

const csvResult = await generateBusyOrderExcel(sampleOrder);
console.log('CSV Result filename:', csvResult);
if (!csvResult.endsWith('.csv') || !createdBlob) {
  console.error('✕ FAILED: CSV export failed!');
  process.exit(1);
}
console.log('✓ PASSED: Offline CSV fallback works seamlessly.');

console.log('\n=== ALL EXCEL & CSV EXPORT TESTS PASSED 100%! ===');
