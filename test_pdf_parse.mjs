import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));

const loadingTask = pdfjsLib.getDocument({ data });
const pdf = await loadingTask.promise;
console.log(`Total Pages: ${pdf.numPages}`);

// Let's inspect page 1 text items with coordinates
const page1 = await pdf.getPage(1);
const textContent1 = await page1.getTextContent();
console.log(`Page 1 item count: ${textContent1.items.length}`);

// Group by Y
const itemsByY = {};
for (const item of textContent1.items) {
  if (!item.str || !item.str.trim()) continue;
  const yKey = Math.round(item.transform[5] / 2) * 2; // round to nearest 2
  if (!itemsByY[yKey]) itemsByY[yKey] = [];
  itemsByY[yKey].push({
    x: Math.round(item.transform[4]),
    text: item.str
  });
}

const sortedY = Object.keys(itemsByY).map(Number).sort((a, b) => b - a);
console.log('--- Sample Page 1 Rows with X coords ---');
sortedY.slice(0, 20).forEach(y => {
  const row = itemsByY[y].sort((a, b) => a.x - b.x);
  console.log(`Y=${y}: ` + row.map(r => `[x=${r.x}: "${r.text}"]`).join(' '));
});
