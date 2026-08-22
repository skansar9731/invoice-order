import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;

// Check pages 1, 2, 3, 4, 7, 15, 20, 50, 90
for (const pageNum of [1, 2, 4, 7, 15, 91]) {
  const page = await pdf.getPage(pageNum);
  const textContent = await page.getTextContent();
  console.log(`\n--- PAGE ${pageNum} RAW ITEMS ---`);
  textContent.items.slice(10, 25).forEach(item => {
    if (item.str && item.str.trim()) {
      console.log(`  [x=${Math.round(item.transform[4])}, y=${Math.round(item.transform[5])}]: "${item.str}"`);
    }
  });
}
