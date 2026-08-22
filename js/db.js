/**
 * IndexedDB Database Manager for Automobile Spare Parts Master
 * Handles 6,000 to 10,000+ items smoothly with chunked transactions
 */

import { INITIAL_PRODUCTS } from './sampleData.js';

const DB_NAME = 'MaharashtraAutoPartsDB';
const DB_VERSION = 1;
const STORE_PRODUCTS = 'products';
const STORE_META = 'meta';

let dbInstance = null;

export async function getDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

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
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
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

  const chunkSize = 500;
  const total = products.length;
  let processed = 0;

  for (let i = 0; i < total; i += chunkSize) {
    const chunk = products.slice(i, i + chunkSize);
    
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PRODUCTS], 'readwrite');
      const store = tx.objectStore(STORE_PRODUCTS);

      for (const item of chunk) {
        if (!item.partNumber) continue;

        const partNumber = String(item.partNumber).trim().toUpperCase();
        const productName = String(item.productName || '').trim().toUpperCase();
        const alias = item.alias !== undefined && item.alias !== null ? String(item.alias).trim() : '';
        const parentGroup = item.parentGroup !== undefined && item.parentGroup !== null ? String(item.parentGroup).trim() : '';

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

        const normalized = {
          partNumber,
          productName,
          alias,
          parentGroup,
          stockQty,
          rack,
          unit,
          rate,
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
