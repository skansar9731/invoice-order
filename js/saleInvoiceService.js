/**
 * Sale Invoice Service for Maharashtra Automobile
 * Handles:
 * 1. "Save Sale Invoice" button state management (strictly governed ONLY by Customer Name)
 * 2. Group Discount sequential modal workflow (one-by-one group discount input, 0-100%)
 * 3. Missed Product addition BEFORE PDF generation (search & select from Product Master, Qty, Discount, Price/Total preview, list & remove)
 * 4. Professional A4 multi-page Sales Invoice PDF generation (Header, Customer Box, Exact 8 Columns, Totals, Signatures)
 * 5. Local File System saving into: Sales Invoice / [Month Year] / [DD Month Year] / [Customer Name].pdf (NO customer subfolder)
 * 6. Safe duplicate file naming (e.g. (1), (2)) & browser download fallback
 * 7. Opening generated PDF directly in browser
 */

import { getCurrentOrder } from './orderManager.js';
import { getAllProducts } from './db.js';
import { searchLocalProducts } from './productSearch.js';
import { showToast } from './ui.js';

// IndexedDB configuration for persisting File System Access API directory handle
const IDB_NAME = 'MHAutoFileAccessDB';
const IDB_STORE = 'handles';
const IDB_KEY_SALES_ROOT = 'salesInvoiceRootDir';

/**
 * Open handle persistence database
 */
function openHandleDB() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/**
 * Retrieve saved root directory handle from IndexedDB
 */
async function getSavedDirectoryHandle() {
  try {
    const db = await openHandleDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY_SALES_ROOT);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

/**
 * Save root directory handle to IndexedDB for reuse across sessions
 */
async function saveDirectoryHandle(handle) {
  try {
    const db = await openHandleDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(handle, IDB_KEY_SALES_ROOT);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    return false;
  }
}

/**
 * Update "Save Sale Invoice" button enabled/disabled state
 * STRICT REQUIREMENT: ONLY Customer Name controls this button.
 * If Customer Name is empty -> DISABLED
 * If Customer Name has non-empty value -> ENABLED
 */
export function updateSaveSaleInvoiceButtonState() {
  const btn = document.getElementById('btn-save-sale-invoice');
  if (!btn) return;

  const customerInput = document.getElementById('order-customer-name');
  const currentOrder = getCurrentOrder();
  const customerName = (customerInput ? customerInput.value : (currentOrder?.customerName || '')).trim();

  const isEnabled = customerName.length > 0;

  btn.disabled = !isEnabled;
  if (!isEnabled) {
    btn.classList.add('opacity-40', 'cursor-not-allowed', 'pointer-events-none');
    btn.classList.remove('active:scale-95', 'hover:shadow-lg');
    btn.setAttribute('aria-disabled', 'true');
  } else {
    btn.classList.remove('opacity-40', 'cursor-not-allowed', 'pointer-events-none');
    btn.classList.add('active:scale-95');
    btn.removeAttribute('aria-disabled');
  }
}

// In-memory state for Group Discount sequential modal workflow & Missed Products
let activeDiscountWorkflow = {
  order: null,         // Deep copy to ensure live order is never mutated
  groups: [],
  groupCounts: {},
  discounts: {},
  currentIndex: 0,
  missedProducts: []   // Array of { id, partNumber, itemDescription, unit, mrp, discount, price, qty, totalAmount, group }
};

// Currently selected product in Missed Product form
let selectedMissedProduct = null;

// In-memory reference to last generated sale invoice PDF
let lastGeneratedInvoice = {
  blob: null,
  filename: '',
  pathDisplay: ''
};

/**
 * Format Month Folder: [Full Month Name] [4-digit Year]
 * Examples: "October 2026", "January 2026"
 */
function getMonthFolderName(dateObj) {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return `${monthNames[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
}

/**
 * Format Date Folder & PDF Date: [DD] [Full Month Name] [4-digit Year]
 * Examples: "07 October 2026", "08 October 2026"
 */
function getDateFolderName(dateObj) {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${day} ${monthNames[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
}

/**
 * Sanitize customer name for safe Windows filename
 * Replaces illegal Windows characters: < > : " / \ | ? *
 */
function sanitizeFileName(name) {
  if (!name) return 'Customer';
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return clean || 'Customer';
}

/**
 * Indian currency number formatter
 */
function formatIndianCurrency(num) {
  const n = Number(num) || 0;
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format numeric quantity
 */
function formatQty(qty) {
  const n = parseFloat(qty) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

/**
 * Start the Group Discount workflow when Save Sale Invoice is clicked
 */
export async function startSaveSaleInvoiceWorkflow() {
  const order = getCurrentOrder();
  const customerInput = document.getElementById('order-customer-name');
  const customerName = (customerInput?.value || order?.customerName || '').trim();

  if (!customerName) {
    showToast('Customer Name is required to save a Sales Invoice.', 'warning');
    return;
  }

  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    showToast('Cannot generate invoice: The current order has no items.', 'warning');
    return;
  }

  // Extract unique group values from current order
  const uniqueGroups = [];
  const groupCounts = {};

  // Source of truth: Product Master lookup to ensure Group is always recovered even if legacy items lack it
  const allMasterProducts = (await getAllProducts()) || [];
  const masterByPart = new Map();
  for (const p of allMasterProducts) {
    if (p.partNumber) {
      masterByPart.set(String(p.partNumber).trim().toUpperCase(), p);
    }
  }

  for (const item of order.items) {
    let rawGroup = item.matchedProduct?.parentGroup || item.matchedProduct?.group || item.parentGroup || item.group || '';
    if (!rawGroup || rawGroup === '-' || rawGroup === '—') {
      const partKey = String(item.matchedProduct?.partNumber || item.partNumber || '').trim().toUpperCase();
      if (partKey && masterByPart.has(partKey)) {
        const masterProd = masterByPart.get(partKey);
        rawGroup = (masterProd.parentGroup || masterProd.group || '').trim();
        if (rawGroup) {
          item.group = rawGroup;
          item.parentGroup = rawGroup;
          if (item.matchedProduct) {
            item.matchedProduct.group = rawGroup;
            item.matchedProduct.parentGroup = rawGroup;
          }
        }
      }
    }
    const g = (rawGroup === '-' || rawGroup === '—' || !rawGroup.trim()) ? 'GENERAL' : String(rawGroup).trim();
    if (!uniqueGroups.includes(g)) {
      uniqueGroups.push(g);
      groupCounts[g] = 0;
    }
    groupCounts[g]++;
  }

  if (uniqueGroups.length === 0) {
    uniqueGroups.push('GENERAL');
    groupCounts['GENERAL'] = order.items.length;
  }

  activeDiscountWorkflow = {
    order: JSON.parse(JSON.stringify(order)), // Deep copy: DO NOT modify original order
    groups: uniqueGroups,
    groupCounts: groupCounts,
    discounts: {},
    currentIndex: 0,
    missedProducts: []
  };

  // Initialize all group discounts to 0
  uniqueGroups.forEach(g => {
    activeDiscountWorkflow.discounts[g] = 0;
  });

  // Reset selected missed product
  selectedMissedProduct = null;

  // Show Step 1: Group Discount view
  showGroupDiscountStepView();
  renderGroupDiscountStep();
  openGroupDiscountModal();
}

/**
 * Switch view to Step 1: Group Discount view
 */
function showGroupDiscountStepView() {
  const step1 = document.getElementById('view-group-discount-step');
  const step2 = document.getElementById('view-missed-products-step');
  if (step1) step1.classList.remove('hidden');
  if (step2) step2.classList.add('hidden');
}

/**
 * Switch view to Step 2: Review & Add Missed Products view
 */
function showMissedProductsStepView() {
  const step1 = document.getElementById('view-group-discount-step');
  const step2 = document.getElementById('view-missed-products-step');
  if (step1) step1.classList.add('hidden');
  if (step2) step2.classList.remove('hidden');

  // Update order items summary count
  const orderCountEl = document.getElementById('invoice-preview-order-count');
  if (orderCountEl && activeDiscountWorkflow.order) {
    const totalItems = activeDiscountWorkflow.order.items.length;
    orderCountEl.textContent = `${totalItems} matched item${totalItems === 1 ? '' : 's'}`;
  }

  // Reset entry box and search
  clearMissedProductEntryForm();
  renderMissedProductsList();

  const searchInput = document.getElementById('missed-product-search-input');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
}

/**
 * Render the current Group Discount step in the modal
 */
function renderGroupDiscountStep() {
  const { groups, groupCounts, discounts, currentIndex, missedProducts } = activeDiscountWorkflow;
  const currentGroup = groups[currentIndex];
  const totalGroups = groups.length;

  const progressEl = document.getElementById('group-discount-progress');
  const groupNameEl = document.getElementById('group-discount-group-name');
  const itemCountEl = document.getElementById('group-discount-item-count');
  const discountInput = document.getElementById('group-discount-input');
  const errorEl = document.getElementById('group-discount-error');
  const btnBack = document.getElementById('btn-group-discount-back');
  const btnNext = document.getElementById('btn-group-discount-next');
  const missedBadge = document.getElementById('group-discount-missed-badge');
  const missedBadgeText = document.getElementById('group-discount-missed-badge-text');

  if (progressEl) {
    progressEl.textContent = `Group ${currentIndex + 1} of ${totalGroups}`;
  }

  if (groupNameEl) {
    groupNameEl.value = currentGroup;
  }

  if (itemCountEl) {
    const count = groupCounts[currentGroup] || 0;
    itemCountEl.textContent = `Applies to ${count} item${count === 1 ? '' : 's'} in this group`;
  }

  if (discountInput) {
    discountInput.value = discounts[currentGroup] !== undefined ? discounts[currentGroup] : 0;
    discountInput.focus();
    discountInput.select();
  }

  if (errorEl) {
    errorEl.classList.add('hidden');
  }

  // Back button visibility
  if (btnBack) {
    if (currentIndex > 0) {
      btnBack.classList.remove('hidden');
    } else {
      btnBack.classList.add('hidden');
    }
  }

  // Next or Save Invoice button on final group
  if (btnNext) {
    if (currentIndex === totalGroups - 1) {
      btnNext.innerHTML = '<span>Save Invoice</span>';
      btnNext.classList.remove('bg-blue-600', 'hover:bg-blue-700');
      btnNext.classList.add('bg-emerald-600', 'hover:bg-emerald-700');
    } else {
      btnNext.innerHTML = '<span>Next Group</span>';
      btnNext.classList.remove('bg-emerald-600', 'hover:bg-emerald-700');
      btnNext.classList.add('bg-blue-600', 'hover:bg-blue-700');
    }
  }

  // Missed products indicator badge
  if (missedBadge && missedBadgeText) {
    if (missedProducts && missedProducts.length > 0) {
      missedBadgeText.textContent = `${missedProducts.length} missed product${missedProducts.length === 1 ? '' : 's'} added`;
      missedBadge.classList.remove('hidden');
    } else {
      missedBadge.classList.add('hidden');
    }
  }
}

/**
 * Handle "Next Group" or "Save Invoice" button click
 */
async function handleGroupDiscountNext() {
  const discountInput = document.getElementById('group-discount-input');
  const errorEl = document.getElementById('group-discount-error');
  const errorTextEl = document.getElementById('group-discount-error-text');

  const rawVal = discountInput ? discountInput.value.trim() : '';

  if (rawVal === '') {
    if (errorEl) {
      errorTextEl.textContent = 'Discount percentage is required (enter 0 to 100).';
      errorEl.classList.remove('hidden');
    }
    discountInput?.focus();
    return;
  }

  const numVal = parseFloat(rawVal);
  if (isNaN(numVal) || numVal < 0 || numVal > 100) {
    if (errorEl) {
      errorTextEl.textContent = 'Discount must be a valid number between 0% and 100%.';
      errorEl.classList.remove('hidden');
    }
    discountInput?.focus();
    return;
  }

  const { groups, currentIndex } = activeDiscountWorkflow;
  const currentGroup = groups[currentIndex];
  activeDiscountWorkflow.discounts[currentGroup] = numVal;

  if (currentIndex < groups.length - 1) {
    // Proceed to next group
    activeDiscountWorkflow.currentIndex++;
    renderGroupDiscountStep();
  } else {
    // Final group completed
    // Automatically generate and save the Sales Invoice PDF!
    closeGroupDiscountModal();
    await generateAndSaveSalesInvoice();
  }
}

/**
 * Handle "Back" button click in Group Discount modal
 */
function handleGroupDiscountBack() {
  if (activeDiscountWorkflow.currentIndex > 0) {
    // Save current input temporarily if valid
    const discountInput = document.getElementById('group-discount-input');
    const rawVal = discountInput ? discountInput.value.trim() : '';
    const numVal = parseFloat(rawVal);
    if (!isNaN(numVal) && numVal >= 0 && numVal <= 100) {
      const currentGroup = activeDiscountWorkflow.groups[activeDiscountWorkflow.currentIndex];
      activeDiscountWorkflow.discounts[currentGroup] = numVal;
    }

    activeDiscountWorkflow.currentIndex--;
    renderGroupDiscountStep();
  }
}

function openGroupDiscountModal() {
  const modal = document.getElementById('group-discount-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeGroupDiscountModal() {
  const modal = document.getElementById('group-discount-modal');
  if (modal) modal.classList.add('hidden');
}

// ============================================================
// MISSED PRODUCTS MANAGEMENT (BEFORE PDF GENERATION)
// ============================================================

let searchDebounceTimer = null;

/**
 * Handle search input in Missed Products step
 */
function handleMissedProductSearchInput(e) {
  const query = (e.target.value || '').trim();
  const dropdown = document.getElementById('missed-product-search-dropdown');
  if (!dropdown) return;

  clearTimeout(searchDebounceTimer);

  if (query.length === 0) {
    dropdown.innerHTML = '';
    dropdown.classList.add('hidden');
    return;
  }

  searchDebounceTimer = setTimeout(async () => {
    try {
      const searchRes = await searchLocalProducts(query, 30);
      const items = searchRes.items || [];

      if (items.length === 0) {
        dropdown.innerHTML = `
          <div class="p-3 text-xs text-slate-500 text-center">
            No matching products found in Product Master.
          </div>
        `;
        dropdown.classList.remove('hidden');
        return;
      }

      dropdown.innerHTML = items.map((prod, idx) => {
        const partNo = prod.partNumber || '—';
        const name = prod.itemDetails || prod.productName || prod.partNumber || '—';
        const rate = (prod.rate !== null && prod.rate !== undefined && prod.rate !== '') ? Number(prod.rate) : 0;
        const unit = prod.unit || 'Pcs.';
        const group = prod.parentGroup || prod.group || 'GENERAL';

        return `
          <div class="missed-search-item p-2.5 hover:bg-blue-50 cursor-pointer transition flex items-center justify-between text-xs"
            data-index="${idx}">
            <div class="min-w-0 pr-2">
              <div class="font-bold text-slate-900 truncate">${escapeHTML(name)}</div>
              <div class="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                <span class="font-mono text-slate-700 font-semibold">${escapeHTML(partNo)}</span>
                <span>•</span>
                <span>${escapeHTML(group)}</span>
              </div>
            </div>
            <div class="text-right shrink-0">
              <div class="font-bold text-slate-900">₹${rate.toFixed(2)}</div>
              <div class="text-[10px] text-slate-400">${escapeHTML(unit)}</div>
            </div>
          </div>
        `;
      }).join('');

      dropdown.classList.remove('hidden');

      // Bind click handlers to search result rows
      dropdown.querySelectorAll('.missed-search-item').forEach((row, i) => {
        row.addEventListener('click', () => {
          selectMissedProduct(items[i]);
        });
      });

    } catch (err) {
      console.error('Error searching products for missed item:', err);
    }
  }, 200);
}

/**
 * Handle selection of a product from the Product Master search dropdown
 */
function selectMissedProduct(prod) {
  const dropdown = document.getElementById('missed-product-search-dropdown');
  if (dropdown) {
    dropdown.innerHTML = '';
    dropdown.classList.add('hidden');
  }

  const partNo = prod.partNumber || '';
  const itemDesc = (prod.itemDetails || prod.productName || prod.partNumber || '—').trim();
  const rate = (prod.rate !== null && prod.rate !== undefined && prod.rate !== '') ? Number(prod.rate) : 0;
  const unit = (prod.unit || 'Pcs.').trim();
  const rawGroup = prod.parentGroup || prod.group || 'GENERAL';
  const group = (rawGroup === '-' || rawGroup === '—' || !rawGroup.trim()) ? 'GENERAL' : String(rawGroup).trim();

  // If group discount already configured for this group, default to it; otherwise 0
  const defaultDiscount = activeDiscountWorkflow.discounts[group] !== undefined
    ? activeDiscountWorkflow.discounts[group]
    : 0;

  selectedMissedProduct = {
    partNumber: partNo,
    itemDescription: itemDesc,
    mrp: rate,
    unit: unit,
    group: group
  };

  const nameEl = document.getElementById('missed-selected-name');
  const partEl = document.getElementById('missed-selected-part');
  const mrpEl = document.getElementById('missed-selected-mrp');
  const unitEl = document.getElementById('missed-selected-unit');
  const qtyInput = document.getElementById('missed-selected-qty');
  const discountInput = document.getElementById('missed-selected-discount');
  const entryBox = document.getElementById('missed-product-entry-box');

  if (nameEl) nameEl.textContent = itemDesc;
  if (partEl) partEl.textContent = partNo || '—';
  if (mrpEl) mrpEl.textContent = `₹${rate.toFixed(2)}`;
  if (unitEl) unitEl.textContent = unit;
  if (qtyInput) qtyInput.value = '1';
  if (discountInput) discountInput.value = String(defaultDiscount);

  updateMissedProductLiveCalculation();

  if (entryBox) entryBox.classList.remove('hidden');
  qtyInput?.focus();
}

/**
 * Clear the selected product in Missed Product form
 */
function clearMissedProductEntryForm() {
  selectedMissedProduct = null;
  const entryBox = document.getElementById('missed-product-entry-box');
  const searchInput = document.getElementById('missed-product-search-input');
  const dropdown = document.getElementById('missed-product-search-dropdown');

  if (entryBox) entryBox.classList.add('hidden');
  if (searchInput) searchInput.value = '';
  if (dropdown) {
    dropdown.innerHTML = '';
    dropdown.classList.add('hidden');
  }
}

/**
 * Live calculation of Price and Total for the currently selected missed product
 */
function updateMissedProductLiveCalculation() {
  if (!selectedMissedProduct) return;

  const mrp = selectedMissedProduct.mrp || 0;
  const qtyInput = document.getElementById('missed-selected-qty');
  const discountInput = document.getElementById('missed-selected-discount');
  const priceEl = document.getElementById('missed-selected-price');
  const totalEl = document.getElementById('missed-selected-total');

  const rawQty = parseFloat(qtyInput?.value || '1');
  const qty = (!isNaN(rawQty) && rawQty > 0) ? rawQty : 1;

  const rawDiscount = parseFloat(discountInput?.value || '0');
  const discount = (!isNaN(rawDiscount) && rawDiscount >= 0 && rawDiscount <= 100) ? rawDiscount : 0;

  // Formula: Price = MRP - (MRP × Discount / 100)
  const price = Math.round((mrp - (mrp * discount / 100)) * 100) / 100;
  // Total Amount = Quantity × Price
  const total = Math.round((qty * price) * 100) / 100;

  if (priceEl) priceEl.textContent = `₹${price.toFixed(2)}`;
  if (totalEl) totalEl.textContent = `₹${total.toFixed(2)}`;
}

/**
 * Confirm and add the selected missed product to activeDiscountWorkflow.missedProducts
 */
function handleConfirmAddMissedItem() {
  if (!selectedMissedProduct) {
    showToast('Please select a product first.', 'warning');
    return;
  }

  const mrp = selectedMissedProduct.mrp || 0;
  const qtyInput = document.getElementById('missed-selected-qty');
  const discountInput = document.getElementById('missed-selected-discount');

  const rawQty = parseFloat(qtyInput?.value || '1');
  if (isNaN(rawQty) || rawQty <= 0) {
    showToast('Please enter a valid positive quantity.', 'warning');
    qtyInput?.focus();
    return;
  }

  const rawDiscount = parseFloat(discountInput?.value || '0');
  if (isNaN(rawDiscount) || rawDiscount < 0 || rawDiscount > 100) {
    showToast('Please enter a valid discount percentage (0 - 100%).', 'warning');
    discountInput?.focus();
    return;
  }

  const qty = rawQty;
  const discount = rawDiscount;
  const price = Math.round((mrp - (mrp * discount / 100)) * 100) / 100;
  const totalAmount = Math.round((qty * price) * 100) / 100;

  const newItem = {
    id: 'missed_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    partNumber: selectedMissedProduct.partNumber,
    itemDescription: selectedMissedProduct.itemDescription,
    unit: selectedMissedProduct.unit,
    mrp: mrp,
    discount: discount,
    price: price,
    qty: qty,
    totalAmount: totalAmount,
    group: selectedMissedProduct.group
  };

  activeDiscountWorkflow.missedProducts.push(newItem);

  // Clear form and re-render
  clearMissedProductEntryForm();
  renderMissedProductsList();

  showToast(`Added "${newItem.itemDescription}" to Sales Invoice.`, 'success');
}

/**
 * Remove a missed product by its unique ID
 */
function removeMissedProduct(id) {
  activeDiscountWorkflow.missedProducts = activeDiscountWorkflow.missedProducts.filter(item => item.id !== id);
  renderMissedProductsList();
  showToast('Removed missed product.', 'info');
}

/**
 * Render the list of added missed products in the modal
 */
function renderMissedProductsList() {
  const container = document.getElementById('missed-products-list-container');
  const countEl = document.getElementById('missed-products-count');
  if (!container) return;

  const items = activeDiscountWorkflow.missedProducts || [];
  if (countEl) countEl.textContent = String(items.length);

  if (items.length === 0) {
    container.innerHTML = `
      <div id="missed-products-empty-msg" class="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 text-center">
        No missed products added yet (optional). You can add items or proceed directly to generate the PDF.
      </div>
    `;
    return;
  }

  container.innerHTML = items.map((item, idx) => `
    <div class="p-2.5 bg-white border border-slate-200 rounded-lg flex items-center justify-between gap-2 text-xs shadow-2xs">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="font-bold text-slate-500 text-[11px]">#${idx + 1}</span>
          <span class="font-bold text-slate-900 truncate">${escapeHTML(item.itemDescription)}</span>
        </div>
        <div class="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
          <span>Part: <b class="font-mono text-slate-700">${escapeHTML(item.partNumber || '—')}</b></span>
          <span>•</span>
          <span>Qty: <b class="text-slate-800">${item.qty} ${escapeHTML(item.unit)}</b></span>
          <span>•</span>
          <span>MRP: <b>₹${item.mrp.toFixed(2)}</b></span>
          <span>•</span>
          <span>Disc: <b class="text-blue-700">${item.discount}%</b></span>
          <span>•</span>
          <span>Price: <b>₹${item.price.toFixed(2)}</b></span>
          <span>•</span>
          <span>Total: <b class="text-emerald-700">₹${item.totalAmount.toFixed(2)}</b></span>
        </div>
      </div>
      <button type="button" class="btn-remove-missed-item p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition font-bold text-sm shrink-0"
        data-id="${item.id}" title="Remove item">
        ✕
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-remove-missed-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (id) removeMissedProduct(id);
    });
  });
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// PDF GENERATION (PROFESSIONAL A4 PRINTABLE SALES INVOICE)
// ============================================================

/**
 * Builds the jsPDF instance for the professional Sales Invoice PDF
 * Contains:
 * - A4 Portrait page with standard professional margins (10 mm)
 * - Clean company header: MAHARASHTRA AUTOMOBILE / SALES INVOICE
 * - Customer & Order information section (Customer Name, GSTIN, Mobile, Address, Tax Type, Date, Order No)
 * - Exact 8 Columns table: S.No | Item Description | Qty | Unit | MRP | Discount | Price | Total Amount
 * - Multi-page support with repeated headers
 * - Totals: Total Quantity & Grand Total Amount
 * - Footer with Customer Signature and Authorized Signature
 */
export async function buildSalesInvoicePDFDoc(order, groupDiscounts, missedProducts = []) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('jsPDF library is not loaded. Please verify internet connection.');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();   // 210 mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 297 mm
  const margin = 10;
  const contentWidth = pageWidth - (margin * 2);        // 190 mm

  // Customer and Order Details
  const customerInput = document.getElementById('order-customer-name');
  const gstInput = document.getElementById('order-gst-number');
  const mobileInput = document.getElementById('order-mobile-number');
  const addressInput = document.getElementById('order-address');
  const taxTypeInput = document.getElementById('order-tax-type');

  const customerName = (customerInput?.value || order.customerName || '').trim() || 'Counter Cash Customer';
  const gstRaw = (gstInput?.value || order.gstNumber || '').trim();
  const hasGst = Boolean(gstRaw &&
    gstRaw !== '-' &&
    gstRaw !== '—' &&
    gstRaw.toLowerCase() !== 'n/a' &&
    gstRaw.toLowerCase() !== 'blank');

  const mobileNumber = (mobileInput?.value || order.mobileNumber || '').trim();
  const address = (addressInput?.value || order.address || '').trim();

  const taxTypeRaw = (taxTypeInput ? taxTypeInput.value : (order.taxType || '')).trim();
  const hasTaxType = Boolean(taxTypeRaw &&
    taxTypeRaw.toLowerCase() !== 'select tax type' &&
    taxTypeRaw !== '-' &&
    taxTypeRaw !== '—' &&
    taxTypeRaw.toLowerCase() !== 'n/a' &&
    taxTypeRaw.toLowerCase() !== 'blank');

  const orderNo = (order.orderNo || 'ORDER').trim();

  const now = new Date();
  const dateFormattedStr = getDateFolderName(now); // e.g. "07 October 2026"

  // ==========================================
  // PAGE 1: HEADER & CUSTOMER DETAILS
  // ==========================================

  // 1. Company Header Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text('MAHARASHTRA AUTOMOBILE', pageWidth / 2, 13, { align: 'center' });

  // 2. Subtitle: SALES INVOICE
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59); // slate-800
  doc.text('SALES INVOICE', pageWidth / 2, 18, { align: 'center' });

  // 3. Customer & Invoice Info Box (Two-column layout)
  const boxTop = 22;
  const maxRows = (hasGst || hasTaxType) ? 5 : 4;
  const boxHeight = maxRows === 5 ? 28 : 23;
  const colDividerX = margin + 115; // Left col: 115 mm, Right col: 75 mm

  // Outer border
  doc.setDrawColor(180, 190, 205);
  doc.setLineWidth(0.3);
  doc.rect(margin, boxTop, contentWidth, boxHeight);
  // Column divider line
  doc.line(colDividerX, boxTop, colDividerX, boxTop + boxHeight);

  // Left Column: Customer Information
  const leftX = margin + 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105); // slate-600
  doc.text('Billed To (Customer Details):', leftX, boxTop + 4.5);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  const truncCustomerName = customerName.length > 50 ? customerName.substring(0, 47) + '...' : customerName;
  doc.text(truncCustomerName, leftX, boxTop + 9.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);

  const addressText = address ? (address.length > 55 ? address.substring(0, 52) + '...' : address) : '—';
  doc.text(`Address: ${addressText}`, leftX, boxTop + 14.5);

  const mobileText = mobileNumber || '—';
  doc.text(`Mobile: ${mobileText}`, leftX, boxTop + 19.5);

  if (hasGst) {
    doc.setFont('helvetica', 'normal');
    doc.text(`GST Number: `, leftX, boxTop + 24.5);
    doc.setFont('helvetica', 'bold');
    doc.text(gstRaw, leftX + 19, boxTop + 24.5);
    doc.setFont('helvetica', 'normal');
  }

  // Right Column: Invoice / Order Metadata
  const rightX = colDividerX + 3;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);

  doc.setFont('helvetica', 'bold');
  doc.text('Invoice / Order Details:', rightX, boxTop + 4.5);

  doc.setFont('helvetica', 'normal');
  doc.text(`Order No: `, rightX, boxTop + 9.5);
  doc.setFont('helvetica', 'bold');
  doc.text(orderNo, rightX + 17, boxTop + 9.5);

  doc.setFont('helvetica', 'normal');
  doc.text(`Date: `, rightX, boxTop + 14.5);
  doc.setFont('helvetica', 'bold');
  doc.text(dateFormattedStr, rightX + 17, boxTop + 14.5);

  if (hasTaxType) {
    doc.setFont('helvetica', 'normal');
    doc.text(`Tax Type: `, rightX, boxTop + 19.5);
    doc.setFont('helvetica', 'bold');
    doc.text(taxTypeRaw, rightX + 17, boxTop + 19.5);

    doc.setFont('helvetica', 'normal');
    doc.text(`Place of Supply: Maharashtra (27)`, rightX, boxTop + 24.5);
  } else {
    doc.setFont('helvetica', 'normal');
    doc.text(`Place of Supply: Maharashtra (27)`, rightX, boxTop + 19.5);
  }

  // ==========================================
  // TABLE DATA PREPARATION (EXACT 8 COLUMNS)
  // ==========================================
  // Columns: S.No | Item Description | Qty | Unit | MRP | Discount | Price | Total Amount
  // STRICT EXCLUSIONS: NO HSN/SAC, NO Reverse Change, NO Salesman Name, NO Checked By

  const tableRows = [];
  let totalQuantity = 0;
  let grandTotalAmount = 0;
  let serialNumber = 1;

  // 1. Process Order Items
  if (Array.isArray(order.items)) {
    order.items.forEach((item) => {
      const rawGroup = item.matchedProduct?.parentGroup || item.matchedProduct?.group || item.parentGroup || item.group || '';
      const itemGroup = (rawGroup === '-' || rawGroup === '—' || !rawGroup.trim()) ? 'GENERAL' : String(rawGroup).trim();
      const discountPct = Number(groupDiscounts[itemGroup] || 0);

      // MRP
      let mrp = 0;
      if (item.rate !== null && item.rate !== undefined && item.rate !== '' && !isNaN(Number(item.rate))) {
        mrp = Number(item.rate);
      } else if (item.matchedProduct?.rate !== null && item.matchedProduct?.rate !== undefined && item.matchedProduct?.rate !== '' && !isNaN(Number(item.matchedProduct.rate))) {
        mrp = Number(item.matchedProduct.rate);
      }

      // Quantity
      const parsedQty = parseFloat(item.quantity);
      const qty = (!isNaN(parsedQty) && parsedQty > 0) ? parsedQty : 1;

      // Price = MRP - (MRP × Discount / 100)
      const price = Math.round((mrp - (mrp * discountPct / 100)) * 100) / 100;

      // Total Amount = Quantity × Price
      const totalAmount = Math.round((qty * price) * 100) / 100;

      totalQuantity += qty;
      grandTotalAmount += totalAmount;

      // Item Description
      let itemDesc = '';
      if (item.matchedProduct?.itemDetails && item.matchedProduct.itemDetails.trim()) {
        itemDesc = item.matchedProduct.itemDetails.trim();
      } else if (item.matchedProduct?.productName) {
        itemDesc = item.matchedProduct.productName.trim();
      } else {
        itemDesc = (item.itemDescription || item.customerText || item.partNumber || '—').trim();
      }

      const unit = (item.matchedProduct?.unit || item.unit || 'Pcs.').trim();

      tableRows.push([
        String(serialNumber),
        itemDesc,
        formatQty(qty),
        unit,
        formatIndianCurrency(mrp),
        `${discountPct}%`,
        formatIndianCurrency(price),
        formatIndianCurrency(totalAmount)
      ]);

      serialNumber++;
    });
  }

  // 2. Process Manually Added Missed Products
  if (Array.isArray(missedProducts) && missedProducts.length > 0) {
    missedProducts.forEach((missed) => {
      const qty = parseFloat(missed.qty) || 1;
      const mrp = Number(missed.mrp) || 0;
      const discountPct = Number(missed.discount) || 0;
      const price = Math.round((mrp - (mrp * discountPct / 100)) * 100) / 100;
      const totalAmount = Math.round((qty * price) * 100) / 100;

      totalQuantity += qty;
      grandTotalAmount += totalAmount;

      tableRows.push([
        String(serialNumber),
        missed.itemDescription,
        formatQty(qty),
        missed.unit || 'Pcs.',
        formatIndianCurrency(mrp),
        `${discountPct}%`,
        formatIndianCurrency(price),
        formatIndianCurrency(totalAmount)
      ]);

      serialNumber++;
    });
  }

  // Round final grand total to 2 decimals
  grandTotalAmount = Math.round(grandTotalAmount * 100) / 100;

  // ==========================================
  // RENDER AUTOTABLE (EXACT 8 COLUMNS)
  // ==========================================
  // Available width = 190 mm
  // Column distribution:
  // 0: S.No (9 mm)
  // 1: Item Description (77 mm)
  // 2: Qty (15 mm)
  // 3: Unit (13 mm)
  // 4: MRP (18 mm)
  // 5: Discount (16 mm)
  // 6: Price (18 mm)
  // 7: Total Amount (24 mm)
  // Sum = 9 + 77 + 15 + 13 + 18 + 16 + 18 + 24 = 190 mm

  doc.autoTable({
    startY: boxTop + boxHeight + 3,
    tableWidth: contentWidth,
    margin: { left: margin, right: margin, bottom: 22 },
    head: [[
      'S.No',
      'Item Description',
      'Qty',
      'Unit',
      'MRP',
      'Discount',
      'Price',
      'Total Amount'
    ]],
    body: tableRows,
    foot: [[
      { content: 'Totals', colSpan: 2, styles: { halign: 'right', fontStyle: 'bold' } },
      { content: formatQty(totalQuantity), styles: { halign: 'right', fontStyle: 'bold' } },
      { content: 'Pcs.', styles: { halign: 'center', fontStyle: 'bold' } },
      { content: '', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } },
      { content: formatIndianCurrency(grandTotalAmount), styles: { halign: 'right', fontStyle: 'bold' } }
    ]],
    showHead: 'everyPage',
    showFoot: 'lastPage',
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      textColor: [15, 23, 42],
      cellPadding: { top: 2, bottom: 2, left: 1.5, right: 1.5 },
      lineColor: [180, 190, 205],
      lineWidth: 0.25,
      overflow: 'linebreak'
    },
    headStyles: {
      fontStyle: 'bold',
      fontSize: 8.5,
      textColor: [15, 23, 42],
      fillColor: [241, 245, 249], // slate-100
      lineColor: [148, 163, 184],
      lineWidth: 0.35,
      halign: 'center'
    },
    footStyles: {
      fontStyle: 'bold',
      fontSize: 8.5,
      textColor: [15, 23, 42],
      fillColor: [248, 250, 252],
      lineColor: [148, 163, 184],
      lineWidth: 0.35
    },
    columnStyles: {
      0: { cellWidth: 9, halign: 'center' },
      1: { cellWidth: 77, halign: 'left', overflow: 'linebreak' },
      2: { cellWidth: 15, halign: 'right' },
      3: { cellWidth: 13, halign: 'center' },
      4: { cellWidth: 18, halign: 'right' },
      5: { cellWidth: 16, halign: 'center' },
      6: { cellWidth: 18, halign: 'right' },
      7: { cellWidth: 24, halign: 'right' }
    },
    didDrawPage: function (data) {
      const pageNum = data.pageNumber;
      const totalPages = doc.internal.getNumberOfPages();

      // Running header on continuation pages
      if (pageNum > 1) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text('MAHARASHTRA AUTOMOBILE — SALES INVOICE (Contd.)', margin, 10);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(`Customer: ${truncCustomerName}  |  Order No: ${orderNo}`, pageWidth - margin, 10, { align: 'right' });

        doc.setDrawColor(200, 210, 220);
        doc.setLineWidth(0.25);
        doc.line(margin, 12, pageWidth - margin, 12);
      }

      // Running footer page number on all pages
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text('Maharashtra Automobile  •  Sales Invoice', margin, pageHeight - 7);
      doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
    }
  });

  // ==========================================
  // INVOICE SUMMARY BOX & SIGNATURES AREA
  // ==========================================
  let finalY = doc.lastAutoTable.finalY + 4;
  const signatureBlockHeight = 36;

  // If not enough room on the current page for summary & signatures, push to a new page
  if (finalY + signatureBlockHeight > pageHeight - 14) {
    doc.addPage();
    finalY = 16;
  }

  // Grand Total Highlight Bar
  doc.setDrawColor(180, 190, 205);
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, finalY, contentWidth, 9, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  doc.text(`Total Qty: ${formatQty(totalQuantity)} Pcs.`, margin + 4, finalY + 5.8);

  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(`Grand Total: Rs. ${formatIndianCurrency(grandTotalAmount)}`, margin + contentWidth - 4, finalY + 5.8, { align: 'right' });

  // Signature Block
  const sigY = finalY + 14;

  // Left side: Customer Signature
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('Terms & Conditions: Goods once sold will not be taken back.', margin, sigY);
  doc.text('Customer Signature: ___________________________', margin, sigY + 16);

  // Right side: Company Authorized Signature
  const rightSigX = pageWidth - margin - 65;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('for MAHARASHTRA AUTOMOBILE', rightSigX, sigY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('Authorized Signature: _______________________', rightSigX, sigY + 16);

  const filename = `${sanitizeFileName(customerName)}.pdf`;
  return { doc, filename };
}

/**
 * Generate Sales Invoice and save to the structured local filesystem:
 * Sales Invoice / [Month Year] / [DD Month Year] / [Customer Name].pdf
 * STRICT REQUIREMENT: NO customer subfolder.
 */
async function generateAndSaveSalesInvoice() {
  const { order, discounts, missedProducts } = activeDiscountWorkflow;
  if (!order) return;

  try {
    showToast('Generating Sales Invoice PDF...', 'info');

    const { doc, filename } = await buildSalesInvoicePDFDoc(order, discounts, missedProducts);
    const pdfBlob = doc.output('blob');

    const now = new Date();
    const monthFolderName = getMonthFolderName(now);
    const dateFolderName = getDateFolderName(now);
    const customerInput = document.getElementById('order-customer-name');
    const customerName = (customerInput?.value || order.customerName || '').trim() || 'Customer';
    const sanitizedCustomer = sanitizeFileName(customerName);

    let savedPath = '';
    let finalFileName = `${sanitizedCustomer}.pdf`;
    let usedFileSystemApi = false;

    // Check if File System Access API is supported
    if (typeof window.showDirectoryPicker === 'function') {
      try {
        let rootHandle = await getSavedDirectoryHandle();

        if (rootHandle) {
          try {
            const perm = await rootHandle.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') {
              const req = await rootHandle.requestPermission({ mode: 'readwrite' });
              if (req !== 'granted') {
                rootHandle = null;
              }
            }
          } catch (e) {
            rootHandle = null;
          }
        }

        // Prompt user to select parent folder on first use
        if (!rootHandle) {
          showToast('Please choose the parent folder where "Sales Invoice" will be saved.', 'info');
          rootHandle = await window.showDirectoryPicker({
            id: 'mh-auto-sales-invoice-root',
            mode: 'readwrite',
            startIn: 'documents'
          });
          if (rootHandle) {
            await saveDirectoryHandle(rootHandle);
          }
        }

        if (rootHandle) {
          // 1. Get or create "Sales Invoice" directory
          const salesDir = await rootHandle.getDirectoryHandle('Sales Invoice', { create: true });

          // 2. Get or create Month directory: e.g. "October 2026"
          const monthDir = await salesDir.getDirectoryHandle(monthFolderName, { create: true });

          // 3. Get or create Date directory: e.g. "07 October 2026"
          const dateDir = await monthDir.getDirectoryHandle(dateFolderName, { create: true });

          // 4. Safe duplicate handling: if customer name already exists, append (1), (2), etc.
          let counter = 1;
          finalFileName = `${sanitizedCustomer}.pdf`;
          while (true) {
            try {
              await dateDir.getFileHandle(finalFileName, { create: false });
              // File exists! Append incremented counter
              finalFileName = `${sanitizedCustomer} (${counter}).pdf`;
              counter++;
            } catch (err) {
              // File does not exist yet -> safe to use this filename
              break;
            }
          }

          // 5. Write PDF file directly inside Date folder (STRICT: NO customer subfolder!)
          const fileHandle = await dateDir.getFileHandle(finalFileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(pdfBlob);
          await writable.close();

          savedPath = `Sales Invoice / ${monthFolderName} / ${dateFolderName} / ${finalFileName}`;
          usedFileSystemApi = true;
        }
      } catch (fsErr) {
        if (fsErr.name === 'AbortError') {
          showToast('Folder selection was cancelled. Proceeding with standard download.', 'warning');
        } else {
          console.warn('File System Access API error, using download fallback:', fsErr);
        }
      }
    }

    // Fallback download if File System Access API not used or cancelled
    if (!usedFileSystemApi) {
      finalFileName = `${sanitizedCustomer}.pdf`;
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = finalFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      savedPath = `Sales Invoice / ${monthFolderName} / ${dateFolderName} / ${finalFileName} (Downloaded to browser downloads folder)`;
    }

    // Cache last generated invoice
    lastGeneratedInvoice = {
      blob: pdfBlob,
      filename: finalFileName,
      pathDisplay: savedPath
    };

    // Show success modal
    showSaleInvoiceSuccessModal(lastGeneratedInvoice);

  } catch (err) {
    console.error('Failed to generate/save Sales Invoice PDF:', err);
    showToast(`Failed to save Sales Invoice: ${err.message}`, 'error');
  }
}

/**
 * Display Sale Invoice Success Modal
 */
function showSaleInvoiceSuccessModal({ filename, pathDisplay }) {
  const modal = document.getElementById('sale-invoice-success-modal');
  const filenameEl = document.getElementById('sale-invoice-success-filename');
  const pathEl = document.getElementById('sale-invoice-success-path');

  if (filenameEl) filenameEl.textContent = filename;
  if (pathEl) pathEl.textContent = pathDisplay;

  if (modal) modal.classList.remove('hidden');
  showToast('Sales Invoice saved successfully.', 'success');
}

function closeSaleInvoiceSuccessModal() {
  const modal = document.getElementById('sale-invoice-success-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Open saved Sales Invoice PDF directly in browser
 */
function openSavedSaleInvoice() {
  if (!lastGeneratedInvoice.blob) {
    showToast('No saved invoice found.', 'warning');
    return;
  }
  const fileUrl = URL.createObjectURL(lastGeneratedInvoice.blob);
  window.open(fileUrl, '_blank');
}

/**
 * Initialize all Sale Invoice workflow event listeners
 */
export function initSaleInvoiceService() {
  // 1. "Save Sale Invoice" main button in Review Matched Products table actions
  const btnSaveSale = document.getElementById('btn-save-sale-invoice');
  if (btnSaveSale) {
    btnSaveSale.addEventListener('click', () => {
      startSaveSaleInvoiceWorkflow();
    });
  }

  // 2. Customer Name input binding -> updates button enable/disable state immediately
  const customerNameInput = document.getElementById('order-customer-name');
  if (customerNameInput) {
    customerNameInput.addEventListener('input', () => {
      updateSaveSaleInvoiceButtonState();
    });
  }

  // 3. Group Discount Modal Step 1 controls
  const btnNext = document.getElementById('btn-group-discount-next');
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      handleGroupDiscountNext();
    });
  }

  const btnBack = document.getElementById('btn-group-discount-back');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      handleGroupDiscountBack();
    });
  }

  const btnCloseModal = document.getElementById('btn-group-discount-close');
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', () => {
      closeGroupDiscountModal();
    });
  }

  const discountInput = document.getElementById('group-discount-input');
  if (discountInput) {
    discountInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleGroupDiscountNext();
      }
    });
  }

  // Shortcut button to open Missed Products from Group Discount view
  const btnMissedOpt = document.getElementById('btn-group-discount-missed-opt');
  if (btnMissedOpt) {
    btnMissedOpt.addEventListener('click', () => {
      // Save current input temporarily if valid
      const curDiscountInput = document.getElementById('group-discount-input');
      const rawVal = curDiscountInput ? curDiscountInput.value.trim() : '';
      const numVal = parseFloat(rawVal);
      if (!isNaN(numVal) && numVal >= 0 && numVal <= 100) {
        const curGroup = activeDiscountWorkflow.groups[activeDiscountWorkflow.currentIndex];
        activeDiscountWorkflow.discounts[curGroup] = numVal;
      }
      showMissedProductsStepView();
    });
  }

  const btnViewMissedBadge = document.getElementById('btn-group-discount-view-missed');
  if (btnViewMissedBadge) {
    btnViewMissedBadge.addEventListener('click', () => {
      showMissedProductsStepView();
    });
  }

  // 4. Missed Products Step 2 controls
  const searchInput = document.getElementById('missed-product-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', handleMissedProductSearchInput);
  }

  const qtyInput = document.getElementById('missed-selected-qty');
  if (qtyInput) {
    qtyInput.addEventListener('input', updateMissedProductLiveCalculation);
  }

  const selectedDiscountInput = document.getElementById('missed-selected-discount');
  if (selectedDiscountInput) {
    selectedDiscountInput.addEventListener('input', updateMissedProductLiveCalculation);
  }

  const btnClearSelection = document.getElementById('btn-missed-clear-selection');
  if (btnClearSelection) {
    btnClearSelection.addEventListener('click', clearMissedProductEntryForm);
  }

  const btnConfirmAdd = document.getElementById('btn-add-missed-item-confirm');
  if (btnConfirmAdd) {
    btnConfirmAdd.addEventListener('click', handleConfirmAddMissedItem);
  }

  const btnMissedBack = document.getElementById('btn-missed-products-back');
  if (btnMissedBack) {
    btnMissedBack.addEventListener('click', () => {
      showGroupDiscountStepView();
      renderGroupDiscountStep();
    });
  }

  const btnMissedClose = document.getElementById('btn-missed-products-close');
  if (btnMissedClose) {
    btnMissedClose.addEventListener('click', closeGroupDiscountModal);
  }

  const btnSaveInvoicePdf = document.getElementById('btn-save-invoice-pdf');
  if (btnSaveInvoicePdf) {
    btnSaveInvoicePdf.addEventListener('click', async () => {
      closeGroupDiscountModal();
      await generateAndSaveSalesInvoice();
    });
  }

  // 5. Success Modal controls
  const btnOpenInvoice = document.getElementById('btn-sale-invoice-open');
  if (btnOpenInvoice) {
    btnOpenInvoice.addEventListener('click', () => {
      openSavedSaleInvoice();
    });
  }

  const btnSuccessDone = document.getElementById('btn-sale-invoice-success-done');
  if (btnSuccessDone) {
    btnSuccessDone.addEventListener('click', () => {
      closeSaleInvoiceSuccessModal();
    });
  }

  const btnSuccessCloseX = document.getElementById('btn-sale-invoice-success-close-x');
  if (btnSuccessCloseX) {
    btnSuccessCloseX.addEventListener('click', () => {
      closeSaleInvoiceSuccessModal();
    });
  }

  // Initial check of button state
  updateSaveSaleInvoiceButtonState();
}
