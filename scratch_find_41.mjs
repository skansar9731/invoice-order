import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;

const page15 = await pdf.getPage(15);
const textContent = await page15.getTextContent();

console.log('--- ALL items on Page 15 containing numbers or stock ---');
for (const item of textContent.items) {
  if (item.str && (item.str.includes('41') || item.str.includes('2,255') || item.str.includes('2255') || item.str.includes('.000'))) {
    console.log(`[x=${Math.round(item.transform[4])}, y=${Math.round(item.transform[5])}]: "${item.str}"`);
  }
}
