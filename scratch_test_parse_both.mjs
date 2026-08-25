import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const LAYOUT_STOCK_STATUS = {
  NAME: { min: 20, max: 310 },
  OP_STOCK: { min: 310, max: 360 },
  UNIT: { min: 360, max: 410 },
  MRP: { min: 410, max: 490 },
  RACK: { min: 490, max: 600 }
};

const LAYOUT_LIST_OF_ITEMS = {
  NAME: { min: 20, max: 205 },
  ALIAS: { min: 205, max: 369 },
  PARENT_GROUP: { min: 369, max: 440 },
  OP_STOCK: { min: 440, max: 480 },
  UNIT: { min: 480, max: 512 },
  RACK: { min: 512, max: 600 }
};

function parseNameField(rawName, existingAlias = '') {
  if (!rawName) return { partNumber: '', productName: '', alias: existingAlias, rate: null };
  let text = rawName.trim();
  let alias = (existingAlias || '').trim();
  let rate = null;

  const rateMatch = text.match(/(\d+(?:\.\d+)?\s*(?:\/[-–—.]*|\/\s*\d+[-–—.]*|\s*\/)?(?:\s+\d+(?:\.\d+)?\s*(?:\/[-–—.]*)?)*)$/);
  if (rateMatch) {
    const rawRateStr = rateMatch[1].trim();
    const numMatch = rawRateStr.match(/\d+(?:\.\d+)?/);
    if (numMatch) rate = parseFloat(numMatch[0]);
    text = text.substring(0, text.length - rateMatch[0].length).trim();
  }

  let partNumber = '';
  let productName = '';
  const firstSpaceIdx = text.indexOf(' ');
  if (firstSpaceIdx > 0) {
    partNumber = text.substring(0, firstSpaceIdx).trim();
    productName = text.substring(firstSpaceIdx + 1).trim();
  } else {
    partNumber = text;
    productName = text;
  }

  return {
    partNumber: partNumber.toUpperCase(),
    productName: productName.toUpperCase(),
    alias,
    rate
  };
}

async function testParse(pdfPath) {
  console.log(`\n========================================`);
  console.log(`Testing Parse for: ${pdfPath}`);
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  let layoutType = 'LIST_OF_ITEMS';

  // Sample page 1 & 2 to detect layout
  for (let p = 1; p <= Math.min(2, pdf.numPages); p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const fullText = tc.items.map(i => i.str).join(' ');
    if (fullText.includes('Stock Status') || (fullText.includes('Item Details') && fullText.includes('MRP'))) {
      layoutType = 'STOCK_STATUS';
      break;
    }
  }
  console.log(`Detected Layout: ${layoutType}`);

  const bounds = layoutType === 'STOCK_STATUS' ? LAYOUT_STOCK_STATUS : LAYOUT_LIST_OF_ITEMS;
  const products = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const tc = await page.getTextContent();
    const itemsByY = {};
    for (const item of tc.items) {
      if (!item.str || !item.str.trim()) continue;
      const yKey = Math.round(item.transform[5] / 3) * 3;
      if (!itemsByY[yKey]) itemsByY[yKey] = [];
      itemsByY[yKey].push({ x: item.transform[4], text: item.str });
    }

    const sortedY = Object.keys(itemsByY).map(Number).sort((a, b) => b - a);
    for (const y of sortedY) {
      const rowItems = itemsByY[y];
      const rawLine = rowItems.map(i => i.text).join(' ').trim();
      const lower = rawLine.toLowerCase();
      if (
        lower.includes('maharashtra automobile') ||
        lower.includes('nanded, maharashtra') ||
        lower.includes('gstin :') ||
        lower.includes('list of items') ||
        lower.includes('stock status') ||
        lower.includes('item details') ||
        (lower.includes('name') && lower.includes('parent group')) ||
        lower.includes('totals c/o') ||
        lower.includes('totals b/d') ||
        lower.includes('contd. on page') ||
        lower.includes('grand total') ||
        (lower.startsWith('page ') && (lower.includes('list of items') || lower.includes('stock status')))
      ) {
        continue;
      }

      rowItems.sort((a, b) => a.x - b.x);
      const fields = { name: '', alias: '', parentGroup: '', opStock: '', unit: '', mrp: '', rack: '' };
      for (const item of rowItems) {
        const text = item.text.trim();
        if (!text) continue;
        const x = item.x;
        if (layoutType === 'STOCK_STATUS') {
          if (x < bounds.NAME.max) fields.name = fields.name ? `${fields.name} ${text}` : text;
          else if (x < bounds.OP_STOCK.max) fields.opStock = fields.opStock ? `${fields.opStock} ${text}` : text;
          else if (x < bounds.UNIT.max) fields.unit = fields.unit ? `${fields.unit} ${text}` : text;
          else if (x < bounds.MRP.max) fields.mrp = fields.mrp ? `${fields.mrp} ${text}` : text;
          else fields.rack = fields.rack ? `${fields.rack} ${text}` : text;
        } else {
          if (x < bounds.NAME.max) fields.name = fields.name ? `${fields.name} ${text}` : text;
          else if (x < bounds.ALIAS.max) fields.alias = fields.alias ? `${fields.alias} ${text}` : text;
          else if (x < bounds.PARENT_GROUP.max) fields.parentGroup = fields.parentGroup ? `${fields.parentGroup} ${text}` : text;
          else if (x < bounds.OP_STOCK.max) fields.opStock = fields.opStock ? `${fields.opStock} ${text}` : text;
          else if (x < bounds.UNIT.max) fields.unit = fields.unit ? `${fields.unit} ${text}` : text;
          else fields.rack = fields.rack ? `${fields.rack} ${text}` : text;
        }
      }

      if (!fields.name && !fields.alias) continue;
      const parsed = parseNameField(fields.name, fields.alias);
      if (!parsed.partNumber && !parsed.productName) continue;

      let stockQty = null;
      if (fields.opStock) {
        const num = parseFloat(fields.opStock.replace(/,/g, ''));
        if (!isNaN(num)) stockQty = num;
      }

      let rate = parsed.rate;
      if (fields.mrp) {
        const num = parseFloat(fields.mrp.replace(/,/g, ''));
        if (!isNaN(num)) rate = num;
      }

      products.push({
        partNumber: parsed.partNumber,
        productName: parsed.productName,
        stockQty,
        unit: fields.unit || '',
        rate,
        rack: fields.rack || '',
        rawName: fields.name
      });
    }
  }

  console.log(`Total extracted products: ${products.length}`);
  const matches21k = products.filter(p => p.partNumber === '21K130LS');
  console.log(`21K130LS entries found (${matches21k.length}):`, matches21k);
}

await testParse('C:\\Users\\tyrtrt\\Downloads\\total stock list.pdf');
await testParse('C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf');
