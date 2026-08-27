import { exportStockMasterExcel, generateBusyOrderExcel } from './js/excelGenerator.js';
import { parseNameField } from './js/productImporter.js';

console.log('=== RUNNING ATTACHED EXCEL FORMAT & STOCK LIST VERIFICATION ===');

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

// 1. Test parsing sample items from Maharashtra Automobile PDF
const samplePDFRows = [
  '21K211S BOR KIT GLAMOUR FI 2011 3310/-',
  '21K170S BOR KIT [Karizma] 3800/-',
  '21K180S BOR KIT CBZ HUNK 3042/-',
  '21K160S BOR KIT S SPL 3145/2900/ 3225/-',
  'K12121AATA001S BOR KIT 110CC 2811/-',
  'K12121AATA000S BOR KIT T 110CC 3010/-',
  '01016MKLSD0000C1 BORKIT S SPL GOE 2910/-',
  '14401K0ND00 TEMING CHAINE SHINE BS6 193/-'
];

console.log('\n--- Checking parseNameField on sample rows ---');
const parsedProducts = [];
samplePDFRows.forEach(row => {
  const parsed = parseNameField(row);
  console.log(`Input: "${row}" -> Item Details: "${parsed.itemDetails}", PartNo: "${parsed.partNumber}", Rate: ${parsed.rate}`);
  parsedProducts.push({
    itemDetails: parsed.itemDetails,
    partNumber: parsed.partNumber,
    productName: parsed.productName,
    stockQty: 1,
    unit: 'Pcs.',
    rate: parsed.rate,
    rack: 'R-1 A'
  });
});

// 2. Test Stock Master Excel Export
console.log('\n--- Testing exportStockMasterExcel ---');
const exportedFile = exportStockMasterExcel(parsedProducts, 'Maharashtra_Automobile_Stock_List.xlsx');
console.log('Generated file:', exportedFile);

const stockExport = writtenFiles[writtenFiles.length - 1];
const expectedHeaders = ['Item Details', 'Qty.', 'Unit', 'MRP', 'Rack'];
const actualHeaders = stockExport.ws['!data'][0];

console.log('Headers:', actualHeaders);
if (JSON.stringify(actualHeaders) !== JSON.stringify(expectedHeaders)) {
  console.error('FAILED: Headers do not match:', actualHeaders);
  process.exit(1);
}
console.log('✓ PASSED: Stock Master Excel has exact 5 columns (Item Details, Qty., Unit, MRP, Rack)');

const row1 = stockExport.ws['!data'][1];
console.log('Row 1:', row1);
if (row1[0] !== '21K211S BOR KIT GLAMOUR FI 2011 3310/-' || row1[1] !== '1.000' || row1[2] !== 'Pcs.' || row1[3] !== 3310 || row1[4] !== 'R-1 A') {
  console.error('FAILED: Row 1 does not match expected data:', row1);
  process.exit(1);
}
console.log('✓ PASSED: Row 1 matches exact attached Excel format.');

console.log('\n=== ALL ATTACHED EXCEL FORMAT TESTS PASSED 100%! ===\n');
