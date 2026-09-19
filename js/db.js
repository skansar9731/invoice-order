/**
 * IndexedDB Database Manager for Automobile Spare Parts Master
 * Handles 6,000 to 10,000+ items smoothly with chunked transactions
 */

import { INITIAL_PRODUCTS } from './sampleData.js';
import { buildInitialRackConfigs, buildInitialCounterConfigs } from './mapConfigData.js';

const DB_NAME = 'MaharashtraAutoPartsDB';
const DB_VERSION = 2;
export const STORE_PRODUCTS = 'products';
export const STORE_META = 'meta';
export const STORE_RACK_CONFIG = 'rackMapConfig';
export const STORE_COUNTER_CONFIG = 'counterMapConfig';
export const STORE_COUNTER_MAPPINGS = 'counterProductMapping';

let dbInstance = null;

export async function getDB() {
  if (dbInstance) return dbInstance;

  // Determine target version safely against browser storage
  let targetVersion = DB_VERSION;
  if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
    try {
      const dbs = await indexedDB.databases();
      const existing = dbs.find((d) => d.name === DB_NAME);
      if (existing && existing.version && existing.version > targetVersion) {
        targetVersion = existing.version;
      }
    } catch (e) {
      // ignore
    }
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, targetVersion);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        const productStore = db.createObjectStore(STORE_PRODUCTS, { keyPath: 'partNumber' });
        productStore.createIndex('productName', 'productName', { unique: false });
        productStore.createIndex('rack', 'rack', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(STORE_RACK_CONFIG)) {
        db.createObjectStore(STORE_RACK_CONFIG, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE_COUNTER_CONFIG)) {
        db.createObjectStore(STORE_COUNTER_CONFIG, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE_COUNTER_MAPPINGS)) {
        const cStore = db.createObjectStore(STORE_COUNTER_MAPPINGS, { keyPath: 'id' });
        cStore.createIndex('counterId', 'counterId', { unique: false });
        cStore.createIndex('partNumber', 'partNumber', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      const err = event.target.error;
      // Defensive fallback if a VersionError occurs (e.g. browser cache was stale)
      if (err && err.name === 'VersionError') {
        console.warn('VersionError encountered; falling back to opening database at existing version...', err);
        const fallbackRequest = indexedDB.open(DB_NAME);
        fallbackRequest.onsuccess = (ev) => {
          dbInstance = ev.target.result;
          resolve(dbInstance);
        };
        fallbackRequest.onerror = (ev) => {
          console.error('Fallback IndexedDB open error:', ev.target.error);
          reject(ev.target.error);
        };
        return;
      }
      console.error('IndexedDB open error:', err);
      reject(err);
    };
  });
}

/**
 * Count total products in store
 */
export async function countProducts() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readonly');
    const store = tx.objectStore(STORE_PRODUCTS);
    const countReq = store.count();

    countReq.onsuccess = () => resolve(countReq.result);
    countReq.onerror = () => reject(countReq.error);
  });
}

/**
 * Get product by Part Number
 */
export async function getProduct(partNumber) {
  if (!partNumber) return null;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readonly');
    const store = tx.objectStore(STORE_PRODUCTS);
    const req = store.get(partNumber.trim().toUpperCase());

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all products (with optional limit for safe preview)
 */
export async function getAllProducts(limit = null, offset = 0) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readonly');
    const store = tx.objectStore(STORE_PRODUCTS);
    const results = [];
    let skipped = 0;

    const cursorReq = store.openCursor();

    cursorReq.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        resolve(results);
        return;
      }

      if (skipped < offset) {
        skipped++;
        cursor.continue();
        return;
      }

      results.push(cursor.value);

      if (limit && results.length >= limit) {
        resolve(results);
      } else {
        cursor.continue();
      }
    };

    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

/**
 * Bulk Upsert / Merge or Replace products
 * Processes in chunks of 500 to handle 6,000 - 10,000+ items smoothly
 */
export async function upsertProducts(products, isReplace = false, onProgress = null, metadata = {}) {
  const db = await getDB();

  if (isReplace) {
    await clearProductStore();
  }

  // Deduplicate and merge products by partNumber
  const productMap = new Map();
  for (const item of products) {
    if (!item.partNumber) continue;
    const key = String(item.partNumber).trim().toUpperCase();
    if (productMap.has(key)) {
      const prev = productMap.get(key);
      const currStock = (item.stockQty !== null && item.stockQty !== undefined && item.stockQty !== '') ? Number(item.stockQty) : null;
      const prevStock = (prev.stockQty !== null && prev.stockQty !== undefined && prev.stockQty !== '') ? Number(prev.stockQty) : null;

      if (currStock !== null && currStock > 0 && (prevStock === null || prevStock <= 0)) {
        productMap.set(key, {
          ...item,
          alias: prev.alias || item.alias,
          parentGroup: item.parentGroup || item.group || prev.parentGroup || prev.group || '',
          group: item.group || item.parentGroup || prev.group || prev.parentGroup || ''
        });
      } else if (prevStock !== null && prevStock > 0 && (currStock === null || currStock <= 0)) {
        if (!prev.rack && item.rack) prev.rack = item.rack;
        if (!prev.rate && item.rate) prev.rate = item.rate;
        if (!prev.alias && item.alias) prev.alias = item.alias;
        if (!prev.parentGroup && (item.parentGroup || item.group)) {
          prev.parentGroup = item.parentGroup || item.group;
          prev.group = prev.parentGroup;
        }
      } else if (currStock !== null && currStock > 0 && prevStock !== null && prevStock > 0) {
        prev.stockQty = prevStock + currStock;
        if (!prev.rack && item.rack) prev.rack = item.rack;
        if (!prev.rate && item.rate) prev.rate = item.rate;
        if (!prev.parentGroup && (item.parentGroup || item.group)) {
          prev.parentGroup = item.parentGroup || item.group;
          prev.group = prev.parentGroup;
        }
      } else {
        const prevScore = (prev.rack ? 2 : 0) + (prev.rate ? 2 : 0) + (String(prev.productName || '').length > 5 ? 1 : 0);
        const currScore = (item.rack ? 2 : 0) + (item.rate ? 2 : 0) + (String(item.productName || '').length > 5 ? 1 : 0);
        if (currScore > prevScore) {
          productMap.set(key, {
            ...item,
            alias: prev.alias || item.alias,
            parentGroup: item.parentGroup || item.group || prev.parentGroup || prev.group || '',
            group: item.group || item.parentGroup || prev.group || prev.parentGroup || ''
          });
        }
      }
    } else {
      productMap.set(key, item);
    }
  }

  const dedupedProducts = Array.from(productMap.values());
  const chunkSize = 500;
  const total = dedupedProducts.length;
  let processed = 0;

  for (let i = 0; i < total; i += chunkSize) {
    const chunk = dedupedProducts.slice(i, i + chunkSize);
    
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PRODUCTS], 'readwrite');
      const store = tx.objectStore(STORE_PRODUCTS);

      for (const item of chunk) {
        if (!item.partNumber) continue;

        const partNumber = String(item.partNumber).trim().toUpperCase();
        const productName = String(item.productName || '').trim().toUpperCase();
        const alias = item.alias !== undefined && item.alias !== null ? String(item.alias).trim() : '';
        const rawGroup = item.parentGroup || item.group || '';
        const parentGroup = rawGroup !== undefined && rawGroup !== null ? String(rawGroup).trim() : '';
        const group = parentGroup;

        // Stock: Preserve actual 0 as 0, and missing as null
        let stockQty = null;
        if (item.stockQty !== null && item.stockQty !== undefined && item.stockQty !== '') {
          const num = Number(item.stockQty);
          if (!isNaN(num)) {
            stockQty = num;
          }
        }

        // Rack: Preserve empty as '' (no default '-')
        const rawRack = item.rack !== null && item.rack !== undefined ? String(item.rack).trim() : '';
        const rack = (rawRack === '-' || rawRack === '—') ? '' : rawRack;

        // Unit: Preserve empty as '' (no default 'Pcs.')
        const rawUnit = item.unit !== null && item.unit !== undefined ? String(item.unit).trim() : '';
        const unit = (rawUnit === '-' || rawUnit === '—') ? '' : rawUnit;

        // Rate: Preserve number or null
        let rate = null;
        if (item.rate !== null && item.rate !== undefined && item.rate !== '') {
          const numRate = Number(item.rate);
          if (!isNaN(numRate)) {
            rate = numRate;
          }
        }

        const itemDetails = item.itemDetails ? String(item.itemDetails).trim() : (partNumber + ' ' + productName).trim();

        const normalized = {
          partNumber,
          productName,
          itemDetails,
          alias,
          parentGroup,
          group,
          stockQty,
          rack,
          unit,
          rate,
          mrp: rate,
          updatedAt: new Date().toISOString()
        };

        store.put(normalized);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    processed += chunk.length;
    if (onProgress && typeof onProgress === 'function') {
      onProgress(Math.min(processed, total), total);
    }
  }

  // Update Meta
  const totalCount = await countProducts();
  await setMeta('stats', {
    totalProducts: totalCount,
    lastImportDate: metadata.date || new Date().toISOString(),
    lastImportFileName: metadata.fileName || 'Direct Import'
  });

  return { totalImported: processed, currentTotal: totalCount };
}

/**
 * Clear all products from store
 */
export async function clearProductStore() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_PRODUCTS, STORE_META], 'readwrite');
    const store = tx.objectStore(STORE_PRODUCTS);
    store.clear();

    const metaStore = tx.objectStore(STORE_META);
    metaStore.put({
      key: 'stats',
      totalProducts: 0,
      lastImportDate: null,
      lastImportFileName: null
    });

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Meta Store Get/Set
 */
export async function getMeta(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const store = tx.objectStore(STORE_META);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result : null);
    req.onerror = () => reject(req.error);
  });
}

export async function setMeta(key, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    const store = tx.objectStore(STORE_META);
    const req = store.put({ key, ...value });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function getShopStats() {
  const stats = await getMeta('stats');
  const count = await countProducts();
  return {
    totalProducts: count,
    lastImportDate: stats?.lastImportDate || null,
    lastImportFileName: stats?.lastImportFileName || 'Sample Preset'
  };
}

/**
 * ============================================================================
 * RACK MAP CONFIGURATION (STORE: rackMapConfig)
 * Stores 71 active racks (R1–R73 excluding R12 and R64) with sections & sub-sections
 * ============================================================================
 */
export async function getRackConfigs() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RACK_CONFIG, 'readonly');
    const store = tx.objectStore(STORE_RACK_CONFIG);
    const req = store.getAll();

    req.onsuccess = async () => {
      let results = req.result || [];
      if (results.length === 0) {
        // Seed once on initial empty load
        const initialRacks = buildInitialRackConfigs();
        await saveAllRackConfigs(initialRacks);
        resolve(initialRacks);
      } else {
        // Sort naturally by rack number
        results.sort((a, b) => (a.rackNum || 0) - (b.rackNum || 0));
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveRackConfig(rack) {
  if (!rack || !rack.id) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RACK_CONFIG, 'readwrite');
    const store = tx.objectStore(STORE_RACK_CONFIG);
    const req = store.put(rack);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAllRackConfigs(racks) {
  if (!Array.isArray(racks) || racks.length === 0) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RACK_CONFIG, 'readwrite');
    const store = tx.objectStore(STORE_RACK_CONFIG);
    racks.forEach(r => store.put(r));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * ============================================================================
 * COUNTER MAP CONFIGURATION (STORE: counterMapConfig)
 * Stores 8 counters (C1–C8) with independent section configurations
 * ============================================================================
 */
export async function getCounterConfigs() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_COUNTER_CONFIG, 'readonly');
    const store = tx.objectStore(STORE_COUNTER_CONFIG);
    const req = store.getAll();

    req.onsuccess = async () => {
      let results = req.result || [];
      if (results.length === 0) {
        // Seed once on initial empty load
        const initialCounters = buildInitialCounterConfigs();
        await saveAllCounterConfigs(initialCounters);
        resolve(initialCounters);
      } else {
        // Sort naturally by counter number
        results.sort((a, b) => (a.counterNum || 0) - (b.counterNum || 0));
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveCounterConfig(counter) {
  if (!counter || !counter.id) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_COUNTER_CONFIG, 'readwrite');
    const store = tx.objectStore(STORE_COUNTER_CONFIG);
    const req = store.put(counter);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAllCounterConfigs(counters) {
  if (!Array.isArray(counters) || counters.length === 0) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_COUNTER_CONFIG, 'readwrite');
    const store = tx.objectStore(STORE_COUNTER_CONFIG);
    counters.forEach(c => store.put(c));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * ============================================================================
 * COUNTER PRODUCT MAPPINGS (STORE: counterProductMapping)
 * Stores product assignments to Counter and Sections without duplicating products
 * ============================================================================
 */
export async function getCounterProductMappings() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_COUNTER_MAPPINGS, 'readonly');
    const store = tx.objectStore(STORE_COUNTER_MAPPINGS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function assignProductToCounter(partNumber, counterId, sectionCode, subSectionId = '') {
  if (!partNumber || !counterId || !sectionCode) return;
  const db = await getDB();
  const id = `${partNumber.trim().toUpperCase()}_${counterId}_${sectionCode.toUpperCase()}`;
  const record = {
    id,
    partNumber: partNumber.trim().toUpperCase(),
    counterId,
    sectionCode: sectionCode.toUpperCase(),
    subSectionId: subSectionId || '',
    assignedAt: Date.now()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_COUNTER_MAPPINGS, 'readwrite');
    const store = tx.objectStore(STORE_COUNTER_MAPPINGS);
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

export async function removeProductFromCounter(mappingId) {
  if (!mappingId) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_COUNTER_MAPPINGS, 'readwrite');
    const store = tx.objectStore(STORE_COUNTER_MAPPINGS);
    const req = store.delete(mappingId);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Update rack location for a specific product by partNumber
 */
export async function updateProductRack(partNumber, newRack) {
  if (!partNumber) return false;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_PRODUCTS], 'readwrite');
    const store = tx.objectStore(STORE_PRODUCTS);
    const key = String(partNumber).trim().toUpperCase();
    const getReq = store.get(key);

    getReq.onsuccess = () => {
      const item = getReq.result;
      if (item) {
        item.rack = (newRack || '').trim();
        item.updatedAt = new Date().toISOString();
        store.put(item);
      }
    };

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}


