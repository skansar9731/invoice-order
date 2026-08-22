import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;

const page7 = await pdf.getPage(7);
const textContent = await page7.getTextContent();
for (const item of textContent.items) {
  if (item.str && item.str.includes('14401K0ND00') || (item.str && item.str.includes('14401-KON-D00')) || (item.str && item.str.includes('14401-K0N-D00'))) {
    console.log(`Text: "${item.str}", x=${item.transform[4]}, y=${item.transform[5]}`);
  }
}

// Print all items on that exact Y line
const targetY = textContent.items.find(i => i.str && i.str.includes('14401K0ND00'))?.transform[5];
console.log(`Target Y: ${targetY}`);
const rowItems = textContent.items.filter(i => Math.abs(i.transform[5] - targetY) < 4);
rowItems.sort((a, b) => a.transform[4] - b.transform[4]);
console.log(rowItems.map(i => `[x=${Math.round(i.transform[4])}: "${i.str}"]`).join('  '));
