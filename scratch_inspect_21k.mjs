import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;

console.log('Total pages:', pdf.numPages);

for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const textContent = await page.getTextContent();
  const found = textContent.items.some(i => i.str && i.str.includes('21K130LS'));
  if (found) {
    console.log(`\n=== Found on Page ${p} ===`);
    const yTargets = new Set();
    for (const item of textContent.items) {
      if (item.str && item.str.includes('21K130LS')) {
        yTargets.add(Math.round(item.transform[5] / 3) * 3);
      }
    }

    for (const item of textContent.items) {
      const yKey = Math.round(item.transform[5] / 3) * 3;
      if (yTargets.has(yKey)) {
        console.log(`y=${yKey}, x=${Math.round(item.transform[4])}: "${item.str}"`);
      }
    }
  }
}
