/**
 * Product Master & Stock PDF Importer
 * Uses PDF.js to extract text from multi-page stock PDF reports
 * Provides high-accuracy coordinate column extraction and field normalization
 */

import { upsertProducts } from './db.js';
import { invalidateSearchCache } from './productSearch.js';

// Table column boundaries for Busy / Maharashtra Automobile stock report layout
const COL_BOUNDS = {
  NAME: { min: 20, max: 205 },
  ALIAS: { min: 205, max: 369 },
  PARENT_GROUP: { min: 369, max: 440 },
  OP_STOCK: { min: 440, max: 480 },
  UNIT: { min: 480, max: 512 },
  RACK: { min: 512, max: 600 }
};

/**
 * Extract structured rows directly from a stock list PDF file using PDF.js
 * @param {File} file - PDF File object
 * @param {function} onProgress - Progress callback (page, totalPages)
 * @returns {Promise<Array>} Array of parsed product records
 */
export async function extractProductsFromPDF(file, onProgress = null) {
  if (!window.pdfjsLib) {
    throw new Error('PDF.js library is not loaded. Please check your internet connection or local scripts.');
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const rawProducts = [];
  const warnings = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Group text items by approximate Y-coordinate (baseline grouping)
    const itemsByY = {};
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;
      const yKey = Math.round(item.transform[5] / 3) * 3;
      if (!itemsByY[yKey]) itemsByY[yKey] = [];
      itemsByY[yKey].push({
        x: item.transform[4],
        text: item.str
      });
    }

    // Sort baselines top to bottom (PDF Y coordinates go bottom to top)
    const sortedY = Object.keys(itemsByY).map(Number).sort((a, b) => b - a);

    for (const y of sortedY) {
      const rowItems = itemsByY[y];
      const rawLine = rowItems.map(i => i.text).join(' ').trim();
      const lower = rawLine.toLowerCase();

      // Skip headers and page footers
      if (
        lower.includes('maharashtra automobile') ||
        lower.includes('nanded, maharashtra') ||
        lower.includes('gstin :') ||
        lower.includes('list of items') ||
        (lower.includes('name') && lower.includes('parent group')) ||
        lower.includes('totals c/o') ||
        lower.includes('totals b/d') ||
        lower.includes('contd. on page') ||
        lower.includes('grand total') ||
        (lower.startsWith('page ') && lower.includes('list of items'))
      ) {
        continue;
      }

      const fields = extractRowFields(rowItems);
      if (!fields.name && !fields.alias) continue;

      const parsed = parseNameField(fields.name, fields.alias);
      if (!parsed.partNumber && !parsed.productName) {
        warnings.push({ page: pageNum, raw: rawLine });
        continue;
      }

      // Preserve empty/missing data strictly as null / ''
      const stockQty = fields.opStock ? (parseFloat(fields.opStock) || null) : null;
      const rack = fields.rack || '';
      const unit = fields.unit || '';
      const alias = parsed.alias || fields.alias || '';
      const parentGroup = fields.parentGroup || '';
      const rate = parsed.rate !== null ? parsed.rate : null;

      rawProducts.push({
        partNumber: parsed.partNumber,
        productName: parsed.productName,
        alias,
        parentGroup,
        stockQty,
        unit,
        rack,
        rate,
        page: pageNum
      });
    }

    if (onProgress) {
      onProgress(pageNum, numPages);
    }
  }

  return {
    products: rawProducts,
    warnings,
    totalPages: numPages
  };
}

/**
 * Group row items into column fields based on X coordinates
 */
function extractRowFields(items) {
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
 * Separate Part Number, Product Description, Rate, and trailing Alias
 */
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

  // Split Part Number and Product Name
  let partNumber = '';
  let productName = '';

  // Glued check: e.g. "13011krm305spiston Ring Std C B Z" or "14400KWP901TEMING CHAIN ACTIVA"
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

  return { partNumber: partNumber.trim(), productName: productName.trim(), alias, rate };
}

/**
 * Complete Stock PDF Import Process
 * @param {File} file - PDF File
 * @param {boolean} isReplace - Replace Master vs Update/Merge
 * @param {function} onProgress - Progress reporting (step, message, pct)
 */
export async function processStockPDFImport(file, isReplace = false, onProgress = null) {
  if (onProgress) onProgress('extracting', 'Reading PDF pages...', 10);

  const { products, warnings, totalPages } = await extractProductsFromPDF(file, (pageNum, total) => {
    if (onProgress) {
      const pct = Math.round(10 + (pageNum / total) * 60);
      onProgress('extracting', `Extracting page ${pageNum} of ${total}...`, pct);
    }
  });

  if (products.length === 0) {
    throw new Error('No valid product rows were detected in the supplied PDF. Please verify the PDF format.');
  }

  if (onProgress) onProgress('saving', `Saving ${products.length} products to local database...`, 75);

  const result = await upsertProducts(products, isReplace, (saved, total) => {
    if (onProgress) {
      const pct = Math.round(75 + (saved / total) * 23);
      onProgress('saving', `Storing product ${saved} of ${total}...`, pct);
    }
  }, {
    fileName: file.name,
    date: new Date().toISOString()
  });

  // Clear in-memory search cache so newly imported items are immediately searchable
  invalidateSearchCache();

  if (onProgress) onProgress('complete', 'Stock import successfully finished!', 100);

  return {
    importedCount: result.totalImported,
    currentTotal: result.currentTotal,
    unparsedCount: warnings.length,
    totalPages,
    mode: isReplace ? 'Replaced Master' : 'Merged / Updated'
  };
}
