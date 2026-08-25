import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;

const page15 = await pdf.getPage(15);
const textContent = await page15.getTextContent({ disableCombineTextItems: false });

console.log('Total items:', textContent.items.length);
for (const item of textContent.items) {
  console.log(`[x=${item.transform[4].toFixed(1)}, y=${item.transform[5].toFixed(1)}]: "${item.str}"`);
}
