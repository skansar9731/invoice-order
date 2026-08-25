import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = 'C:\\Users\\tyrtrt\\.gemini\\antigravity-ide\\brain\\9970da29-2e7a-4b5f-930f-640e53e54a58\\.user_uploaded\\media_1787296343768.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;

console.log('User uploaded PDF total pages:', pdf.numPages);

for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const textContent = await page.getTextContent();
  for (const item of textContent.items) {
    if (item.str && item.str.includes('21K130LS')) {
      console.log(`Page ${p} [x=${Math.round(item.transform[4])}, y=${Math.round(item.transform[5])}]: "${item.str}"`);
    }
  }
}
