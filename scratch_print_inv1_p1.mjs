import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\INV-1.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;

const page1 = await pdf.getPage(1);
const tc = await page1.getTextContent();

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
