import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

async function testPdfLayout(pdfPath) {
  console.log(`\n========================================`);
  console.log(`Testing PDF: ${pdfPath}`);
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  console.log(`Total pages: ${pdf.numPages}`);

  for (let p = 1; p <= Math.min(3, pdf.numPages); p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const item of tc.items) {
      if (item.str && (item.str.includes('Item Details') || item.str.includes('Parent Group') || item.str.includes('Stock Status') || item.str.includes('List of Items'))) {
        console.log(`Page ${p} header item [x=${Math.round(item.transform[4])}, y=${Math.round(item.transform[5])}]: "${item.str}"`);
      }
    }
  }
}

await testPdfLayout('C:\\Users\\tyrtrt\\Downloads\\total stock list.pdf');
await testPdfLayout('C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf');
if (fs.existsSync('C:\\Users\\tyrtrt\\Downloads\\stock list.pdf')) {
  await testPdfLayout('C:\\Users\\tyrtrt\\Downloads\\stock list.pdf');
}
