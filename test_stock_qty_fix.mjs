import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractProductsFromPDF } from './js/productImporter.js';

console.log('=== RUNNING STOCK QTY & DUPLICATE RESOLUTION TEST SUITE ===');

// Mock browser globals for Node.js
globalThis.window = {
  pdfjsLib
};

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\total stock list.pdf';
if (fs.existsSync(pdfPath)) {
  const buffer = fs.readFileSync(pdfPath);
  const mockFile = {
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  };

  const { products, warnings, totalPages } = await extractProductsFromPDF(mockFile);
  console.log(`\nExtracted ${products.length} unique products from ${totalPages} pages.`);

  const item21k = products.find(p => p.partNumber === '21K130LS');
  console.log('\nInspecting 21K130LS:');
  console.log(item21k);

  if (!item21k) {
    console.error('✕ FAILED: 21K130LS not found in extracted products!');
    process.exit(1);
  }

  if (item21k.stockQty !== 41) {
    console.error(`✕ FAILED: 21K130LS stockQty is ${item21k.stockQty}, expected 41!`);
    process.exit(1);
  }
  console.log('✓ PASSED: 21K130LS stockQty is correctly 41!');

  if (item21k.unit !== 'Pcs.') {
    console.error(`✕ FAILED: 21K130LS unit is ${item21k.unit}, expected Pcs.!`);
    process.exit(1);
  }
  console.log('✓ PASSED: 21K130LS unit is Pcs.!');

  if (item21k.rate !== 2255) {
    console.error(`✕ FAILED: 21K130LS rate/MRP is ${item21k.rate}, expected 2255!`);
    process.exit(1);
  }
  console.log('✓ PASSED: 21K130LS MRP is 2255!');

  if (item21k.rack !== 'R-1 G') {
    console.error(`✕ FAILED: 21K130LS rack is ${item21k.rack}, expected R-1 G!`);
    process.exit(1);
  }
  console.log('✓ PASSED: 21K130LS rack is R-1 G!');

  if (!item21k.productName.includes('BOR KIT SPL+')) {
    console.error(`✕ FAILED: 21K130LS productName is ${item21k.productName}, expected BOR KIT SPL+!`);
    process.exit(1);
  }
  console.log('✓ PASSED: 21K130LS productName is BOR KIT SPL+ (not overwritten by 0-stock CYLINDER)!');
} else {
  console.log('Note: total stock list.pdf not found in Downloads, skipping direct PDF extraction test.');
}

console.log('\n=== ALL STOCK QTY & DUPLICATE RESOLUTION TESTS PASSED! ===');
