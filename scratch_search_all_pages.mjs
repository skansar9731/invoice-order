import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;

for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const textContent = await page.getTextContent();
  for (const item of textContent.items) {
    if (item.str && (item.str.includes('21K130LS') || item.str.includes('BOR KIT SPL+'))) {
      console.log(`Page ${p} [x=${Math.round(item.transform[4])}, y=${Math.round(item.transform[5])}]: "${item.str}"`);
    }
  }
}
