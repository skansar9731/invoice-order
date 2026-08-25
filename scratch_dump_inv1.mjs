import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\INV-1.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;

console.log('Total pages in INV-1.pdf:', pdf.numPages);

for (let p = 1; p <= pdf.numPages; p++) {
  console.log(`\n=== PAGE ${p} ===`);
  const page = await pdf.getPage(p);
  const tc = await page.getTextContent();
  
  // Group by Y
  const rows = {};
  for (const item of tc.items) {
    if (!item.str.trim()) continue;
    const y = Math.round(item.transform[5] / 2) * 2;
    if (!rows[y]) rows[y] = [];
    rows[y].push({ x: Math.round(item.transform[4]), str: item.str });
  }

  const sortedY = Object.keys(rows).map(Number).sort((a, b) => b - a);
  for (const y of sortedY) {
    const line = rows[y].sort((a, b) => a.x - b.x).map(i => `[x=${i.x}] "${i.str}"`).join(' ');
    console.log(`y=${y}: ${line}`);
  }
}
