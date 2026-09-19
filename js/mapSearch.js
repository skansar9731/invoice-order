/**
 * Unified Location & Product Search Engine for Rack Map & Counter Map
 * Maharashtra Automobile — Physical Storage Floor & Counter Reference Layer
 *
 * Supports dual-mode searching:
 * 1. Location search (e.g. "72", "R-72", "Rack 72" / "1", "C1", "Counter 1")
 * 2. Product Master search (e.g. "21K120LS", "52400KWH961ZAS", "CLUTCH", "BAJAJ", "305", "Pcs")
 *
 * Source of Truth: Existing Product Master in IndexedDB.
 */

import { parseProductRack, parseProductCounter } from './rackParser.js';

/**
 * Clean & normalize search query
 */
export function normalizeSearchQuery(query) {
  if (!query) return '';
  return String(query)
    .toLowerCase()
    .replace(/[^\w\s\-_+.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if a product matches the search query across all searchable fields:
 * - partNumber
 * - productName
 * - itemDetails
 * - group / parentGroup
 * - rack
 * - unit
 * - rate / mrp
 * - alias
 */
export function matchProduct(product, query) {
  if (!product || !query) return false;
  const q = normalizeSearchQuery(query);
  if (!q) return false;

  const partNumber = String(product.partNumber || '').trim().toLowerCase();
  const productName = String(product.productName || '').trim().toLowerCase();
  const itemDetails = String(product.itemDetails || '').trim().toLowerCase();
  const rawGroup = product.group || product.parentGroup || '';
  const group = String(rawGroup).trim().toLowerCase();
  const rack = String(product.rack || '').trim().toLowerCase();
  const unit = String(product.unit || '').trim().toLowerCase();
  const rate = product.rate !== null && product.rate !== undefined ? String(product.rate).trim().toLowerCase() : '';
  const mrp = product.mrp !== null && product.mrp !== undefined ? String(product.mrp).trim().toLowerCase() : '';
  const alias = String(product.alias || '').trim().toLowerCase();

  // 1. Alphanumeric clean match (e.g. "21k120ls", "52400kwh961zas")
  const qClean = q.replace(/[^a-z0-9]/g, '');
  const partClean = partNumber.replace(/[^a-z0-9]/g, '');
  if (qClean.length >= 2 && partClean.includes(qClean)) {
    return true;
  }

  // 2. Direct substring match on primary fields
  if (
    partNumber.includes(q) ||
    productName.includes(q) ||
    itemDetails.includes(q) ||
    group.includes(q) ||
    rack.includes(q) ||
    unit === q ||
    unit.includes(q) ||
    rate.includes(q) ||
    mrp.includes(q) ||
    alias.includes(q)
  ) {
    return true;
  }

  // 3. Multi-token match: all space-separated keywords must appear in combined text
  const tokens = q.split(' ').filter(Boolean);
  if (tokens.length > 1) {
    const combined = `${partNumber} ${productName} ${itemDetails} ${group} ${rack} ${unit} ${rate} ${mrp} ${alias}`;
    if (tokens.every(token => combined.includes(token))) {
      return true;
    }
  }

  return false;
}

/**
 * Check if query directly references a Rack location (e.g. "72", "R-72", "Rack 72", "R72")
 */
export function matchRackLocation(rack, query) {
  if (!rack || !query) return false;
  const q = normalizeSearchQuery(query);
  const qClean = q.replace(/[^a-z0-9]/g, '');
  const rIdClean = rack.id.toLowerCase().replace(/[^a-z0-9]/g, '');
  const rNum = String(rack.rackNum);
  const rName = rack.name.toLowerCase();

  return (
    q === rNum ||
    qClean === rIdClean ||
    qClean === `rack${rNum}` ||
    qClean === `r${rNum}` ||
    rName === q ||
    rName.includes(q) ||
    rack.id.toLowerCase() === q
  );
}

/**
 * Check if query directly references a Counter location (e.g. "1", "C1", "C-1", "Counter 1")
 */
export function matchCounterLocation(counter, query) {
  if (!counter || !query) return false;
  const q = normalizeSearchQuery(query);
  const qClean = q.replace(/[^a-z0-9]/g, '');
  const cIdClean = counter.id.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cNum = String(counter.counterNum);
  const cName = counter.name.toLowerCase();

  return (
    q === cNum ||
    qClean === cIdClean ||
    qClean === `counter${cNum}` ||
    qClean === `c${cNum}` ||
    cName === q ||
    cName.includes(q) ||
    counter.id.toLowerCase() === q
  );
}

/**
 * Search Rack Map against Location and Product Master data
 * @param {Map} rackIndex - Map of rackId -> RackData
 * @param {Array} productMaster - Array of all products in IndexedDB
 * @param {string} query - Raw search query string
 * @returns {Object} Search result containing matched racks, matched products, and status
 */
export function searchRackMap(rackIndex, productMaster, query) {
  const allRacks = Array.from(rackIndex.values()).sort((a, b) => a.rackNum - b.rackNum);
  const rawQ = (query || '').trim();
  if (!rawQ) {
    return {
      isSearching: false,
      query: '',
      matchedRacks: allRacks,
      totalMatchedProducts: 0
    };
  }

  const normQ = normalizeSearchQuery(rawQ);

  // 1. Find all matching products in Product Master
  const matchingProducts = (productMaster || []).filter(p => matchProduct(p, normQ));

  // 2. Map matching products to racks & determine relevant physical sections
  const rackMatchesMap = new Map();

  // A. Add products that match
  matchingProducts.forEach(product => {
    if (!product.rack) return;
    const parsed = parseProductRack(product.rack);
    if (!parsed) return;

    const rackId = parsed.rackId;
    const rackObj = rackIndex.get(rackId);
    if (!rackObj) return;

    if (!rackMatchesMap.has(rackId)) {
      rackMatchesMap.set(rackId, {
        rack: rackObj,
        matchedProducts: [],
        relevantSections: new Set(),
        relevantLocations: new Set(),
        isLocationMatch: false
      });
    }

    const matchEntry = rackMatchesMap.get(rackId);
    matchEntry.matchedProducts.push(product);

    (parsed.sections || []).forEach(sec => matchEntry.relevantSections.add(sec));
    (parsed.locations || []).forEach(loc => {
      if (loc.label) {
        matchEntry.relevantLocations.add(loc.label);
      } else if (loc.section) {
        matchEntry.relevantLocations.add(loc.subSection ? `${loc.section}${loc.subSection}` : loc.section);
      }
    });
  });

  // B. Check location match (e.g. user typed "72" or "R-72")
  allRacks.forEach(rackObj => {
    if (matchRackLocation(rackObj, normQ)) {
      if (!rackMatchesMap.has(rackObj.id)) {
        rackMatchesMap.set(rackObj.id, {
          rack: rackObj,
          matchedProducts: rackObj.allProducts || [],
          relevantSections: new Set(Array.from(rackObj.sectionMap.keys())),
          relevantLocations: new Set(),
          isLocationMatch: true
        });
      } else {
        rackMatchesMap.get(rackObj.id).isLocationMatch = true;
      }
    }
  });

  const matchedRacks = Array.from(rackMatchesMap.values())
    .map(entry => ({
      ...entry.rack,
      matchedProducts: entry.matchedProducts,
      relevantSections: Array.from(entry.relevantSections).sort(),
      relevantLocations: Array.from(entry.relevantLocations).sort(),
      isLocationMatch: entry.isLocationMatch
    }))
    .sort((a, b) => a.rackNum - b.rackNum);

  return {
    isSearching: true,
    query: rawQ,
    matchedRacks,
    totalMatchedProducts: matchingProducts.length
  };
}

/**
 * Search Counter Map against Location and Product Master data
 * @param {Map} counterIndex - Map of counterId -> CounterData
 * @param {Array} productMaster - Array of all products in IndexedDB
 * @param {string} query - Raw search query string
 * @returns {Object} Search result containing matched counters, matched products, and status
 */
export function searchCounterMap(counterIndex, productMaster, query) {
  const allCounters = Array.from(counterIndex.values()).sort((a, b) => a.counterNum - b.counterNum);
  const rawQ = (query || '').trim();
  if (!rawQ) {
    return {
      isSearching: false,
      query: '',
      matchedCounters: allCounters,
      totalMatchedProducts: 0
    };
  }

  const normQ = normalizeSearchQuery(rawQ);

  // 1. Find all matching products in Product Master
  const matchingProducts = (productMaster || []).filter(p => matchProduct(p, normQ));

  // 2. Map matching products to counters & determine relevant physical sections
  const counterMatchesMap = new Map();

  // A. Add products that match
  matchingProducts.forEach(product => {
    if (!product.rack) return;
    const parsed = parseProductCounter(product.rack);
    if (!parsed) return;

    const counterId = parsed.counterId;
    const counterObj = counterIndex.get(counterId);
    if (!counterObj) return;

    if (!counterMatchesMap.has(counterId)) {
      counterMatchesMap.set(counterId, {
        counter: counterObj,
        matchedProducts: [],
        relevantSections: new Set(),
        relevantLocations: new Set(),
        isLocationMatch: false
      });
    }

    const matchEntry = counterMatchesMap.get(counterId);
    matchEntry.matchedProducts.push(product);

    (parsed.sections || []).forEach(sec => matchEntry.relevantSections.add(sec));
    (parsed.locations || []).forEach(loc => {
      if (loc.label) {
        matchEntry.relevantLocations.add(loc.label);
      } else if (loc.section) {
        matchEntry.relevantLocations.add(loc.subSection ? `${loc.section}${loc.subSection}` : loc.section);
      }
    });
  });

  // B. Check location match (e.g. user typed "1" or "C1" or "Counter 1")
  allCounters.forEach(counterObj => {
    if (matchCounterLocation(counterObj, normQ)) {
      if (!counterMatchesMap.has(counterObj.id)) {
        counterMatchesMap.set(counterObj.id, {
          counter: counterObj,
          matchedProducts: counterObj.allProducts || [],
          relevantSections: new Set(Array.from(counterObj.sectionMap.keys())),
          relevantLocations: new Set(),
          isLocationMatch: true
        });
      } else {
        counterMatchesMap.get(counterObj.id).isLocationMatch = true;
      }
    }
  });

  const matchedCounters = Array.from(counterMatchesMap.values())
    .map(entry => ({
      ...entry.counter,
      matchedProducts: entry.matchedProducts,
      relevantSections: Array.from(entry.relevantSections).sort(),
      relevantLocations: Array.from(entry.relevantLocations).sort(),
      isLocationMatch: entry.isLocationMatch
    }))
    .sort((a, b) => a.counterNum - b.counterNum);

  return {
    isSearching: true,
    query: rawQ,
    matchedCounters,
    totalMatchedProducts: matchingProducts.length
  };
}
