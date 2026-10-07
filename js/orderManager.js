/**
 * Order Manager
 * Manages in-memory state of the active customer order during the shopkeeper's session
 */

import { matchCustomerItem, matchOrderItem } from './matchingEngine.js';

let currentOrder = {
  id: generateOrderId(),
  customerName: '',
  gstNumber: '',
  taxType: '',
  mobileNumber: '',
  address: '',
  createdBy: '',
  checkedBy: '',
  orderNo: generateOrderNumber(),
  orderDate: new Date().toISOString().split('T')[0],
  orderTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  imagePreviewUrl: null,
  items: [],
  notes: ''
};

const ORDER_STORAGE_KEY = 'active_customer_order';

export function saveOrderToStorage(order = currentOrder) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order));
    }
  } catch (e) {
    console.warn('Failed to save order to localStorage:', e);
  }
}

export function loadOrderFromStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(ORDER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          currentOrder = {
            id: parsed.id || generateOrderId(),
            customerName: String(parsed.customerName || '').trim(),
            gstNumber: String(parsed.gstNumber || '').trim(),
            taxType: parsed.taxType || '',
            mobileNumber: String(parsed.mobileNumber || '').trim(),
            address: String(parsed.address || '').trim(),
            createdBy: String(parsed.createdBy || '').trim(),
            checkedBy: String(parsed.checkedBy || '').trim(),
            orderNo: parsed.orderNo || generateOrderNumber(),
            orderDate: parsed.orderDate || new Date().toISOString().split('T')[0],
            orderTime: parsed.orderTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            imagePreviewUrl: parsed.imagePreviewUrl || null,
            items: Array.isArray(parsed.items) ? parsed.items : [],
            notes: parsed.notes || ''
          };
          notifyListeners();
          return currentOrder;
        }
      }
    }
  } catch (e) {
    console.warn('Failed to load order from localStorage:', e);
  }
  return null;
}

const orderListeners = [];

export function subscribeOrder(listener) {
  orderListeners.push(listener);
  return () => {
    const idx = orderListeners.indexOf(listener);
    if (idx >= 0) orderListeners.splice(idx, 1);
  };
}

function notifyListeners() {
  saveOrderToStorage(currentOrder);
  orderListeners.forEach(fn => fn(getCurrentOrder()));
}

export function generateOrderNumber() {
  const d = new Date();
  const dateStr = d.getFullYear().toString().slice(-2) +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${dateStr}-${randomSuffix}`;
}

export function generateOrderId() {
  return 'ord_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

export function getCurrentOrder() {
  return { ...currentOrder };
}

export function loadOrder(orderData) {
  if (!orderData) return currentOrder;
  currentOrder = {
    id: orderData.id || generateOrderId(),
    customerName: String(orderData.customerName || '').trim(),
    gstNumber: String(orderData.gstNumber || '').trim(),
    taxType: orderData.taxType || '',
    mobileNumber: String(orderData.mobileNumber || '').trim(),
    address: String(orderData.address || '').trim(),
    createdBy: String(orderData.createdBy || '').trim(),
    checkedBy: String(orderData.checkedBy || '').trim(),
    orderNo: orderData.orderNo || generateOrderNumber(),
    orderDate: orderData.orderDate || new Date().toISOString().split('T')[0],
    orderTime: orderData.orderTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    imagePreviewUrl: orderData.imagePreviewUrl || null,
    items: Array.isArray(orderData.items) ? orderData.items : [],
    notes: orderData.notes || ''
  };
  notifyListeners();
  return currentOrder;
}

export function resetOrder(customerName = '', createdBy = '', checkedBy = '', gstNumber = '', address = '', taxType = '', mobileNumber = '') {
  let cust = customerName;
  let cr = createdBy;
  let ch = checkedBy;
  let gst = gstNumber;
  let addr = address;
  let tax = taxType;
  let mob = mobileNumber;
  if (typeof customerName === 'object' && customerName !== null) {
    cust = customerName.customerName || '';
    cr = customerName.createdBy || '';
    ch = customerName.checkedBy || '';
    gst = customerName.gstNumber || '';
    addr = customerName.address || '';
    tax = customerName.taxType || '';
    mob = customerName.mobileNumber || '';
  }
  currentOrder = {
    id: generateOrderId(),
    customerName: String(cust || '').trim(),
    gstNumber: String(gst || '').trim(),
    taxType: tax || '',
    mobileNumber: String(mob || '').trim(),
    address: String(addr || '').trim(),
    createdBy: String(cr || '').trim(),
    checkedBy: String(ch || '').trim(),
    orderNo: generateOrderNumber(),
    orderDate: new Date().toISOString().split('T')[0],
    orderTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    imagePreviewUrl: null,
    items: [],
    notes: ''
  };
  notifyListeners();
  return currentOrder;
}

export function updateOrderMeta(meta = {}) {
  currentOrder = {
    ...currentOrder,
    ...meta
  };
  notifyListeners();
}

export function setOrderItems(items = []) {
  currentOrder.items = items.map((item, idx) => ({
    ...item,
    sNo: idx + 1
  }));
  notifyListeners();
}

export function addOrderItem(customerTextOrItem, quantity = 1, rate = null) {
  let customerText = '';
  let partNumber = '';
  let itemDescription = '';

  if (typeof customerTextOrItem === 'object' && customerTextOrItem !== null) {
    partNumber = String(customerTextOrItem.partNumber || '').trim();
    itemDescription = String(customerTextOrItem.itemDescription || '').trim();
    customerText = String(customerTextOrItem.customerText || itemDescription || partNumber).trim();
    if (customerTextOrItem.quantity !== undefined && quantity === 1) {
      quantity = customerTextOrItem.quantity;
    }
    if (customerTextOrItem.rate !== undefined && rate === null) {
      rate = customerTextOrItem.rate;
    }
  } else {
    customerText = String(customerTextOrItem || '').trim();
    itemDescription = customerText;
  }

  const parsedQty = parseFloat(quantity);
  const finalQty = (!isNaN(parsedQty) && parsedQty > 0)
    ? (Number.isInteger(parsedQty) ? parsedQty : Number(parsedQty.toFixed(3)))
    : 1;

  const parsedRate = (rate !== null && rate !== undefined && rate !== '') ? parseFloat(rate) : null;
  const finalRate = (parsedRate !== null && !isNaN(parsedRate)) ? parsedRate : null;

  const newItem = {
    id: 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    sNo: currentOrder.items.length + 1,
    partNumber: partNumber,
    itemDescription: itemDescription || customerText,
    customerText: customerText,
    quantity: finalQty,
    rate: finalRate,
    matchedProduct: null,
    matchMethod: 'NONE',
    matchStatus: 'UNMATCHED',
    confidence: 0,
    tier: 'NONE',
    isManual: false,
    candidates: []
  };

  currentOrder.items.push(newItem);
  notifyListeners();
  return newItem;
}

/**
 * Locate all existing order items that match the given product by unique Part Number or Product ID
 * @param {Object} product
 * @returns {Array<Object>}
 */
export function findExistingOrderItemsByProduct(product) {
  if (!product || !currentOrder || !Array.isArray(currentOrder.items)) return [];
  const prodPart = (product.partNumber || '').trim().toUpperCase();
  const prodId = product.id || null;

  return currentOrder.items.filter(item => {
    const itemPart = ((item.matchedProduct && item.matchedProduct.partNumber) || item.partNumber || '').trim().toUpperCase();
    const itemId = (item.matchedProduct && item.matchedProduct.id) || item.productId || null;

    if (prodId && itemId && itemId === prodId) return true;
    if (prodPart && itemPart && itemPart === prodPart) return true;
    return false;
  });
}

/**
 * Locate an existing order item that matches the given product
 * @param {Object} product
 * @returns {Object|null}
 */
export function findExistingOrderItemByProduct(product) {
  const matches = findExistingOrderItemsByProduct(product);
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Extract clean numeric rate from an order item
 * @param {Object} item
 * @returns {number|null}
 */
export function getItemNumericRate(item) {
  if (!item) return null;
  const raw = (item.rate !== null && item.rate !== undefined && item.rate !== '')
    ? item.rate
    : (item.matchedProduct && item.matchedProduct.rate !== null && item.matchedProduct.rate !== undefined && item.matchedProduct.rate !== '' ? item.matchedProduct.rate : null);
  if (raw === null || raw === undefined || raw === '') return null;
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  return (!isNaN(num)) ? num : null;
}

/**
 * Creates and adds a new order entry for a product
 * @param {Object} product - Product record
 * @param {number|string} quantity - Final quantity
 * @param {number|string|null} rate - Final rate
 * @returns {Object} Newly created order item
 */
export function addNewOrderProduct(product, quantity = 1, rate = null) {
  if (!product) return null;

  const parsedQty = parseFloat(quantity);
  const finalQty = (!isNaN(parsedQty) && parsedQty > 0)
    ? (Number.isInteger(parsedQty) ? parsedQty : Number(parsedQty.toFixed(3)))
    : 1;

  const parsedRate = (rate !== null && rate !== undefined && rate !== '') ? parseFloat(rate) : null;
  const finalRate = (parsedRate !== null && !isNaN(parsedRate))
    ? parsedRate
    : ((product.rate !== null && product.rate !== undefined && product.rate !== '') ? Number(product.rate) : (product.mrp ? Number(product.mrp) : null));

  const customerText = product.itemDetails || product.productName || product.partNumber || 'Manual Item';
  const groupVal = product ? (product.parentGroup || product.group || '').trim() : '';
  const newItem = {
    id: 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    sNo: currentOrder.items.length + 1,
    customerText: customerText.trim(),
    quantity: finalQty,
    rate: finalRate,
    group: groupVal,
    parentGroup: groupVal,
    matchedProduct: {
      id: product.id,
      partNumber: product.partNumber,
      productName: product.productName,
      itemDetails: product.itemDetails || '',
      rack: product.rack || '',
      unit: product.unit || '',
      group: groupVal,
      parentGroup: groupVal,
      stockQty: (product.stockQty !== null && product.stockQty !== undefined) ? Number(product.stockQty) : null,
      rate: finalRate
    },
    confidence: 100,
    tier: 'HIGH',
    isManual: true,
    candidates: []
  };

  currentOrder.items.push(newItem);
  notifyListeners();
  return newItem;
}

/**
 * Adds a product to the active order or updates existing entry if product already exists with the same rate.
 * Reuses existing order/cart data structure and updates the entry with final Quantity and Rate values.
 * @param {Object} product - Product record
 * @param {number|string} quantity - Final quantity
 * @param {number|string|null} rate - Final rate (overrides master rate)
 * @returns {{ item: Object, isNew: boolean }}
 */
export function addOrUpdateOrderProduct(product, quantity = 1, rate = null) {
  if (!product) return null;

  const parsedQty = parseFloat(quantity);
  const finalQty = (!isNaN(parsedQty) && parsedQty > 0)
    ? (Number.isInteger(parsedQty) ? parsedQty : Number(parsedQty.toFixed(3)))
    : 1;

  const parsedRate = (rate !== null && rate !== undefined && rate !== '') ? parseFloat(rate) : null;
  const finalRate = (parsedRate !== null && !isNaN(parsedRate))
    ? parsedRate
    : ((product.rate !== null && product.rate !== undefined && product.rate !== '') ? Number(product.rate) : (product.mrp ? Number(product.mrp) : null));

  const matchingItems = findExistingOrderItemsByProduct(product);
  // Locate item with identical numeric rate
  const sameRateItem = matchingItems.find(item => {
    const itemRate = getItemNumericRate(item);
    if (itemRate === null && finalRate === null) return true;
    if (itemRate !== null && finalRate !== null) {
      return Math.abs(itemRate - finalRate) < 0.0001;
    }
    return false;
  });

  if (sameRateItem) {
    // Update existing order entry instead of creating a duplicate line
    sameRateItem.quantity = finalQty;
    sameRateItem.rate = finalRate;

    const groupVal = product ? (product.parentGroup || product.group || '').trim() : '';
    sameRateItem.group = groupVal;
    sameRateItem.parentGroup = groupVal;
    if (!sameRateItem.matchedProduct) {
      sameRateItem.matchedProduct = { ...product };
    }
    sameRateItem.matchedProduct.rate = finalRate;
    if (product.partNumber) sameRateItem.matchedProduct.partNumber = product.partNumber;
    if (product.productName) sameRateItem.matchedProduct.productName = product.productName;
    if (product.rack) sameRateItem.matchedProduct.rack = product.rack;
    if (product.unit) sameRateItem.matchedProduct.unit = product.unit;
    if (groupVal) {
      sameRateItem.matchedProduct.group = groupVal;
      sameRateItem.matchedProduct.parentGroup = groupVal;
    }
    if (product.stockQty !== null && product.stockQty !== undefined) sameRateItem.matchedProduct.stockQty = Number(product.stockQty);

    sameRateItem.isManual = true;
    sameRateItem.confidence = 100;
    sameRateItem.tier = 'HIGH';

    notifyListeners();
    return { item: sameRateItem, isNew: false };
  } else {
    // Create new order entry
    const newItem = addNewOrderProduct(product, finalQty, finalRate);
    return { item: newItem, isNew: true };
  }
}

export function updateItemQuantity(itemId, quantity) {
  const item = currentOrder.items.find(i => i.id === itemId);
  if (item) {
    const parsed = parseFloat(quantity);
    item.quantity = (!isNaN(parsed) && parsed > 0)
      ? (Number.isInteger(parsed) ? parsed : Number(parsed.toFixed(3)))
      : 1;
    notifyListeners();
  }
}

export function updateItemProduct(itemId, product, isManual = true) {
  const item = currentOrder.items.find(i => i.id === itemId);
  if (item) {
    const groupVal = product ? (product.parentGroup || product.group || '').trim() : '';
    item.group = groupVal;
    item.parentGroup = groupVal;
    item.matchedProduct = product ? {
      id: product.id,
      partNumber: product.partNumber,
      productName: product.productName,
      itemDetails: product.itemDetails || '',
      rack: product.rack || '',
      unit: product.unit || '',
      group: groupVal,
      parentGroup: groupVal,
      stockQty: (product.stockQty !== null && product.stockQty !== undefined) ? Number(product.stockQty) : null,
      rate: (product.rate !== null && product.rate !== undefined && product.rate !== '') ? Number(product.rate) : (product.mrp ? Number(product.mrp) : null)
    } : null;
    
    if (product) {
      if (item.rate === null || item.rate === undefined || item.rate === '') {
        item.rate = (product.rate !== null && product.rate !== undefined && product.rate !== '') ? Number(product.rate) : (product.mrp ? Number(product.mrp) : null);
      }
      item.isManual = isManual;
      item.confidence = isManual ? 100 : item.confidence;
      item.tier = isManual ? 'HIGH' : item.tier;
      if (isManual) {
        item.matchMethod = 'MANUAL';
        item.matchStatus = 'MANUAL';
      }
    } else {
      item.isManual = false;
      item.confidence = 0;
      item.tier = 'NONE';
      item.matchMethod = 'NONE';
      item.matchStatus = 'UNMATCHED';
    }
    notifyListeners();
  }
}

export function updateItemCustomerText(itemId, newText) {
  const item = currentOrder.items.find(i => i.id === itemId);
  if (item) {
    item.customerText = newText;
    item.itemDescription = newText;
    notifyListeners();
  }
}

export function removeOrderItem(itemId) {
  currentOrder.items = currentOrder.items
    .filter(i => i.id !== itemId)
    .map((item, idx) => ({ ...item, sNo: idx + 1 }));
  notifyListeners();
}

export async function rematchItem(itemId) {
  const item = currentOrder.items.find(i => i.id === itemId);
  if (item) {
    const match = await matchOrderItem({
      partNumber: item.partNumber,
      itemDescription: item.itemDescription,
      customerText: item.customerText,
      quantity: item.quantity
    });
    item.matchedProduct = match.matchedProduct;
    item.partNumber = match.partNumber || item.partNumber || '';
    item.itemDescription = match.itemDescription || item.itemDescription || item.customerText || '';
    item.customerText = match.customerText || item.customerText || '';
    item.matchMethod = match.matchMethod;
    item.matchStatus = match.matchStatus;
    item.confidence = match.confidence;
    item.tier = match.tier;
    item.isManual = false;
    item.candidates = match.candidates;
    notifyListeners();
  }
}

export function getOrderSummary() {
  const items = currentOrder.items;
  const total = items.length;
  let matched = 0;
  let manual = 0;
  let unmatched = 0;
  let lowStockCount = 0;

  items.forEach(item => {
    if (!item.matchedProduct) {
      unmatched++;
    } else {
      if (item.isManual) {
        manual++;
      } else {
        matched++;
      }
      if (item.matchedProduct.stockQty < item.quantity) {
        lowStockCount++;
      }
    }
  });

  return {
    total,
    matched,
    manual,
    unmatched,
    lowStockCount,
    hasUnmatched: unmatched > 0
  };
}
