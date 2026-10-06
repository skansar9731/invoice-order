/**
 * Local Product Matching Engine
 * Matches customer handwritten text against local IndexedDB product master
 * Uses multi-tier scoring (Exact, Token Overlap, Automobile Synonyms/Aliases, Fuzzy Levenshtein)
 */

import { getCachedProducts, findExactPartNumberProduct } from './productSearch.js';

// Comprehensive Automobile terminology, Hinglish slang & abbreviation dictionary
const AUTOMOBILE_SYNONYM_MAP = {
  'bor kit': ['cylinder kit', 'bor kit', 'bore kit', 'piston cylinder'],
  'bore kit': ['cylinder kit', 'bor kit', 'bore kit'],
  'chain kit': ['drive chain kit', 'cam chain kit', 'teming c kit', 'chain sprocket'],
  'timing kit': ['teming c kit', 'teming chaine', 'cam chain kit', 'timing chain'],
  'teming': ['timing', 'cam chain', 'timing chain'],
  'wall stem': ['wall stem', 'valve oil seal', 'valve stem seal', 'oil seal valve'],
  'valve seal': ['wall stem', 'valve oil seal'],
  'fource plate': ['pressure plate', 'fource plate', 'clutch plate'],
  'force plate': ['pressure plate', 'fource plate', 'clutch plate'],
  'neutral pati': ['neutral pati', 'contact switch', 'neutral switch', 'gear switch'],
  'brake liner': ['brake liner', 'brake shoe', 'liner'],
  'clutch plate': ['clutch plate', 'clutch assy', 'clutch friction'],
  'clutch plate mc': ['clutch plate mc', 'clutch plate hero', 'clutch plate spl'],
  'spark plug': ['spark plug', 'champion', 'ngk', 'plug'],
  'castrol': ['castrol activ', 'castrol power1', 'engine oil'],
  'castrol 900ml': ['castrol activ 4t 20w-40 900ml', 'castrol 900ml', '20w-40 900ml'],
  'castrol 1l': ['castrol power1 ultimate 10w-40 1l', 'castrol 1l'],
  'air filter': ['air filter element', 'filter element'],
  'petrol cock': ['petrol t-cock', 'petrol valve', 'fuel cock'],
  'clutch wire': ['clutch cable'],
  'brake wire': ['brake cable'],
  'meter wire': ['speedometer cable'],
  'piston ring': ['piston ring set', 'ring set'],
  'silencer packing': ['exhaust silencer packing', 'silencer gasket'],
  'head packing': ['cylinder head gasket kit', 'head gasket']
};

// Generic automobile brand/model modifiers that must NOT trigger matches on their own
const MODIFIER_TOKENS = new Set([
  'spl', 'spl+', 'splendor', 'plus', 'pro', 'bs6', 'bs4', 'hero', 'honda',
  'bajaj', 'tvs', 'yamaha', 'blk', 'std', 'new', 'old', 'set', 'kit', 'assy',
  'ps', 'pss', 'passion', 'shine', 'unicon', 'glamour', 'deluxe', '1', '2', '3', '4', '5'
]);

/**
 * Standardize and clean input strings
 */
function cleanText(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[/\\+,._-]/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract core substantive nouns (excluding generic modifiers)
 */
function getCoreTokens(tokens) {
  return tokens.filter(t => t.length > 1 && !MODIFIER_TOKENS.has(t));
}

/**
 * Compute Levenshtein distance between two strings
 */
function levenshteinDistance(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity ratio (0 to 1) based on Levenshtein distance
 */
function stringSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(s1, s2);
  return Math.max(0, (maxLen - dist) / maxLen);
}

/**
 * Match a single customer handwritten item description against the product master
 * @param {string} customerText - Raw or OCR-extracted customer text
 * @returns {Promise<Object>} Match result with selected product, confidence, tier, and candidate alternatives
 */
export async function matchCustomerItem(customerText) {
  const cleanInput = cleanText(customerText);
  if (!cleanInput) {
    return {
      customerText: '',
      matchedProduct: null,
      confidence: 0,
      tier: 'NONE',
      candidates: []
    };
  }

  const products = await getCachedProducts();
  const inputTokens = cleanInput.split(' ').filter(Boolean);
  const coreInputTokens = getCoreTokens(inputTokens);

  // Check synonym expansions for customer input
  const synonymTargets = [];
  for (const [key, targets] of Object.entries(AUTOMOBILE_SYNONYM_MAP)) {
    if (cleanInput.includes(key) || key.includes(cleanInput)) {
      synonymTargets.push(...targets);
    }
  }

  const candidateScores = [];

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const cleanProdName = cleanText(product.productName);
    const cleanPartNo = cleanText(product.partNumber);
    const prodTokens = cleanProdName.split(' ').filter(Boolean);
    const coreProdTokens = getCoreTokens(prodTokens);

    let score = 0;
    let matchType = 'token';

    // 1. Exact Part Number match (100%)
    if (cleanPartNo === cleanInput || product.partNumber.replace(/[^A-Z0-9]/g, '') === cleanInput.replace(/[^a-z0-9]/g, '').toUpperCase()) {
      score = 100;
      matchType = 'exact_part';
    }
    // 2. Exact Product Name match (98%)
    else if (cleanProdName === cleanInput) {
      score = 98;
      matchType = 'exact_name';
    }
    // 3. Substantive matching
    else {
      // Check core noun matching
      let matchedCoreTokens = 0;
      for (const ct of coreInputTokens) {
        if (
          cleanProdName.includes(ct) ||
          coreProdTokens.some(pt => pt.includes(ct) || ct.includes(pt) || stringSimilarity(ct, pt) > 0.75)
        ) {
          matchedCoreTokens++;
        }
      }

      // CRITICAL RULE: If user gave core product nouns (e.g. "petrol", "valve", "filter", "lever", "clutch"),
      // but NONE match this product, do NOT allow a false match based on generic modifiers (like "spl")!
      if (coreInputTokens.length > 0 && matchedCoreTokens === 0) {
        // Check if full synonym matches
        let hasSynonymMatch = false;
        for (const syn of synonymTargets) {
          if (cleanProdName.includes(cleanText(syn))) {
            hasSynonymMatch = true;
            break;
          }
        }
        if (!hasSynonymMatch) {
          continue; // Discard completely unrelated product
        }
      }

      // Calculate total matched tokens
      let matchedTokens = 0;
      for (const t of inputTokens) {
        if (
          cleanProdName.includes(t) ||
          prodTokens.some(pt => pt === t || pt.startsWith(t) || t.startsWith(pt)) ||
          (t === 'ps' && (cleanProdName.includes('passion') || cleanProdName.includes('ps'))) ||
          (t === 'pss' && cleanProdName.includes('passion'))
        ) {
          matchedTokens++;
        }
      }

      const totalTokens = inputTokens.length;
      const coreRatio = coreInputTokens.length > 0 ? (matchedCoreTokens / coreInputTokens.length) : 1;
      const tokenRatio = totalTokens > 0 ? (matchedTokens / totalTokens) : 0;

      // Base score from core nouns and overall tokens
      score = Math.round((coreRatio * 60) + (tokenRatio * 35));

      // Synonym bonus
      for (const syn of synonymTargets) {
        if (cleanProdName.includes(cleanText(syn))) {
          score = Math.max(score, 85);
        }
      }

      // High overlap bonus
      if (tokenRatio >= 0.8 && coreRatio >= 0.8) {
        score = Math.min(95, score + 10);
      }
    }

    if (score >= 50) {
      candidateScores.push({
        product,
        confidence: score,
        matchType
      });
    }
  }

  // Sort candidates by confidence descending
  candidateScores.sort((a, b) => b.confidence - a.confidence);

  const topCandidates = candidateScores.slice(0, 5);
  const best = topCandidates[0] || null;

  let tier = 'NONE';
  let matchedProduct = null;
  let finalConfidence = 0;

  // Only assign matchedProduct if confidence is at least 50% (Medium or High)
  if (best && best.confidence >= 75) {
    tier = 'HIGH';
    matchedProduct = best.product;
    finalConfidence = best.confidence;
  } else if (best && best.confidence >= 50) {
    tier = 'MEDIUM';
    matchedProduct = best.product;
    finalConfidence = best.confidence;
  } else {
    // If no reliable match found (score < 50%), keep matchedProduct = null
    tier = 'NONE';
    matchedProduct = null;
    finalConfidence = 0;
  }

  return {
    customerText,
    matchedProduct,
    confidence: finalConfidence,
    tier,
    candidates: topCandidates.map(c => ({
      product: c.product,
      confidence: c.confidence
    }))
  };
}

/**
 * Match a single order item with STRICT priority:
 *
 * PRIORITY 1: PART NUMBER (Exact Match)
 * PRIORITY 2: ITEM DESCRIPTION (Fallback only)
 *
 * The system must NEVER reverse this priority.
 *
 * - IF a Part Number is available:
 *   Use extracted Part Number to search existing Product Master FIRST.
 *   Use exact Part Number matching with safe normalization.
 *   IF an exact match exists:
 *     MATCH THE PRODUCT.
 *     STOP MATCHING.
 *     Do NOT perform description matching for that line.
 *     Do NOT replace exact Part Number match with description match.
 *
 * - IF Part Number exists BUT exact match is NOT found in Product Master:
 *   Do not pretend it was a Part Number match.
 *   Try description matching as a SECONDARY fallback.
 *   If description produces a candidate:
 *     Mark matchMethod = 'DESCRIPTION'
 *     Mark matchStatus = 'PART_NUMBER_NOT_FOUND_MATCHED_DESC'
 *   If description produces no candidate:
 *     Mark matchMethod = 'NONE'
 *     Mark matchStatus = 'PART_NUMBER_NOT_FOUND'
 *
 * - ONLY if Part Number is missing / unreadable:
 *   Use description matching.
 *   If matched: matchMethod = 'DESCRIPTION', matchStatus = 'MATCHED_DESCRIPTION'
 *   If unmatched: matchMethod = 'NONE', matchStatus = 'UNMATCHED'
 *
 * @param {Object|string} item - Order item object { partNumber, itemDescription, customerText, quantity } or string
 * @returns {Promise<Object>} Complete match result
 */
export async function matchOrderItem(item = {}) {
  let rawPartNumber = '';
  let rawDescription = '';
  let rawCustomerText = '';

  if (typeof item === 'string') {
    rawCustomerText = item.trim();
  } else if (item && typeof item === 'object') {
    rawPartNumber = String(item.partNumber || '').trim();
    rawDescription = String(item.itemDescription || '').trim();
    rawCustomerText = String(item.customerText || '').trim();
  }

  // If partNumber was not explicitly provided, check if customerText contains an exact Part Number
  if (!rawPartNumber && rawCustomerText) {
    const wholeExact = await findExactPartNumberProduct(rawCustomerText);
    if (wholeExact) {
      rawPartNumber = rawCustomerText;
    } else {
      // Split into whitespace tokens and check each token against product master part numbers
      const tokens = rawCustomerText.split(/\s+/).filter(t => t.length >= 3);
      for (const tok of tokens) {
        const tokExact = await findExactPartNumberProduct(tok);
        if (tokExact) {
          rawPartNumber = tok;
          if (!rawDescription) {
            rawDescription = rawCustomerText.replace(tok, '').trim();
          }
          break;
        }
      }
    }
  }

  const finalDescription = rawDescription || rawCustomerText;

  // ========================================================
  // PRIORITY 1: PART NUMBER MATCHING FIRST
  // ========================================================
  if (rawPartNumber) {
    const exactProduct = await findExactPartNumberProduct(rawPartNumber);
    if (exactProduct) {
      // EXACT PART NUMBER FOUND!
      // STOP MATCHING IMMEDIATELY. Do NOT perform description matching.
      return {
        partNumber: rawPartNumber,
        itemDescription: finalDescription || exactProduct.productName || '',
        customerText: rawCustomerText || `${finalDescription} ${rawPartNumber}`.trim(),
        matchedProduct: exactProduct,
        matchMethod: 'PART_NUMBER',
        matchStatus: 'MATCHED_PART_NUMBER',
        confidence: 100,
        tier: 'HIGH',
        candidates: []
      };
    }

    // Part number was extracted but NO exact match exists in Product Master
    // Use description as secondary fallback, but clearly mark the method & status
    let descFallbackResult = null;
    if (finalDescription) {
      descFallbackResult = await matchCustomerItem(finalDescription);
    }

    if (descFallbackResult && descFallbackResult.matchedProduct) {
      return {
        partNumber: rawPartNumber,
        itemDescription: finalDescription,
        customerText: rawCustomerText || finalDescription,
        matchedProduct: descFallbackResult.matchedProduct,
        matchMethod: 'DESCRIPTION',
        matchStatus: 'PART_NUMBER_NOT_FOUND_MATCHED_DESC',
        confidence: descFallbackResult.confidence,
        tier: descFallbackResult.tier,
        candidates: descFallbackResult.candidates
      };
    }

    // Part number not found in master and description produced no reliable match
    return {
      partNumber: rawPartNumber,
      itemDescription: finalDescription,
      customerText: rawCustomerText || finalDescription,
      matchedProduct: null,
      matchMethod: 'NONE',
      matchStatus: 'PART_NUMBER_NOT_FOUND',
      confidence: 0,
      tier: 'NONE',
      candidates: (descFallbackResult && descFallbackResult.candidates) || []
    };
  }

  // ========================================================
  // PRIORITY 2: ITEM DESCRIPTION MATCHING (Part Number Missing)
  // ========================================================
  const descResult = await matchCustomerItem(finalDescription || rawCustomerText);

  if (descResult && descResult.matchedProduct) {
    return {
      partNumber: '',
      itemDescription: finalDescription || rawCustomerText,
      customerText: rawCustomerText || finalDescription,
      matchedProduct: descResult.matchedProduct,
      matchMethod: 'DESCRIPTION',
      matchStatus: 'MATCHED_DESCRIPTION',
      confidence: descResult.confidence,
      tier: descResult.tier,
      candidates: descResult.candidates
    };
  }

  return {
    partNumber: '',
    itemDescription: finalDescription || rawCustomerText,
    customerText: rawCustomerText || finalDescription,
    matchedProduct: null,
    matchMethod: 'NONE',
    matchStatus: 'UNMATCHED',
    confidence: 0,
    tier: 'NONE',
    candidates: (descResult && descResult.candidates) || []
  };
}

/**
 * Batch match an entire array of customer extracted order items
 * Uses strict Part Number First priority for each line.
 * @param {Array<Object>} items - Array of items
 * @returns {Promise<Array>} Array of matched order items ready for review table
 */
export async function matchAllOrderItems(items) {
  const results = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const matchResult = await matchOrderItem(item);

    results.push({
      id: 'item-' + Date.now() + '-' + i + '-' + Math.random().toString(36).substr(2, 4),
      sNo: i + 1,
      partNumber: matchResult.partNumber || item.partNumber || '',
      itemDescription: matchResult.itemDescription || item.itemDescription || item.customerText || '',
      customerText: item.customerText || matchResult.customerText || '',
      quantity: Number(item.quantity) || 1,
      rate: (item.rate !== undefined && item.rate !== null && item.rate !== '') ? Number(item.rate) : null,
      matchedProduct: matchResult.matchedProduct,
      matchMethod: matchResult.matchMethod,
      matchStatus: matchResult.matchStatus,
      confidence: matchResult.confidence,
      tier: matchResult.tier,
      isManual: false,
      candidates: matchResult.candidates,
      sourceImage: item.sourceImage || null
    });
  }

  return results;
}
