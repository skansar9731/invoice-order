import {
  getCurrentOrder,
  resetOrder,
  updateOrderMeta,
  addOrderItem,
  saveOrderToStorage,
  loadOrderFromStorage,
  loadOrder
} from './js/orderManager.js';
import { generateBusyOrderPDF } from './js/pdfGenerator.js';
import { generateBusyOrderExcel } from './js/excelGenerator.js';

console.log('=== RUNNING STEP 1 ORDER-LEVEL FIELDS VERIFICATION TESTS ===\n');

// Mock localStorage
const storageMock = {};
globalThis.window = {
  localStorage: {
    getItem: (key) => storageMock[key] || null,
    setItem: (key, val) => { storageMock[key] = String(val); },
    removeItem: (key) => { delete storageMock[key]; }
  }
};

// Mock jsPDF
let pdfTexts = [];
let autoTableConfig = null;
class MockPDFDoc {
  constructor() {
    this.internal = {
      pageSize: { getWidth: () => 210, getHeight: () => 297 },
      getNumberOfPages: () => 1
    };
  }
  setFont() { }
  setFontSize() { }
  setTextColor() { }
  setDrawColor() { }
  setLineWidth() { }
  line() { }
  text(str, x, y) { pdfTexts.push({ str, x, y }); }
  autoTable(cfg) { autoTableConfig = cfg; }
  save(filename) { }
}
globalThis.window.jspdf = { jsPDF: MockPDFDoc };

// Mock XLSX
let appendedSheets = [];
const mockXLSX = {
  utils: {
    book_new: () => ({ Sheets: {}, SheetNames: [] }),
    aoa_to_sheet: (data) => ({ '!data': data }),
    book_append_sheet: (wb, ws, name) => {
      wb.SheetNames.push(name);
      wb.Sheets[name] = ws;
      appendedSheets.push({ name, ws, data: ws['!data'] });
    }
  },
  writeFile: (wb, filename) => { }
};
globalThis.window.XLSX = mockXLSX;

// TEST 1: Setting Order-Level Fields
console.log('Test 1: Setting Customer Name, Created By, Checked By...');
resetOrder();
updateOrderMeta({
  customerName: 'ABC Auto Works',
  createdBy: 'Ansar',
  checkedBy: 'Imran'
});

const current = getCurrentOrder();
if (current.customerName !== 'ABC Auto Works') {
  console.error('✕ FAILED: customerName not set correctly', current);
  process.exit(1);
}
if (current.createdBy !== 'Ansar') {
  console.error('✕ FAILED: createdBy not set correctly', current);
  process.exit(1);
}
if (current.checkedBy !== 'Imran') {
  console.error('✕ FAILED: checkedBy not set correctly', current);
  process.exit(1);
}
console.log('✓ PASSED: Fields set successfully in order object.');

// TEST 2: Persistence & Reload
console.log('\nTest 2: Verifying localStorage persistence and reload...');
const reloaded = loadOrderFromStorage();
if (reloaded.customerName !== 'ABC Auto Works' || reloaded.createdBy !== 'Ansar' || reloaded.checkedBy !== 'Imran') {
  console.error('✕ FAILED: Order reload mismatch', reloaded);
  process.exit(1);
}
console.log('✓ PASSED: Order persisted and reloaded with exact values.');

// TEST 3: Backward Compatibility for Legacy Orders
console.log('\nTest 3: Backward compatibility with legacy stored order without createdBy/checkedBy...');
storageMock['active_customer_order'] = JSON.stringify({
  id: 'legacy-1',
  orderNo: 'ORD-LEGACY-001',
  customerName: 'Old Garage',
  items: []
});
const legacyOrder = loadOrderFromStorage();
if (legacyOrder.customerName !== 'Old Garage') {
  console.error('✕ FAILED: Legacy customerName missing');
  process.exit(1);
}
if (legacyOrder.createdBy !== '') {
  console.error('✕ FAILED: Missing createdBy should default to empty string, got:', legacyOrder.createdBy);
  process.exit(1);
}
if (legacyOrder.checkedBy !== '') {
  console.error('✕ FAILED: Missing checkedBy should default to empty string, got:', legacyOrder.checkedBy);
  process.exit(1);
}
console.log('✓ PASSED: Legacy order loaded with default empty strings for missing fields.');

// TEST 4: Blank Order Handling
console.log('\nTest 4: Creating an order with blank fields...');
resetOrder();
const blankOrder = getCurrentOrder();
if (blankOrder.customerName !== '' || blankOrder.createdBy !== '' || blankOrder.checkedBy !== '') {
  console.error('✕ FAILED: Blank order fields should be empty strings');
  process.exit(1);
}
console.log('✓ PASSED: Blank order initialized with empty strings.');

// TEST 5: PDF Export Header Verification
console.log('\nTest 5: Verifying PDF export header details...');
resetOrder();
updateOrderMeta({
  customerName: 'ABC Auto Works',
  createdBy: 'Ansar',
  checkedBy: 'Imran'
});
addOrderItem('Spark Plug M10', 4);
const orderForPDF = getCurrentOrder();
orderForPDF.items[0].matchedProduct = {
  partNumber: 'SP-M10',
  productName: 'SPARK PLUG M10 150/-',
  unit: 'Pcs.',
  rate: 150,
  rack: 'A-1',
  stockQty: 20
};

pdfTexts = [];
autoTableConfig = null;
await generateBusyOrderPDF(orderForPDF);

const pdfHeaderLine = pdfTexts.find(t => t.str.includes('Customer: ABC Auto Works'));
if (!pdfHeaderLine) {
  console.error('✕ FAILED: Customer Name not found in PDF texts:', pdfTexts);
  process.exit(1);
}
if (!pdfHeaderLine.str.includes('Created By: Ansar')) {
  console.error('✕ FAILED: Created By not found in PDF header line:', pdfHeaderLine.str);
  process.exit(1);
}
if (!pdfHeaderLine.str.includes('Checked By: Imran')) {
  console.error('✕ FAILED: Checked By not found in PDF header line:', pdfHeaderLine.str);
  process.exit(1);
}
console.log('✓ PASSED: PDF header line contains all 3 fields:', pdfHeaderLine.str);

// Confirm PDF product table columns are untouched
const pdfHeaders = autoTableConfig.head[0];
const expectedPdfHeaders = ['Item Details', 'Qty.', 'Unit', 'MRP', 'Rack'];
if (JSON.stringify(pdfHeaders) !== JSON.stringify(expectedPdfHeaders)) {
  console.error('✕ FAILED: PDF table columns were modified!', pdfHeaders);
  process.exit(1);
}
console.log('✓ PASSED: PDF product table columns remain untouched: [Item Details, Qty., Unit, MRP, Rack]');

// TEST 6: Excel Export Verification
console.log('\nTest 6: Verifying Excel export order-level metadata & untouched product tables...');
appendedSheets = [];
await generateBusyOrderExcel(orderForPDF);

// Check Order Details sheet
const orderDetailsSheet = appendedSheets.find(s => s.name === 'Order Details');
if (!orderDetailsSheet) {
  console.error('✕ FAILED: "Order Details" sheet not found in Excel export!');
  process.exit(1);
}
const rows = orderDetailsSheet.data;
const customerRow = rows.find(r => r[0] === 'Customer Name');
const createdByRow = rows.find(r => r[0] === 'Created By');
const checkedByRow = rows.find(r => r[0] === 'Checked By');

if (!customerRow || customerRow[1] !== 'ABC Auto Works') {
  console.error('✕ FAILED: Customer Name in Excel Order Details mismatch:', customerRow);
  process.exit(1);
}
if (!createdByRow || createdByRow[1] !== 'Ansar') {
  console.error('✕ FAILED: Created By in Excel Order Details mismatch:', createdByRow);
  process.exit(1);
}
if (!checkedByRow || checkedByRow[1] !== 'Imran') {
  console.error('✕ FAILED: Checked By in Excel Order Details mismatch:', checkedByRow);
  process.exit(1);
}
console.log('✓ PASSED: Excel "Order Details" sheet contains all 3 order-level fields.');

// Confirm Busy Entry Sheet product table columns are UNTOUCHED
const busySheet = appendedSheets.find(s => s.name === 'Busy Entry Sheet');
const busyHeaders = busySheet.data[0];
const expectedBusyHeaders = [
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
if (JSON.stringify(busyHeaders) !== JSON.stringify(expectedBusyHeaders)) {
  console.error('✕ FAILED: Busy Entry Sheet table headers modified!', busyHeaders);
  process.exit(1);
}
console.log('✓ PASSED: Busy Entry Sheet product table columns remain 100% UNCHANGED (10 columns).');

// Confirm Easy Software Format product table columns are UNTOUCHED
const easySheet = appendedSheets.find(s => s.name === 'Easy Software Format');
const easyHeaders = easySheet.data[0];
const expectedEasyHeaders = ['Item Details', 'Qty.', 'Unit', 'MRP', 'Rack'];
if (JSON.stringify(easyHeaders) !== JSON.stringify(expectedEasyHeaders)) {
  console.error('✕ FAILED: Easy Software Format table headers modified!', easyHeaders);
  process.exit(1);
}
console.log('✓ PASSED: Easy Software Format product table columns remain 100% UNCHANGED (5 columns).');

console.log('\n=== ALL STEP 1 VERIFICATION TESTS PASSED 100%! ===\n');
