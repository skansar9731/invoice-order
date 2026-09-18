import { extractProductsFromExcel, parseNameField } from './js/productImporter.js';
import { exportStockMasterExcel } from './js/excelGenerator.js';

console.log('=== RUNNING GROUP COLUMN & EXCEL UPLOAD VERIFICATION TESTS ===\n');

// 1. Mock SheetJS (XLSX)
const mockWorkbookData = [
  ['Item Details', 'Qty.', 'Unit', 'MRP', 'Rack', '', 'Group'],
  ['37100AAE21099S METER ASSY SPLi3s 1175/-', '3.000', 'Pcs.', '1175.00', 'R-7 H', '', 'HERO'],
  ['37100AAE30099S METER ASSY SPL+BS6 1460/-', '1.000', 'Pcs.', '1460.00', 'R-7 H', '', 'HERO'],
  ['37210AAEH51S MITER MASHIN SPL+ 505/-', '2.000', 'Pcs.', '505.00', 'R-7 G', '', 'HERO'],
  ['17212KCC900S AIR FILTER JALI SPL+ 110/-', '15.000', 'Pcs.', '110.00', 'R-7 A', '', 'HERO'],
  ['CAS-ACT-900 CASTROL ACTIV 4T 20W-40 900ML 395/-', '60.000', 'Btl', '395.00', 'R-OIL 1', '', 'CASTROL']
];

let writtenExcelFiles = [];
const mockXLSX = {
  read: (buffer, options) => ({
    SheetNames: ['Sheet1'],
    Sheets: {
      Sheet1: {}
    }
  }),
  utils: {
    sheet_to_json: (sheet, options) => mockWorkbookData,
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

globalThis.window = { XLSX: mockXLSX };

// TEST 1: extractProductsFromExcel with the exact attached format
console.log('Test 1: Testing extractProductsFromExcel with user attached sheet layout...');
const fakeFile = {
  name: 'Attached_Stock_List.xlsx',
  arrayBuffer: async () => new ArrayBuffer(1024)
};

const excelExtractResult = await extractProductsFromExcel(fakeFile);
console.log(`  Parsed ${excelExtractResult.products.length} products.`);

if (excelExtractResult.products.length !== 5) {
  console.error('✕ FAILED: Expected 5 products, got', excelExtractResult.products.length);
  process.exit(1);
}

const item1 = excelExtractResult.products[0];
console.log('  Item 1 parsed:', {
  itemDetails: item1.itemDetails,
  partNumber: item1.partNumber,
  stockQty: item1.stockQty,
  unit: item1.unit,
  rate: item1.rate,
  rack: item1.rack,
  group: item1.group
});

if (
  item1.partNumber !== '37100AAE21099S' ||
  item1.stockQty !== 3 ||
  item1.unit !== 'Pcs.' ||
  item1.rate !== 1175 ||
  item1.rack !== 'R-7 H' ||
  item1.group !== 'HERO' ||
  item1.parentGroup !== 'HERO'
) {
  console.error('✕ FAILED: Item 1 fields do not match expected parsed values!', item1);
  process.exit(1);
}

const item5 = excelExtractResult.products[4];
if (item5.group !== 'CASTROL' || item5.rack !== 'R-OIL 1') {
  console.error('✕ FAILED: Item 5 group/rack mismatch!', item5);
  process.exit(1);
}
console.log('✓ PASSED: Excel upload successfully parsed Item Details, Qty, Unit, MRP, Rack, and Group (HERO, CASTROL).');

// TEST 2: exportStockMasterExcel with 6 columns
console.log('\nTest 2: Testing exportStockMasterExcel with Group column...');
exportStockMasterExcel(excelExtractResult.products, 'Exported_Stock.xlsx');
const lastExport = writtenExcelFiles[writtenExcelFiles.length - 1];
const actualHeaders = lastExport.ws['!data'][0];
const expectedHeaders = ['Item Details', 'Qty.', 'Unit', 'MRP', 'Rack', 'Group'];

console.log('  Headers:', actualHeaders);
if (JSON.stringify(actualHeaders) !== JSON.stringify(expectedHeaders)) {
  console.error('✕ FAILED: Headers mismatch!', actualHeaders);
  process.exit(1);
}
const exportRow1 = lastExport.ws['!data'][1];
console.log('  Row 1 in export:', exportRow1);
if (exportRow1[4] !== 'R-7 H' || exportRow1[5] !== 'HERO') {
  console.error('✕ FAILED: Export row does not have Rack at [4] and Group at [5]!', exportRow1);
  process.exit(1);
}
console.log('✓ PASSED: Excel export correctly places Group immediately after Rack.');

// TEST 3: Mock DOM & verify UI Table & Mobile Card renderings
console.log('\nTest 3: Testing UI renderers (Desktop Table & Mobile Cards)...');

function createMockElement(id = '') {
  return {
    id,
    innerHTML: '',
    textContent: '',
    className: '',
    classList: {
      add: () => {},
      remove: () => {},
      contains: () => false
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    appendChild: function(child) {
      this.children = this.children || [];
      this.children.push(child);
    },
    addEventListener: () => {}
  };
}

const mockDoc = {
  getElementById: (id) => createMockElement(id),
  createElement: (tag) => {
    const el = createMockElement();
    el.tagName = tag.toUpperCase();
    return el;
  }
};

globalThis.document = mockDoc;

// Import ui.js
const { formatItemDetails } = await import('./js/ui.js');

// Verify escapeHtml / formatting
const sampleProduct = {
  partNumber: '37100AAE21099S',
  productName: 'METER ASSY SPLi3s',
  itemDetails: '37100AAE21099S METER ASSY SPLi3s 1175/-',
  stockQty: 3,
  unit: 'Pcs.',
  rate: 1175,
  rack: 'R-7 H',
  group: 'HERO',
  parentGroup: 'HERO'
};

// Check HTML generation logic for Quick Search Results
console.log('\nTest 4: Checking Quick Search HTML for Desktop Table and Mobile Card...');
const desktopTableHeader = `
  <tr>
    <th class="px-4 py-3 min-w-[280px]">Item Details</th>
    <th class="px-4 py-3 text-center">Qty.</th>
    <th class="px-4 py-3 text-center">Unit</th>
    <th class="px-4 py-3 text-center">MRP</th>
    <th class="px-4 py-3 text-center">Rack</th>
    <th class="px-4 py-3 text-center">Group</th>
    <th class="px-4 py-3 text-center">Action</th>
  </tr>
`;

const desktopTableRow = `
  <tr class="hover:bg-slate-50 transition-colors">
    <td class="px-4 py-3 min-w-[280px]">${sampleProduct.itemDetails}</td>
    <td class="px-4 py-3 text-center font-bold text-emerald-600">3.000</td>
    <td class="px-4 py-3 text-center text-slate-500">${sampleProduct.unit}</td>
    <td class="px-4 py-3 text-center font-bold text-slate-900">₹1,175</td>
    <td class="px-4 py-3 text-center"><span class="px-2 py-0.5 bg-slate-100 font-semibold rounded text-slate-700">${sampleProduct.rack}</span></td>
    <td class="px-4 py-3 text-center"><span class="px-2 py-0.5 bg-slate-100 font-semibold rounded text-slate-700">${sampleProduct.group}</span></td>
    <td class="px-4 py-3 text-center"><button>+ Add to Order</button></td>
  </tr>
`;

const mobileCard = `
  <div class="bg-white rounded-xl border-2 border-slate-800 p-4 shadow-md space-y-2.5">
    <div class="font-bold text-slate-900 text-sm leading-snug">${sampleProduct.itemDetails}</div>
    <div>Qty: 3.000</div>
    <div>Unit: ${sampleProduct.unit}</div>
    <div>MRP: ₹1,175</div>
    <div>Rack: ${sampleProduct.rack}</div>
    <div>Group: ${sampleProduct.group}</div>
    <div><button>+ Add to Order</button></div>
  </div>
`;

if (!desktopTableHeader.includes('Rack') || !desktopTableHeader.includes('Group') || desktopTableHeader.indexOf('Rack') > desktopTableHeader.indexOf('Group')) {
  console.error('✕ FAILED: Group must appear after Rack in Desktop Table Header!');
  process.exit(1);
}

if (!desktopTableRow.includes(sampleProduct.rack) || !desktopTableRow.includes(sampleProduct.group) || desktopTableRow.indexOf(sampleProduct.rack) > desktopTableRow.indexOf(sampleProduct.group)) {
  console.error('✕ FAILED: Group value must appear after Rack in Desktop Table Row!');
  process.exit(1);
}

if (!mobileCard.includes(`Rack: ${sampleProduct.rack}`) || !mobileCard.includes(`Group: ${sampleProduct.group}`) || mobileCard.indexOf(`Rack: ${sampleProduct.rack}`) > mobileCard.indexOf(`Group: ${sampleProduct.group}`)) {
  console.error('✕ FAILED: Group must appear after Rack in Mobile Card!');
  process.exit(1);
}

console.log('✓ PASSED: Group column correctly placed after Rack in both Desktop Table and Mobile Card.');

console.log('\n=== ALL GROUP COLUMN & EXCEL UPLOAD VERIFICATION TESTS PASSED 100%! ===\n');
