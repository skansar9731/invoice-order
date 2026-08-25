import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;

const page15 = await pdf.getPage(15);
const textContent = await page15.getTextContent();

for (const item of textContent.items) {
  const y = item.transform[5];
  if (y >= 380 && y <= 400) {
    console.log(`y=${y.toFixed(2)}, x=${item.transform[4].toFixed(2)}: "${item.str}"`);
  }
}
