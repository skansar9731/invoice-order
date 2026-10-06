/**
 * Fast Local Product Search Engine
 * Features:
 * - In-memory caching for instant keystroke searches across 10,000+ items
 * - Multi-word token matching (all keywords must match or scored highest)
 * - Part number prefix & substring search
 * - Fuzzy / spelling-tolerant tolerance for minor typos
 * - Abbreviation & synonym expansion (e.g. 'c kit' -> 'chain kit / timing c kit', 'bor' -> 'bor kit / cylinder')
 */

import { getDB, getAllProducts } from './db.js';

let cachedProducts = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute auto refresh if updated

// Common automobile terms & abbreviation dictionary
export const TERM_EXPANSIONS = {
  'teming': 'timing',
  'chaine': 'chain',
  'c kit': 'chain kit',
  'bor': 'bore cylinder',
  'spl': 'splendor',
  'spl+': 'splendor plus',
  'fource': 'pressure clutch',
  'pati': 'plate switch',
  'wall': 'valve',
  'stem': 'oil seal',
  'brk': 'brake',
  'clt': 'clutch',
  'aic': 'aic brake',
  'mc': 'master cylinder hero',
  'assy': 'assembly'
};

// In-memory exact lookup indexes for instant scanner matching (O(1))
let partNumberMap = new Map(); // normalized (trimmed uppercase) partNumber -> Array of products
let cleanPartNumberMap = new Map(); // clean alphanumeric partNumber -> Array of products

/**
 * Invalidate product cache when new stock is imported or master replaced
 */
export function invalidateSearchCache() {
  cachedProducts = null;
  partNumberMap = new Map();
  cleanPartNumberMap = new Map();
  lastCacheTime = 0;
}

/**
 * Ensure product cache is loaded in memory for ultra-fast keystroke search
 */
export async function getCachedProducts(forceRefresh = false) {
  const now = Date.now();
  if (cachedProducts && !forceRefresh && (now - lastCacheTime < CACHE_TTL_MS)) {
    return cachedProducts;
  }

  const all = await getAllProducts();
  
  partNumberMap = new Map();
  cleanPartNumberMap = new Map();

  // Pre-tokenize and normalize for fast search
  cachedProducts = all.map(p => {
    const rawPart = (p.partNumber || '').trim();
    const normPart = rawPart.toUpperCase();
    const cleanPart = normPart.replace(/[^A-Z0-9]/g, '');
    const normName = (p.productName || '').toUpperCase();
    const normRack = (p.rack || '').toUpperCase();
    const normGroup = (p.parentGroup || p.group || '').toUpperCase();
    const cleanSearchStr = `${normPart} ${normName} ${normRack} ${normGroup}`.toLowerCase();
    
    const prod = {
      ...p,
      _searchStr: cleanSearchStr,
      _cleanPart: cleanPart,
      _cleanNameTokens: normName.toLowerCase().split(/[\s\-_/+,.]+/).filter(Boolean)
    };

    if (normPart) {
      if (!partNumberMap.has(normPart)) {
        partNumberMap.set(normPart, []);
      }
      partNumberMap.get(normPart).push(prod);
    }

    if (cleanPart) {
      if (!cleanPartNumberMap.has(cleanPart)) {
        cleanPartNumberMap.set(cleanPart, []);
      }
      cleanPartNumberMap.get(cleanPart).push(prod);
    }

    return prod;
  });

  lastCacheTime = now;
  return cachedProducts;
}

/**
 * Normalizes a part number for exact comparisons
 * Safely trims and handles consistent uppercase comparison
 */
export function normalizePartNumber(partNo) {
  if (!partNo) return '';
  return String(partNo).trim().toUpperCase();
}

/**
 * Checks if a string has QR code / barcode delimited payload structure
 */
export function isQRPayload(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();
  if (clean.includes('/')) {
    const segments = clean.split('/').map(s => s.trim()).filter(Boolean);
    if (segments.length >= 2) return true;
  }
  if (clean.includes('|')) {
    const segments = clean.split('|').map(s => s.trim()).filter(Boolean);
    if (segments.length >= 2) return true;
  }
  if (clean.includes(';')) {
    const segments = clean.split(';').map(s => s.trim()).filter(Boolean);
    if (segments.length >= 3) return true;
  }
  return false;
}

/**
 * Intelligently extracts the Part Number from a scanned QR payload or raw text.
 * - Does NOT assume a fixed token position.
 * - Inspects existing product master and compares meaningful tokens against product Part Numbers.
 * - Uses exact & clean normalized lookup.
 * - Falls back to automotive part number heuristics if not yet in master.
 */
export async function extractPartNumberFromScannedText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { partNumber: '', isScanner: false, matchedInMaster: false };
  }

  const trimmed = rawText.trim();
  const products = await getCachedProducts();

  // If not a delimited payload, treat trimmed string as part number directly
  if (!isQRPayload(trimmed)) {
    const norm = normalizePartNumber(trimmed);
    return {
      partNumber: trimmed,
      isScanner: false,
      matchedInMaster: partNumberMap.has(norm)
    };
  }

  // Extract delimited segment if surrounded by any prefix/suffix
  const qrMatch = trimmed.match(/[A-Za-z0-9_\-.]+(?:\/[A-Za-z0-9_\-.]+){2,}/);
  const payloadToParse = qrMatch ? qrMatch[0] : trimmed;

  // Determine delimiter (primary is '/', fallback to '|' or ';')
  let delimiter = '/';
  if (!payloadToParse.includes('/') && payloadToParse.includes('|')) delimiter = '|';
  else if (!payloadToParse.includes('/') && payloadToParse.includes(';')) delimiter = ';';

  // Split into tokens, trim each token and filter out empty tokens
  const rawTokens = payloadToParse
    .split(delimiter)
    .map(t => t.trim())
    .filter(Boolean);

  if (rawTokens.length === 0) {
    return { partNumber: trimmed, isScanner: true, matchedInMaster: false };
  }

  // 1. FIRST PASS: Direct exact match against existing product master Part Numbers
  for (const token of rawTokens) {
    const norm = normalizePartNumber(token);
    if (partNumberMap.has(norm)) {
      return {
        partNumber: token,
        isScanner: true,
        matchedInMaster: true
      };
    }
  }

  // 2. SECOND PASS: Clean comparison against product master (ignoring hyphens / whitespace)
  for (const token of rawTokens) {
    const clean = token.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length >= 3 && cleanPartNumberMap.has(clean)) {
      const matchedProd = cleanPartNumberMap.get(clean)[0];
      return {
        partNumber: matchedProd.partNumber || token,
        isScanner: true,
        matchedInMaster: true
      };
    }
  }

  // 3. THIRD PASS: Fallback heuristic if the scanned product is not yet in the master
  let bestToken = '';
  let highestScore = -Infinity;

  for (const token of rawTokens) {
    const score = scoreTokenAsPartNumber(token, products);
    if (score > highestScore) {
      highestScore = score;
      bestToken = token;
    }
  }

  return {
    partNumber: bestToken || rawTokens[0],
    isScanner: true,
    matchedInMaster: false
  };
}

/**
 * Score candidate token based on standard automotive part number characteristics
 */
function scoreTokenAsPartNumber(token, products = []) {
  const t = token.trim();
  const len = t.length;

  // Single characters or tiny tokens (e.g. 'D', '1', 'G', '00')
  if (len <= 2) return -1000;

  // Pure floats / prices (e.g. '0000575.00')
  if (/^\d+\.\d+$/.test(t)) return -800;

  // Pure digits with leading zeros or all zeros (e.g. '000001', '000', '00')
  if (/^0+\d*$/.test(t)) return -700;

  // Very short all-digit numbers (e.g. '123')
  if (/^\d{1,4}$/.test(t)) return -500;

  // Pure uppercase 2-4 letter words (e.g. 'ACH', 'QTY', 'PCS')
  if (/^[A-Z]{2,4}$/.test(t)) return -300;

  // Invoice / challan / DC prefix: typically 4 alpha letters followed by 8+ digits (e.g. 'GHXG0001483030')
  if (/^[A-Z]{4}\d{8,}$/.test(t)) return -100;

  let score = 50;

  // Check if token prefix (first 3 to 5 chars) matches prefixes commonly found in the product master
  if (products && products.length > 0) {
    const prefix3 = t.substring(0, 3).toUpperCase();
    const prefix5 = t.substring(0, 5).toUpperCase();
    let prefixHits = 0;
    for (let i = 0; i < Math.min(products.length, 500); i++) {
      const pNum = (products[i].partNumber || '').toUpperCase();
      if (pNum.startsWith(prefix5)) prefixHits += 3;
      else if (pNum.startsWith(prefix3)) prefixHits += 1;
      if (prefixHits >= 15) break;
    }
    score += prefixHits * 10;
  }

  // Automobile OEM part numbers usually start with 4-5 digits (e.g. 35100AAE301S, 14401K0ND00, 17950AAW000, 22815166000S)
  if (/^\d{4,5}[A-Z]/.test(t)) {
    score += 150;
  } else if (/^\d{2}[A-Z]\d{3}/.test(t)) {
    score += 120;
  } else if (/^\d{4,5}-/.test(t)) {
    score += 150;
  } else if (/^[A-Z]\d{5,}/.test(t)) {
    score += 100;
  } else if (/^\d{6,}$/.test(t)) {
    score += 60;
  } else if (/^[A-Z0-9\-_./]+$/i.test(t)) {
    score += 30;
  }

  // OEM Part Number Suffix bonus: Hero/Honda parts often end in S, 00, 900, 000, 01, 301S, etc.
  if (/[0-9][A-Z]$/.test(t) || /S$/i.test(t)) {
    score += 40;
  }

  // Penalty for purely random high-entropy strings without standard part structure (e.g. 'HCG6NWLX8PPJ')
  if (/^[A-Z0-9]{12}$/.test(t) && !/^\d/.test(t)) {
    score -= 40;
  }

  return score;
}

/**
 * Performs exact normalized Part Number search for scanner results
 * Only returns products with exact matching part numbers
 * @param {string} partNumber - Scanned or extracted part number
 * @returns {Promise<{total: number, items: Array, query: string, isExactScanner: boolean}>}
 */
export async function searchExactPartNumber(partNumber) {
  const normTarget = normalizePartNumber(partNumber);
  if (!normTarget) {
    return { total: 0, items: [], query: '', isExactScanner: true };
  }

  await getCachedProducts();

  // 1. Direct exact normalized match in partNumberMap (O(1))
  let matches = partNumberMap.get(normTarget);
  if (matches && matches.length > 0) {
    return {
      total: matches.length,
      items: matches,
      query: normTarget,
      isExactScanner: true
    };
  }

  // 2. Clean match in cleanPartNumberMap (ignoring hyphens, spaces, e.g. 35100-AAE-301S vs 35100AAE301S)
  const cleanTarget = normTarget.replace(/[^A-Z0-9]/g, '');
  if (cleanTarget.length >= 3) {
    matches = cleanPartNumberMap.get(cleanTarget);
    if (matches && matches.length > 0) {
      return {
        total: matches.length,
        items: matches,
        query: normTarget,
        isExactScanner: true
      };
    }
  }

  // 3. Fallback scan across products if map did not match
  const products = await getCachedProducts();
  const exact = products.filter(p => normalizePartNumber(p.partNumber) === normTarget);
  if (exact.length > 0) {
    return {
      total: exact.length,
      items: exact,
      query: normTarget,
      isExactScanner: true
    };
  }

  return {
    total: 0,
    items: [],
    query: normTarget,
    isExactScanner: true
  };
}

/**
 * Clean & normalize search text
 */
export function normalizeQuery(query) {
  return (query || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s\-_+.]/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Perform high-performance multi-criteria search
 * @param {string} query - User search string
 * @param {number} limit - Max results to return (default 50)
 * @param {number} offset - Offset for pagination
 */
export async function searchLocalProducts(query, limit = 50, offset = 0) {
  const normalized = normalizeQuery(query);
  const products = await getCachedProducts();

  if (!normalized) {
    // Return sorted by part number / product name
    const slice = products.slice(offset, offset + limit);
    return {
      total: products.length,
      items: slice,
      query: ''
    };
  }

  const queryClean = normalized.replace(/[^a-z0-9]/g, '');
  const tokens = normalized.split(' ').filter(Boolean);

  // Expand tokens with abbreviations
  const expandedTokens = [];
  tokens.forEach(t => {
    expandedTokens.push(t);
    if (TERM_EXPANSIONS[t]) {
      TERM_EXPANSIONS[t].split(' ').forEach(exp => expandedTokens.push(exp));
    }
  });

  const scoredResults = [];

  for (let i = 0; i < products.length; i++) {
    const item = products[i];
    let score = 0;

    // 1. Exact Part Number match (top priority)
    if (item.partNumber.toLowerCase() === normalized) {
      score += 1000;
    } else if (item._cleanPart.includes(queryClean) && queryClean.length >= 3) {
      score += 500;
    } else if (item.partNumber.toLowerCase().startsWith(normalized)) {
      score += 400;
    } else if (item.partNumber.toLowerCase().includes(normalized)) {
      score += 200;
    }

    // 2. Exact Product Name match
    if (item.productName.toLowerCase() === normalized) {
      score += 600;
    } else if (item.productName.toLowerCase().startsWith(normalized)) {
      score += 300;
    }

    // 3. Rack exact or partial match
    if (item.rack && item.rack.toLowerCase().includes(normalized)) {
      score += 100;
    }

    // 3b. Group exact or partial match
    const itemGroup = (item.parentGroup || item.group || '').toLowerCase();
    if (itemGroup && (itemGroup === normalized || itemGroup.includes(normalized))) {
      score += 150;
    }

    // 4. Multi-token match across product fields
    let matchedTokenCount = 0;
    for (const token of tokens) {
      if (item._searchStr.includes(token)) {
        matchedTokenCount++;
        score += 80;
      }
    }

    // Bonus for matching all input tokens
    if (matchedTokenCount === tokens.length && tokens.length > 1) {
      score += 250;
    }

    // 5. Check expanded synonym tokens
    for (const expToken of expandedTokens) {
      if (!tokens.includes(expToken) && item._searchStr.includes(expToken)) {
        score += 30;
      }
    }

    // 6. Substring containment bonus
    if (item.productName.toLowerCase().includes(normalized)) {
      score += 150;
    }

    if (score > 0) {
      scoredResults.push({ item, score });
    }
  }

  // Sort by score descending, then by productName ascending
  scoredResults.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.productName.localeCompare(b.item.productName);
  });

  const total = scoredResults.length;
  const paginated = scoredResults.slice(offset, offset + limit).map(r => r.item);

  return {
    total,
    items: paginated,
    query: normalized
  };
}

/**
 * Debounce helper utility
 */
export function debounce(func, wait = 200) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
