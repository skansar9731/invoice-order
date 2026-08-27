import { generateBusyOrderPDF } from './js/pdfGenerator.js';

console.log('=== RUNNING PDF GENERATION FORMAT VERIFICATION TEST ===');

// Mock window.jspdf
let savedFilename = '';
let autoTableConfig = null;
let drawnTexts = [];

class MockDoc {
  constructor() {
    this.internal = {
      pageSize: {
        getWidth: () => 210,
        getHeight: () => 297
      },
      getNumberOfPages: () => 1
    };
  }
  setFont() {}
  setFontSize() {}
  setTextColor() {}
  setDrawColor() {}
  setLineWidth() {}
  line() {}
  text(str, x, y) {
    drawnTexts.push({ str, x, y });
  }
  autoTable(config) {
    autoTableConfig = config;
  }
  save(filename) {
    savedFilename = filename;
  }
}

globalThis.window = {
  jspdf: {
    jsPDF: MockDoc
  }
};

const sampleOrder = {
  orderNo: 'ORD-260826-9999',
  customerName: 'Ramesh Auto Works',
  orderDate: '2026-08-26',
  orderTime: '11:45 AM',
  items: [
    {
      customerText: 'Borkit S Spl Goe',
      quantity: 3,
      matchedProduct: {
        partNumber: '01016MKLSD0000C1',
        productName: '01016MKLSD0000C1 BORKIT S SPL GOE 2910/-',
        unit: 'Pcs.',
        rate: 2910,
        rack: ''
      }
    },
    {
      customerText: 'Bor kit SPL+',
      quantity: 41,
      matchedProduct: {
        partNumber: '21K130LS',
        productName: '21K130LS BOR KIT SPL+ 2050/- 2255/-',
        unit: 'Pcs.',
        rate: 2255,
        rack: 'R-1 G'
      }
    },
    {
      customerText: 'Bor kit D Yuga',
      quantity: 2,
      matchedProduct: {
        partNumber: '01210K14900',
        productName: '01210K14900 BOR KIT D YUGA 3290/--',
        unit: 'Pcs.',
        rate: 3290,
        rack: '12'
      }
    }
  ]
};

const resultFile = await generateBusyOrderPDF(sampleOrder);

console.log('Result filename:', resultFile);
if (resultFile !== 'ORD-260826-9999_Busy_Entry_Sheet.pdf') {
  console.error('✕ FAILED: Incorrect filename generated!');
  process.exit(1);
}
console.log('✓ PASSED: Filename generated correctly.');

if (!autoTableConfig) {
  console.error('✕ FAILED: doc.autoTable was not called!');
  process.exit(1);
}

const headers = autoTableConfig.head[0];
console.log('PDF Headers:', headers);
const expectedHeaders = ['Item Details', 'Qty.', 'Unit', 'MRP', 'Rack'];
if (JSON.stringify(headers) !== JSON.stringify(expectedHeaders)) {
  console.error('✕ FAILED: Headers do not match expected Busy format:', headers);
  process.exit(1);
}
console.log('✓ PASSED: PDF table columns match exact Busy format: [Item Details, Qty., Unit, MRP, Rack]');

const rows = autoTableConfig.body;
console.log(`Generated ${rows.length} rows (including Totals c/o row):`);

// Check Row 1
if (!rows[0][0].includes('01016MKLSD0000C1 BORKIT S SPL GOE 2910/-') || rows[0][1] !== '3.000' || rows[0][2] !== 'Pcs.' || rows[0][3] !== '2,910.00') {
  console.error('✕ FAILED: Row 1 format mismatch!', rows[0]);
  process.exit(1);
}
console.log('✓ PASSED: Row 1 matches exact format (Item Details, Qty: 3.000, Unit: Pcs., MRP: 2,910.00).');

// Check Row 2
if (!rows[1][0].includes('21K130LS BOR KIT SPL+ 2050/- 2255/-') || rows[1][1] !== '41.000' || rows[1][2] !== 'Pcs.' || rows[1][3] !== '2,255.00' || rows[1][4] !== 'R-1 G') {
  console.error('✕ FAILED: Row 2 format mismatch!', rows[1]);
  process.exit(1);
}
console.log('✓ PASSED: Row 2 matches exact format (Item Details, Qty: 41.000, Unit: Pcs., MRP: 2,255.00, Rack: R-1 G).');

console.log('\n=== ALL PDF FORMAT VERIFICATION TESTS PASSED 100%! ===');
