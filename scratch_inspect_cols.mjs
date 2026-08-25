import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;

const page15 = await pdf.getPage(15);
const textContent = await page15.getTextContent();

console.log('Total items on page 15:', textContent.items.length);
// Group by X range
const colRanges = {
  col0: [], // x < 200
  col1: [], // 200 - 350
  col2: [], // 350 - 450
  col3: [], // 450 - 500
  col4: [], // 500 - 600
  col5: []  // > 600
};

for (const item of textContent.items) {
  if (!item.str.trim()) continue;
  const x = Math.round(item.transform[4]);
  const y = Math.round(item.transform[5]);
  if (x < 200) colRanges.col0.push({ x, y, str: item.str });
  else if (x < 350) colRanges.col1.push({ x, y, str: item.str });
  else if (x < 450) colRanges.col2.push({ x, y, str: item.str });
  else if (x < 500) colRanges.col3.push({ x, y, str: item.str });
  else if (x < 600) colRanges.col4.push({ x, y, str: item.str });
  else colRanges.col5.push({ x, y, str: item.str });
}

console.log('col0 count:', colRanges.col0.length);
console.log('col1 count:', colRanges.col1.length);
console.log('col2 count:', colRanges.col2.length);
console.log('col3 count:', colRanges.col3.length);
console.log('col4 count:', colRanges.col4.length);
console.log('col5 count:', colRanges.col5.length);

if (colRanges.col5.length > 0) {
  console.log('Items with x > 600:', colRanges.col5);
}
