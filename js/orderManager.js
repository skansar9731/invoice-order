/**
 * Order Manager
 * Manages in-memory state of the active customer order during the shopkeeper's session
 */

import { matchCustomerItem } from './matchingEngine.js';

let currentOrder = {
  id: generateOrderId(),
  customerName: '',
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

export function resetOrder(customerName = '', createdBy = '', checkedBy = '') {
  let cust = customerName;
  let cr = createdBy;
  let ch = checkedBy;
  if (typeof customerName === 'object' && customerName !== null) {
    cust = customerName.customerName || '';
    cr = customerName.createdBy || '';
    ch = customerName.checkedBy || '';
  }
  currentOrder = {
    id: generateOrderId(),
    customerName: String(cust || '').trim(),
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

export function addOrderItem(customerText, quantity = 1) {
  const newItem = {
    id: 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    sNo: currentOrder.items.length + 1,
    customerText: customerText.trim(),
    quantity: Math.max(1, parseInt(quantity, 10) || 1),
    matchedProduct: null,
    confidence: 0,
    tier: 'NONE',
    isManual: false,
    candidates: []
  };

  currentOrder.items.push(newItem);
  notifyListeners();
  return newItem;
}

export function updateItemQuantity(itemId, quantity) {
  const item = currentOrder.items.find(i => i.id === itemId);
  if (item) {
    item.quantity = Math.max(1, parseInt(quantity, 10) || 1);
    notifyListeners();
  }
}

export function updateItemProduct(itemId, product, isManual = true) {
  const item = currentOrder.items.find(i => i.id === itemId);
  if (item) {
    item.matchedProduct = product ? {
      partNumber: product.partNumber,
      productName: product.productName,
      rack: product.rack || '',
      unit: product.unit || '',
      stockQty: (product.stockQty !== null && product.stockQty !== undefined) ? Number(product.stockQty) : null,
      rate: (product.rate !== null && product.rate !== undefined) ? Number(product.rate) : null
    } : null;
    
    if (product) {
      item.isManual = isManual;
      item.confidence = isManual ? 100 : item.confidence;
      item.tier = isManual ? 'HIGH' : item.tier;
    } else {
      item.isManual = false;
      item.confidence = 0;
      item.tier = 'NONE';
    }
    notifyListeners();
  }
}

export function updateItemCustomerText(itemId, newText) {
  const item = currentOrder.items.find(i => i.id === itemId);
  if (item) {
    item.customerText = newText;
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
  if (item && item.customerText) {
    const match = await matchCustomerItem(item.customerText);
    item.matchedProduct = match.matchedProduct;
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
