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

export function parseNameField(rawName, existingAlias = '') {
  if (!rawName) return { partNumber: '', productName: '', alias: existingAlias, rate: null };
  let text = rawName.trim();
  let alias = (existingAlias || '').trim();
  let rate = null;

  // Check if text has a rate marker (e.g. " 193/- " or " 3290/-- ") followed by trailing alias text
  const rateWithTrailingAlias = text.match(/^(.*?)\s+(\d+(?:\.\d+)?\s*(?:\/[-–—.]*|\/\s*\d+[-–—.]*|\s*\/)?(?:\s+\d+(?:\.\d+)?\s*(?:\/[-–—.]*)?)*)\s+([A-Za-z0-9\-_./].*)$/);
  if (rateWithTrailingAlias) {
    text = rateWithTrailingAlias[1].trim();
    const rateStr = rateWithTrailingAlias[2].trim();
    const trailingAlias = rateWithTrailingAlias[3].trim();
    const numMatch = rateStr.match(/\d+(?:\.\d+)?/);
    if (numMatch) rate = parseFloat(numMatch[0]);
    if (!alias) alias = trailingAlias;
  } else {
    // Normal rate at end of name
    const rateMatch = text.match(/^(.*?)\s+(\d+(?:\.\d+)?\s*(?:\/[-–—.]*|\/\s*\d+[-–—.]*|\s*\/)?(?:\s+\d+(?:\.\d+)?\s*(?:\/[-–—.]*)?)*)$/);
    if (rateMatch && rateMatch[1].length > 3) {
      text = rateMatch[1].trim();
      const numMatch = rateMatch[2].match(/\d+(?:\.\d+)?/);
      if (numMatch) rate = parseFloat(numMatch[0]);
    }
  }

  let partNumber = '';
  let productName = '';

  const gluedMatch = text.match(/^([0-9][0-9A-Za-z]{3,14}[0-9A-Za-z])([A-Za-z].{3,})$/);
  if (gluedMatch && !text.startsWith('4T') && !text.startsWith('20K') && !text.startsWith('21K') && !text.startsWith('22K') && !text.startsWith('24K') && !text.startsWith('25K') && !text.startsWith('26K') && !text.startsWith('36D')) {
    const secondPart = gluedMatch[2];
    if (/^(piston|teming|timing|clutch|valve|brake|oil|chain|gear|cover|ring|cable|filter|rocker|element)/i.test(secondPart)) {
      partNumber = gluedMatch[1];
      productName = secondPart;
    }
  }

  if (!partNumber) {
    const tokens = text.split(/\s+/);
    if (tokens.length >= 2) {
      const firstToken = tokens[0];
      const isPartNo = /^[A-Z0-9\-_./]+$/i.test(firstToken) && 
        (firstToken.length >= 3 || /^\d+$/.test(firstToken)) &&
        !['TOTAL', 'PAGE', 'GRAND', 'MAHARASHTRA', 'LIST', 'NAME', 'CASH', 'BILL', 'TATA', 'CASTROL', 'MEERO', 'HERO', 'HONDA', 'BAJAJ', 'BOSCH', 'ZODIX', 'STAR', 'MINDA', 'ASK', 'VARROC', 'ENDURANCE', 'ROLON'].includes(firstToken.toUpperCase());

      if (isPartNo) {
        partNumber = firstToken;
        productName = tokens.slice(1).join(' ');
      } else {
        partNumber = text;
        productName = text;
      }
    } else {
      partNumber = text;
      productName = text;
    }
  }

  return {
    partNumber: partNumber.toUpperCase(),
    productName: productName.toUpperCase(),
    alias,
    rate
  };
}

async function extractProducts(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  let layoutType = 'LIST_OF_ITEMS';

  // Detect layout from initial pages
  for (let p = 1; p <= Math.min(3, pdf.numPages); p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const fullText = tc.items.map(i => i.str).join(' ');
    if (fullText.includes('Stock Status') || (fullText.includes('Item Details') && fullText.includes('MRP'))) {
      layoutType = 'STOCK_STATUS';
      break;
    }
  }

  const bounds = layoutType === 'STOCK_STATUS' ? LAYOUT_STOCK_STATUS : LAYOUT_LIST_OF_ITEMS;
  const productMap = new Map();

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const itemsByY = {};
    for (const item of textContent.items) {
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

      let rate = parsed.rate !== null ? parsed.rate : null;
      if (fields.mrp) {
        const num = parseFloat(fields.mrp.replace(/,/g, ''));
        if (!isNaN(num)) rate = num;
      }

      const rack = fields.rack || '';
      const unit = fields.unit || '';
      const alias = parsed.alias || fields.alias || '';
      const parentGroup = fields.parentGroup || '';

      const newProduct = {
        partNumber: parsed.partNumber,
        productName: parsed.productName,
        alias,
        parentGroup,
        stockQty,
        unit,
        rack,
        rate,
        page: pageNum
      };

      const key = parsed.partNumber;
      if (productMap.has(key)) {
        const prev = productMap.get(key);
        // Smart Merge:
        // 1. If new has positive stock and prev does not, prefer new
        if (newProduct.stockQty !== null && newProduct.stockQty > 0 && (prev.stockQty === null || prev.stockQty <= 0)) {
          productMap.set(key, {
            ...newProduct,
            alias: prev.alias || newProduct.alias,
            parentGroup: prev.parentGroup || newProduct.parentGroup
          });
        }
        // 2. If prev has positive stock and new does not, keep prev but fill missing metadata
        else if (prev.stockQty !== null && prev.stockQty > 0 && (newProduct.stockQty === null || newProduct.stockQty <= 0)) {
          if (!prev.rack && newProduct.rack) prev.rack = newProduct.rack;
          if (!prev.rate && newProduct.rate) prev.rate = newProduct.rate;
          if (!prev.alias && newProduct.alias) prev.alias = newProduct.alias;
        }
        // 3. If both have stock, sum stock and prefer populated rack & rate
        else if (newProduct.stockQty !== null && newProduct.stockQty > 0 && prev.stockQty !== null && prev.stockQty > 0) {
          prev.stockQty = prev.stockQty + newProduct.stockQty;
          if (!prev.rack && newProduct.rack) prev.rack = newProduct.rack;
          if (!prev.rate && newProduct.rate) prev.rate = newProduct.rate;
        }
        // 4. If neither has stock, prefer the one with rack / rate / longer description
        else {
          const prevScore = (prev.rack ? 2 : 0) + (prev.rate ? 2 : 0) + (prev.productName.length > 5 ? 1 : 0);
          const newScore = (newProduct.rack ? 2 : 0) + (newProduct.rate ? 2 : 0) + (newProduct.productName.length > 5 ? 1 : 0);
          if (newScore > prevScore) {
            productMap.set(key, {
              ...newProduct,
              alias: prev.alias || newProduct.alias,
              parentGroup: prev.parentGroup || newProduct.parentGroup
            });
          }
        }
      } else {
        productMap.set(key, newProduct);
      }
    }
  }

  const finalProducts = Array.from(productMap.values());
  console.log(`\n=== Extracted ${finalProducts.length} unique products from ${pdfPath} ===`);
  const item21k = finalProducts.find(p => p.partNumber === '21K130LS');
  console.log('21K130LS result:', item21k);
  return finalProducts;
}

await extractProducts('C:\\Users\\tyrtrt\\Downloads\\total stock list.pdf');
await extractProducts('C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf');
