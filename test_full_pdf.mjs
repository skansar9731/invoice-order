import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));

const loadingTask = pdfjsLib.getDocument({ data });
const pdf = await loadingTask.promise;
const totalPages = pdf.numPages;

console.log(`Analyzing all ${totalPages} pages...`);

const COL_BOUNDS = {
  NAME: { min: 20, max: 205 },
  ALIAS: { min: 205, max: 369 },
  PARENT_GROUP: { min: 369, max: 440 },
  OP_STOCK: { min: 440, max: 480 },
  UNIT: { min: 480, max: 512 },
  RACK: { min: 512, max: 600 }
};

function extractRowFields(items) {
  // Sort by X coordinate
  items.sort((a, b) => a.x - b.x);

  const fields = {
    name: '',
    alias: '',
    parentGroup: '',
    opStock: '',
    unit: '',
    rack: ''
  };

  for (const item of items) {
    const text = item.text.trim();
    if (!text) continue;
    const x = item.x;

    if (x < COL_BOUNDS.NAME.max) {
      fields.name = fields.name ? `${fields.name} ${text}` : text;
    } else if (x < COL_BOUNDS.ALIAS.max) {
      fields.alias = fields.alias ? `${fields.alias} ${text}` : text;
    } else if (x < COL_BOUNDS.PARENT_GROUP.max) {
      fields.parentGroup = fields.parentGroup ? `${fields.parentGroup} ${text}` : text;
    } else if (x < COL_BOUNDS.OP_STOCK.max) {
      fields.opStock = fields.opStock ? `${fields.opStock} ${text}` : text;
    } else if (x < COL_BOUNDS.UNIT.max) {
      fields.unit = fields.unit ? `${fields.unit} ${text}` : text;
    } else {
      fields.rack = fields.rack ? `${fields.rack} ${text}` : text;
    }
  }

  return fields;
}

/**
 * Clean & separate Part Number, Product Description, and Rate from the raw Name cell
 */
function parseNameField(rawName) {
  if (!rawName) return { partNumber: '', productName: '', rate: null };

  let text = rawName.trim();

  // Extract rate from end if present
  // Examples: "2910/-", "3290/--", "300", "75/- 300/-", "2414./-", "175", "102"
  let rate = null;
  // Match rate pattern at the end: e.g. " 193/-", " 3290/--", " 2910/-", " 75/- 300/-", " 27.1/-", " 1500/-", " 2414./-"
  const rateMatch = text.match(/\s+(\d+(?:\.\d+)?\s*(?:\/[-–—.]*|\/\s*\d+[-–—.]*|\s*\/)?(?:\s+\d+(?:\.\d+)?\s*(?:\/[-–—.]*)?)*)$/);
  
  // Also check if text ends with standalone price like " 300" or " 171" when preceded by text
  let cleanedName = text;
  if (rateMatch && rateMatch.index > 3) {
    const potentialRateStr = rateMatch[1].trim();
    // Check if the rate contains / or digits
    cleanedName = text.substring(0, rateMatch.index).trim();
    // parse primary numeric rate
    const numMatch = potentialRateStr.match(/\d+(?:\.\d+)?/);
    if (numMatch) {
      rate = parseFloat(numMatch[0]);
    }
  }

  // Now split cleanedName into Part Number and Product Description
  // In many spare parts formats:
  // 1) First alphanumeric token is part number: e.g. "14401K0ND00 TEMING CHAINE SHINEBS6"
  // 2) Or glued: "13011krm305spiston Ring Std C B Z" -> split "13011krm305s" & "piston Ring Std C B Z"
  // 3) Or "14400KWP901TEMING CHAIN ACTIVA" -> "14400KWP901" & "TEMING CHAIN ACTIVA"
  // 4) Or items without separate part no: "11/3/24 BIL AMOUND KACCHA", "CASH", "ACTIV OIL 10W30 1LTR"

  // Check glued patterns first: (e.g. 5-12 alnum followed immediately by lowercase or uppercase word like 'piston', 'TEMING', etc)
  let partNumber = '';
  let productName = '';

  const gluedMatch = cleanedName.match(/^([0-9][0-9A-Za-z]{3,14}[0-9A-Za-z])([A-Za-z].{3,})$/);
  if (gluedMatch && !cleanedName.startsWith('4T') && !cleanedName.startsWith('20K') && !cleanedName.startsWith('21K') && !cleanedName.startsWith('22K') && !cleanedName.startsWith('24K') && !cleanedName.startsWith('25K') && !cleanedName.startsWith('26K') && !cleanedName.startsWith('36D')) {
    // Check if second part starts with common words
    const secondPart = gluedMatch[2];
    if (/^(piston|teming|timing|clutch|valve|brake|oil|chain|gear|cover|ring|cable|filter|rocker)/i.test(secondPart)) {
      partNumber = gluedMatch[1];
      productName = secondPart;
    }
  }

  if (!partNumber) {
    const tokens = cleanedName.split(/\s+/);
    if (tokens.length >= 2) {
      const firstToken = tokens[0];
      // If first token looks like a part number (contains digits and letters, or digits only like 110201, 1006, 14401, or codes like 21K120LS, K14144KTCE900S, AF2002EL, B25HBSC-92-2, etc.)
      const isPartNo = /^[A-Z0-9\-_./]+$/i.test(firstToken) && 
        (firstToken.length >= 4 || /^\d+$/.test(firstToken)) &&
        !['TOTAL', 'PAGE', 'GRAND', 'MAHARASHTRA', 'LIST', 'NAME', 'CASH', 'BILL', 'TATA', 'CASTROL', 'MEERO', 'HERO', 'HONDA', 'BAJAJ', 'BOSCH', 'ZODIX', 'STAR', 'MINDA', 'ASK', 'VARROC', 'ENDURANCE', 'ROLON'].includes(firstToken.toUpperCase());

      if (isPartNo) {
        partNumber = firstToken;
        productName = tokens.slice(1).join(' ');
      } else {
        partNumber = cleanedName;
        productName = cleanedName;
      }
    } else {
      partNumber = cleanedName;
      productName = cleanedName;
    }
  }

  return { partNumber: partNumber.trim(), productName: productName.trim(), rate };
}

const allProducts = [];
const unparsedWarnings = [];
const seenPartNumbers = new Map();

for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
  const page = await pdf.getPage(pageNum);
  const textContent = await page.getTextContent();

  const itemsByY = {};
  for (const item of textContent.items) {
    if (!item.str || !item.str.trim()) continue;
    // Round Y to nearest 3px to group lines
    const yKey = Math.round(item.transform[5] / 3) * 3;
    if (!itemsByY[yKey]) itemsByY[yKey] = [];
    itemsByY[yKey].push({
      x: item.transform[4],
      text: item.str
    });
  }

  const sortedY = Object.keys(itemsByY).map(Number).sort((a, b) => b - a);

  for (const y of sortedY) {
    const rowItems = itemsByY[y];
    const fields = extractRowFields(rowItems);
    const rawLine = rowItems.map(i => i.text).join(' ').trim();
    const lowerLine = rawLine.toLowerCase();

    // Skip headers and page footers
    if (
      lowerLine.includes('maharashtra automobile') ||
      lowerLine.includes('nanded, maharashtra') ||
      lowerLine.includes('gstin :') ||
      lowerLine.includes('list of items') ||
      (lowerLine.includes('name') && lowerLine.includes('parent group')) ||
      lowerLine.includes('totals c/o') ||
      lowerLine.includes('totals b/d') ||
      lowerLine.includes('contd. on page') ||
      lowerLine.includes('grand total') ||
      lowerLine.startsWith('page ') && lowerLine.includes('list of items')
    ) {
      continue;
    }

    if (!fields.name && !fields.alias) {
      continue;
    }

    const { partNumber, productName, rate } = parseNameField(fields.name);

    if (!partNumber && !productName) {
      unparsedWarnings.push({ page: pageNum, raw: rawLine });
      continue;
    }

    // Process fields strictly according to requirement:
    // "MISSING DATA MUST REMAIN BLANK - If a field is NOT available in the PDF, keep that field BLANK/null."
    const productRecord = {
      partNumber: partNumber || fields.name,
      productName: productName || fields.name,
      alias: fields.alias || '',
      parentGroup: fields.parentGroup || '',
      stockQty: fields.opStock ? (parseFloat(fields.opStock) || null) : null,
      unit: fields.unit || '',
      rack: fields.rack || '',
      rate: rate !== null ? rate : (fields.name.includes('/-') ? null : null),
      page: pageNum
    };

    const key = productRecord.partNumber.toUpperCase();
    if (seenPartNumbers.has(key)) {
      // If already exists, update/merge
      const existing = seenPartNumbers.get(key);
      if (!existing.rack && productRecord.rack) existing.rack = productRecord.rack;
      if (!existing.alias && productRecord.alias) existing.alias = productRecord.alias;
      if (existing.stockQty === null && productRecord.stockQty !== null) existing.stockQty = productRecord.stockQty;
      if (!existing.unit && productRecord.unit) existing.unit = productRecord.unit;
      if (!existing.parentGroup && productRecord.parentGroup) existing.parentGroup = productRecord.parentGroup;
    } else {
      seenPartNumbers.set(key, productRecord);
      allProducts.push(productRecord);
    }
  }
}

console.log(`\n========================================`);
console.log(`EXTRACTION SUMMARY ACROSS ALL 116 PAGES:`);
console.log(`Total Unique Products Extracted: ${allProducts.length}`);
console.log(`Unparsed Warnings / Skipped: ${unparsedWarnings.length}`);
console.log(`========================================\n`);

// Test prompt verification examples:
console.log('--- VERIFICATION CHECKS ---');
const p1 = seenPartNumbers.get('14401K0ND00');
console.log('Lookup 14401K0ND00:', p1);

const p2 = seenPartNumbers.get('110201');
console.log('Lookup 110201:', p2);

const p3 = seenPartNumbers.get('21K120LS');
console.log('Lookup 21K120LS:', p3);

const p4 = seenPartNumbers.get('K14144KTCE900S');
console.log('Lookup K14144KTCE900S:', p4);

// Search test
console.log('\n--- SEARCH TEST: "TEMING CHAIN SHINE" ---');
const query = 'TEMING CHAIN SHINE'.toLowerCase();
const matches = allProducts.filter(p => {
  const str = `${p.partNumber} ${p.productName} ${p.alias}`.toLowerCase();
  return str.includes('teming') && str.includes('shine') || str.includes('timing') && str.includes('shine');
});
console.log(`Found ${matches.length} matches for "TEMING CHAIN SHINE". Sample 5:`);
matches.slice(0, 5).forEach(m => console.log(`  [${m.partNumber}] ${m.productName} | Rack: "${m.rack}" | Unit: "${m.unit}" | Stock: ${m.stockQty}`));
