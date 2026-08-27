/**
 * Product Master & Stock PDF Importer
 * Uses PDF.js to extract text from multi-page stock PDF reports
 * Provides high-accuracy coordinate column extraction and field normalization
 */

import { upsertProducts } from './db.js';
import { invalidateSearchCache } from './productSearch.js';

// Table column boundaries for Busy / Maharashtra Automobile stock report layouts
const LAYOUT_STOCK_STATUS = {
  NAME: { min: 20, max: 320 },
  OP_STOCK: { min: 320, max: 365 },
  UNIT: { min: 365, max: 410 },
  MRP: { min: 410, max: 488 },
  RACK: { min: 488, max: 600 }
};

const LAYOUT_LIST_OF_ITEMS = {
  NAME: { min: 20, max: 205 },
  ALIAS: { min: 205, max: 369 },
  PARENT_GROUP: { min: 369, max: 440 },
  OP_STOCK: { min: 440, max: 485 },
  UNIT: { min: 485, max: 505 },
  RACK: { min: 505, max: 600 }
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
  const productMap = new Map();
  const warnings = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Determine layout type dynamically per page
    const pageText = textContent.items.map(i => i.str).join(' ').toLowerCase();
    const isStockStatus = pageText.includes('stock status') || (pageText.includes('item details') && pageText.includes('mrp'));
    const layoutType = isStockStatus ? 'STOCK_STATUS' : 'LIST_OF_ITEMS';
    const bounds = isStockStatus ? LAYOUT_STOCK_STATUS : LAYOUT_LIST_OF_ITEMS;

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

      const fields = extractRowFields(rowItems, bounds, layoutType);
      if (!fields.name && !fields.alias) continue;

      const parsed = parseNameField(fields.name, fields.alias);
      if (!parsed.partNumber && !parsed.productName) {
        warnings.push({ page: pageNum, raw: rawLine });
        continue;
      }

      // Preserve empty/missing data strictly as null / ''
      let stockQty = null;
      if (fields.opStock) {
        const cleanStock = fields.opStock.replace(/,/g, '');
        const num = parseFloat(cleanStock);
        if (!isNaN(num)) stockQty = num;
      }

      let rate = parsed.rate !== null ? parsed.rate : null;
      if (fields.mrp) {
        const cleanMrp = fields.mrp.replace(/,/g, '');
        const numMrp = parseFloat(cleanMrp);
        if (!isNaN(numMrp)) rate = numMrp;
      }

      const rack = fields.rack ? fields.rack.trim() : '';
      const unit = fields.unit ? fields.unit.trim() : '';
      const alias = parsed.alias || fields.alias || '';
      const parentGroup = fields.parentGroup || '';

      const newProduct = {
        partNumber: parsed.partNumber,
        productName: parsed.productName,
        itemDetails: parsed.itemDetails || fields.name.trim(),
        alias,
        parentGroup,
        stockQty,
        unit,
        rack,
        rate,
        mrp: rate,
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
        // 2. If prev has positive stock and new does not, keep prev but fill missing fields
        else if (prev.stockQty !== null && prev.stockQty > 0 && (newProduct.stockQty === null || newProduct.stockQty <= 0)) {
          if (!prev.rack && newProduct.rack) prev.rack = newProduct.rack;
          if (!prev.rate && newProduct.rate) prev.rate = newProduct.rate;
          if (!prev.itemDetails && newProduct.itemDetails) prev.itemDetails = newProduct.itemDetails;
          if (!prev.alias && newProduct.alias) prev.alias = newProduct.alias;
        }
        // 3. If both have stock, sum stock and prefer populated rack & rate
        else if (newProduct.stockQty !== null && newProduct.stockQty > 0 && prev.stockQty !== null && prev.stockQty > 0) {
          prev.stockQty = prev.stockQty + newProduct.stockQty;
          if (!prev.rack && newProduct.rack) prev.rack = newProduct.rack;
          if (!prev.rate && newProduct.rate) prev.rate = newProduct.rate;
          if (!prev.itemDetails && newProduct.itemDetails) prev.itemDetails = newProduct.itemDetails;
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

    if (onProgress) {
      onProgress(pageNum, numPages);
    }
  }

  const rawProducts = Array.from(productMap.values());

  return {
    products: rawProducts,
    warnings,
    totalPages: numPages
  };
}

/**
 * Group row items into column fields based on X coordinates and layout
 */
function extractRowFields(items, bounds = LAYOUT_LIST_OF_ITEMS, layoutType = 'LIST_OF_ITEMS') {
  items.sort((a, b) => a.x - b.x);

  const fields = {
    name: '',
    alias: '',
    parentGroup: '',
    opStock: '',
    unit: '',
    mrp: '',
    rack: ''
  };

  for (const item of items) {
    const text = item.text.trim();
    if (!text) continue;
    const x = item.x;

    if (layoutType === 'STOCK_STATUS') {
      if (x < bounds.NAME.max) {
        fields.name = fields.name ? `${fields.name} ${text}` : text;
      } else if (x < bounds.OP_STOCK.max) {
        fields.opStock = fields.opStock ? `${fields.opStock} ${text}` : text;
      } else if (x < bounds.UNIT.max) {
        fields.unit = fields.unit ? `${fields.unit} ${text}` : text;
      } else if (x < bounds.MRP.max) {
        fields.mrp = fields.mrp ? `${fields.mrp} ${text}` : text;
      } else {
        fields.rack = fields.rack ? `${fields.rack} ${text}` : text;
      }
    } else {
      if (x < bounds.NAME.max) {
        fields.name = fields.name ? `${fields.name} ${text}` : text;
      } else if (x < bounds.ALIAS.max) {
        fields.alias = fields.alias ? `${fields.alias} ${text}` : text;
      } else if (x < bounds.PARENT_GROUP.max) {
        fields.parentGroup = fields.parentGroup ? `${fields.parentGroup} ${text}` : text;
      } else if (x < bounds.OP_STOCK.max) {
        fields.opStock = fields.opStock ? `${fields.opStock} ${text}` : text;
      } else if (x < bounds.UNIT.max) {
        fields.unit = fields.unit ? `${fields.unit} ${text}` : text;
      } else {
        fields.rack = fields.rack ? `${fields.rack} ${text}` : text;
      }
    }
  }

  return fields;
}

/**
 * Separate Part Number, Product Description, Rate, and trailing Alias
 */
export function parseNameField(rawName, existingAlias = '') {
  if (!rawName) return { partNumber: '', productName: '', itemDetails: '', alias: existingAlias, rate: null };

  const fullOriginalItemDetails = rawName.trim();
  let text = fullOriginalItemDetails;
  let alias = (existingAlias || '').trim();
  let rate = null;

  // Extract rate from rate markers (e.g. " 193/- ", " 3290/-- ", " 2050/- 2255/- ", " 59/- ")
  const priceEndMatch = text.match(/^(.*?)\s+(\d+(?:\.\d+)?\s*\/(?:[-–—.]*|\s*\d+[-–—.]*|\s*\/)?(?:\s+\d+(?:\.\d+)?\s*\/(?:[-–—.]*)?)*)$/);
  if (priceEndMatch && priceEndMatch[1].trim().length >= 3) {
    const candidateRateStr = priceEndMatch[2].trim();
    const nums = candidateRateStr.match(/\d+(?:\.\d+)?/g);
    if (nums && nums.length > 0) {
      rate = parseFloat(nums[nums.length - 1]);
    }
  } else {
    // Check if rate is with trailing alias e.g. " 193/- ALIAS"
    const rateWithTrailingAlias = text.match(/^(.*?)\s+(\d+(?:\.\d+)?\s*\/(?:[-–—.]*|\s*\d+[-–—.]*|\s*\/)?)\s+([A-Za-z0-9\-_./].*)$/);
    if (rateWithTrailingAlias && rateWithTrailingAlias[1].trim().length >= 3) {
      const rateStr = rateWithTrailingAlias[2].trim();
      const trailingAlias = rateWithTrailingAlias[3].trim();
      const numMatch = rateStr.match(/\d+(?:\.\d+)?/);
      if (numMatch) rate = parseFloat(numMatch[0]);
      if (!alias) alias = trailingAlias;
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

  return { partNumber: partNumber.trim(), productName: productName.trim(), itemDetails: fullOriginalItemDetails, alias, rate };
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
