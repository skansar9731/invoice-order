import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

function getPdfs(dir) {
  const r = [];
  try {
    const list = fs.readdirSync(dir);
    for (const f of list) {
      const full = path.join(dir, f);
      try {
        const s = fs.statSync(full);
        if (s.isDirectory() && !full.includes('node_modules') && !full.includes('.git')) {
          r.push(...getPdfs(full));
        } else if (f.endsWith('.pdf')) {
          r.push(full);
        }
      } catch (e) {}
    }
  } catch (e) {}
  return r;
}

const allPdfs = [...getPdfs('.'), ...getPdfs('C:\\Users\\tyrtrt\\Downloads')];
console.log(`Searching across ${allPdfs.length} PDFs...`);

for (const pdfFile of allPdfs) {
  try {
    const data = new Uint8Array(fs.readFileSync(pdfFile));
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const has41 = tc.items.some(i => i.str && i.str.includes('41.000'));
      const has21k = tc.items.some(i => i.str && i.str.includes('21K130LS'));
      if (has41 || has21k) {
        console.log(`\nMatch in: ${pdfFile} (Page ${p})`);
        for (const item of tc.items) {
          if (item.str && (item.str.includes('41.000') || item.str.includes('21K130LS') || item.str.includes('2,255.00') || item.str.includes('CYLINDER'))) {
            console.log(`  [x=${Math.round(item.transform[4])}, y=${Math.round(item.transform[5])}]: "${item.str}"`);
          }
        }
      }
    }
  } catch (e) {}
}
