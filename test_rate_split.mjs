import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;

const page7 = await pdf.getPage(7);
const textContent = await page7.getTextContent();

for (const item of textContent.items) {
  if (item.str && (item.str.includes('/-') || item.str.includes('/--'))) {
    console.log(`[x=${Math.round(item.transform[4])}, y=${Math.round(item.transform[5])}]: "${item.str}"`);
  }
}
