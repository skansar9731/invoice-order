/**
 * UI Components, Modals, Toast Notifications, and Table Renderers
 */

import { searchLocalProducts, debounce } from './productSearch.js';
import {
  getCurrentOrder,
  updateItemQuantity,
  updateItemProduct,
  updateItemCustomerText,
  removeOrderItem,
  rematchItem,
  getOrderSummary,
  addOrderItem
} from './orderManager.js';
import { generateBusyOrderPDF } from './pdfGenerator.js';
import { getShopStats } from './db.js';

let activeManualSelectItemId = null;

/**
 * Toast Notification System
 */
export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const colors = {
    success: 'bg-emerald-600 text-white border-emerald-500',
    error: 'bg-rose-600 text-white border-rose-500',
    warning: 'bg-amber-500 text-slate-900 border-amber-400',
    info: 'bg-slate-800 text-white border-slate-700'
  };

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  toast.className = `flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border text-sm font-medium transform transition-all duration-300 translate-y-2 opacity-0 ${colors[type] || colors.info}`;
  toast.innerHTML = `
    <span class="text-base font-bold">${icons[type] || 'ℹ'}</span>
    <span class="flex-1">${message}</span>
  `;

  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Render the Order Review Table
 */
export function renderOrderTable() {
  const tableBody = document.getElementById('order-table-body');
  const emptyState = document.getElementById('order-empty-state');
  const tableContainer = document.getElementById('order-table-container');
  const orderSummaryBar = document.getElementById('order-summary-bar');
  
  if (!tableBody) return;

  const order = getCurrentOrder();
  const summary = getOrderSummary();

  // Update summary bar badges
  if (orderSummaryBar) {
    document.getElementById('summary-total-items').textContent = summary.total;
    document.getElementById('summary-matched-items').textContent = summary.matched;
    document.getElementById('summary-manual-items').textContent = summary.manual;
    
    const unmatchBadge = document.getElementById('summary-unmatched-badge');
    const unmatchCountEl = document.getElementById('summary-unmatched-items');
    if (summary.unmatched > 0) {
      unmatchBadge.classList.remove('hidden');
      unmatchCountEl.textContent = summary.unmatched;
    } else {
      unmatchBadge.classList.add('hidden');
    }

    const lowStockBadge = document.getElementById('summary-lowstock-badge');
    const lowStockCountEl = document.getElementById('summary-lowstock-items');
    if (summary.lowStockCount > 0) {
      lowStockBadge.classList.remove('hidden');
      lowStockCountEl.textContent = summary.lowStockCount;
    } else {
      lowStockBadge.classList.add('hidden');
    }
  }

  if (order.items.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    if (tableContainer) tableContainer.classList.add('hidden');
    if (tableBody) tableBody.innerHTML = '';
    const cardsContainer = document.getElementById('order-cards-container');
    if (cardsContainer) cardsContainer.innerHTML = '';
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  if (tableContainer) tableContainer.classList.remove('hidden');

  const cardsContainer = document.getElementById('order-cards-container');
  if (tableBody) tableBody.innerHTML = '';
  if (cardsContainer) cardsContainer.innerHTML = '';

  order.items.forEach((item, index) => {
    // Stock check
    const stockQty = item.matchedProduct ? item.matchedProduct.stockQty : null;
    const isLowStock = stockQty !== null && stockQty < item.quantity;

    // Match badge
    let matchBadgeHtml = '';
    if (item.isManual) {
      matchBadgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-sky-100 text-sky-800 border border-sky-200">Manual</span>`;
    } else if (item.matchedProduct) {
      const conf = item.confidence || 0;
      if (conf >= 80) {
        matchBadgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">${conf}% Match</span>`;
      } else if (conf >= 50) {
        matchBadgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">${conf}% Match</span>`;
      } else {
        matchBadgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-800 border border-orange-200">${conf}% Low</span>`;
      }
    } else {
      matchBadgeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-700 border border-rose-300 animate-pulse">⚠ No Match</span>`;
    }

    // Candidate options dropdown HTML
    let candidateOptionsHtml = '';
    if (item.candidates && item.candidates.length > 0) {
      candidateOptionsHtml = `
        <div class="mt-1 text-xs text-slate-500">
          <label class="text-[11px] font-medium text-slate-400">Other Candidates:</label>
          <select data-action="select-candidate" data-item-id="${item.id}" class="mt-0.5 block w-full text-xs py-1 px-2 bg-white border border-slate-200 rounded text-slate-700 focus:ring-1 focus:ring-slate-500 focus:outline-none">
            <option value="">-- Switch to alternative match (${item.candidates.length}) --</option>
            ${item.candidates.map(c => `
              <option value="${c.product.partNumber}" ${item.matchedProduct?.partNumber === c.product.partNumber ? 'selected' : ''}>
                ${c.product.productName} (${c.confidence}%) [${c.product.partNumber}]
              </option>
            `).join('')}
          </select>
        </div>
      `;
    }

    // 1. DESKTOP VIEW: Table Row
    if (tableBody) {
      const row = document.createElement('tr');
      row.className = `border-b border-slate-200 transition-colors ${!item.matchedProduct ? 'bg-rose-50/70 hover:bg-rose-50' : 'hover:bg-slate-50'}`;

      row.innerHTML = `
        <td class="px-3 py-3 text-center text-xs font-semibold text-slate-500">${index + 1}</td>
        <td class="px-3 py-3">
          <div class="font-medium text-slate-800 text-sm flex items-center gap-2">
            <span>${escapeHtml(item.customerText)}</span>
            ${item.sourceImage ? `<span class="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-mono font-bold" title="Extracted from Image #${item.sourceImage}">#P${item.sourceImage}</span>` : ''}
            <button data-action="edit-customer-text" data-item-id="${item.id}" title="Edit customer handwritten wording" class="text-slate-400 hover:text-slate-600 text-xs">✎</button>
          </div>
        </td>
        <td class="px-3 py-3 text-center">
          <div class="inline-flex items-center border border-slate-200 rounded-md bg-white">
            <button data-action="dec-qty" data-item-id="${item.id}" class="px-2 py-0.5 text-slate-600 hover:bg-slate-100 rounded-l font-bold text-xs">-</button>
            <input type="number" min="1" max="999" value="${item.quantity}" data-action="change-qty" data-item-id="${item.id}" class="w-12 text-center text-xs font-bold py-0.5 border-0 focus:ring-0 focus:outline-none text-slate-800">
            <button data-action="inc-qty" data-item-id="${item.id}" class="px-2 py-0.5 text-slate-600 hover:bg-slate-100 rounded-r font-bold text-xs">+</button>
          </div>
        </td>
        <td class="px-3 py-3 min-w-[200px]">
          ${item.matchedProduct ? `
            <div class="font-bold text-slate-900 text-sm">${escapeHtml(item.matchedProduct.productName)}</div>
            ${candidateOptionsHtml}
          ` : `
            <div class="text-rose-600 text-xs font-semibold flex items-center gap-1.5 py-1">
              <span>⚠ No reliable automatic match found</span>
            </div>
            <button data-action="select-manual" data-item-id="${item.id}" class="mt-1 inline-flex items-center gap-1 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded text-xs font-bold shadow-sm transition">
              🔍 Select Manually
            </button>
          `}
        </td>
        <td class="px-3 py-3 text-center">
          ${item.matchedProduct ? `
            <code class="px-2 py-1 bg-slate-100 text-slate-800 rounded text-xs font-mono font-bold tracking-tight">${escapeHtml(item.matchedProduct.partNumber)}</code>
          ` : `<span class="text-slate-400 text-xs">—</span>`}
        </td>
        <td class="px-3 py-3 text-center">
          ${item.matchedProduct && item.matchedProduct.rack ? `
            <span class="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs font-semibold">${escapeHtml(item.matchedProduct.rack)}</span>
          ` : `<span class="text-slate-400 text-xs">—</span>`}
        </td>
        <td class="px-3 py-3 text-center text-xs text-slate-600">
          ${item.matchedProduct && item.matchedProduct.unit ? escapeHtml(item.matchedProduct.unit) : '<span class="text-slate-400 text-xs">—</span>'}
        </td>
        <td class="px-3 py-3 text-center">
          ${item.matchedProduct ? `
            <div class="text-xs font-medium ${isLowStock ? 'text-amber-600 font-bold' : 'text-slate-700'}">
              ${stockQty !== null && stockQty !== undefined ? stockQty : '—'}
            </div>
            ${isLowStock ? `<div class="text-[10px] text-amber-600 font-semibold">(Stock &lt; Ord)</div>` : ''}
          ` : `<span class="text-slate-400 text-xs">—</span>`}
        </td>
        <td class="px-3 py-3 text-center whitespace-nowrap">
          ${matchBadgeHtml}
        </td>
        <td class="px-3 py-3 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <button data-action="select-manual" data-item-id="${item.id}" title="Search & Pick Part Manually" class="p-1.5 text-slate-600 hover:text-sky-600 hover:bg-sky-50 rounded transition text-xs font-semibold">
              🔍
            </button>
            <button data-action="rematch" data-item-id="${item.id}" title="Re-run matching" class="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded transition text-xs font-semibold">
              🔄
            </button>
            <button data-action="remove" data-item-id="${item.id}" title="Remove item" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition text-xs font-semibold">
              ✕
            </button>
          </div>
        </td>
      `;

      tableBody.appendChild(row);
    }

    // 2. MOBILE VIEW: Responsive Card (Exact Labeled Format)
    if (cardsContainer) {
      const card = document.createElement('div');
      card.className = `bg-white rounded-xl border-2 ${!item.matchedProduct ? 'border-rose-400 bg-rose-50/20' : 'border-slate-800'} p-4 shadow-md space-y-2.5`;

      card.innerHTML = `
        <!-- S.No & Page & Quick Rematch/Delete -->
        <div class="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
          <div class="flex items-center gap-2">
            <span class="font-extrabold text-slate-900 text-xs uppercase tracking-tight">S.No</span>
            <span class="w-6 h-6 rounded-full bg-slate-900 text-white font-mono text-xs font-bold flex items-center justify-center">${index + 1}</span>
            ${item.sourceImage ? `<span class="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded font-mono font-bold border border-slate-300">#P${item.sourceImage}</span>` : ''}
            ${matchBadgeHtml}
          </div>
          <div class="flex items-center gap-1">
            <button type="button" data-action="rematch" data-item-id="${item.id}" title="Re-run matching" class="p-1 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded text-xs font-semibold">🔄</button>
            <button type="button" data-action="remove" data-item-id="${item.id}" title="Remove item" class="p-1 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded text-xs font-semibold">✕</button>
          </div>
        </div>

        <!-- Customer Handwritten Text -->
        <div class="border-b border-slate-200 pb-2">
          <div class="font-extrabold text-slate-900 text-xs mb-1 uppercase tracking-tight">Customer Handwritten Text</div>
          <div class="font-bold text-slate-900 text-sm flex items-center justify-between gap-2">
            <span>${escapeHtml(item.customerText)}</span>
            <button type="button" data-action="edit-customer-text" data-item-id="${item.id}" title="Edit customer wording" class="text-slate-500 hover:text-slate-800 text-xs px-2 py-0.5 bg-slate-100 rounded border border-slate-200 font-semibold">✎ Edit</button>
          </div>
        </div>

        <!-- Qty -->
        <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
          <span class="font-extrabold text-slate-900 uppercase tracking-tight">Qty</span>
          <div class="inline-flex items-center border-2 border-slate-800 rounded-lg bg-white shadow-xs">
            <button type="button" data-action="dec-qty" data-item-id="${item.id}" class="px-3 py-1 text-slate-900 hover:bg-slate-100 rounded-l font-extrabold text-xs">-</button>
            <input type="number" min="1" max="999" value="${item.quantity}" data-action="change-qty" data-item-id="${item.id}" class="w-10 text-center text-xs font-extrabold py-1 border-0 focus:ring-0 focus:outline-none text-slate-900">
            <button type="button" data-action="inc-qty" data-item-id="${item.id}" class="px-3 py-1 text-slate-900 hover:bg-slate-100 rounded-r font-extrabold text-xs">+</button>
          </div>
        </div>

        <!-- Matched Product -->
        <div class="border-b border-slate-200 pb-2">
          <div class="font-extrabold text-slate-900 text-xs mb-1 uppercase tracking-tight">Matched Local Product</div>
          ${item.matchedProduct ? `
            <div class="font-bold text-slate-900 text-sm leading-snug">${escapeHtml(item.matchedProduct.productName)}</div>
            ${candidateOptionsHtml}
          ` : `
            <div class="p-2.5 bg-rose-50 rounded-lg border border-rose-300 text-xs space-y-2">
              <div class="text-rose-700 font-bold">⚠ No reliable automatic match found</div>
              <button type="button" data-action="select-manual" data-item-id="${item.id}" class="w-full py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold shadow-sm transition">
                🔍 Select Manually from 5,200+ Master
              </button>
            </div>
          `}
        </div>

        ${item.matchedProduct ? `
          <!-- Part Number -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Part Number</span>
            <code class="font-mono font-bold text-xs text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-300">${escapeHtml(item.matchedProduct.partNumber)}</code>
          </div>

          <!-- Rack Location -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Rack Location</span>
            <span class="font-bold text-slate-800 px-2 py-0.5 bg-slate-100 rounded border border-slate-200">${escapeHtml(item.matchedProduct.rack || '—')}</span>
          </div>

          <!-- Unit -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Unit</span>
            <span class="font-bold text-slate-700">${escapeHtml(item.matchedProduct.unit || '—')}</span>
          </div>

          <!-- Stock -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Stock Qty</span>
            <div class="text-right">
              <span class="font-bold ${isLowStock ? 'text-amber-600 font-extrabold' : 'text-slate-800'}">
                ${stockQty !== null && stockQty !== undefined ? stockQty : '—'}
              </span>
              ${isLowStock ? `<span class="block text-[10px] text-amber-600 font-bold">(Stock &lt; Ord)</span>` : ''}
            </div>
          </div>

          <!-- Actions -->
          <div class="pt-1 flex items-center justify-between gap-2">
            <span class="font-extrabold text-slate-900 text-xs uppercase tracking-tight">Action</span>
            <button type="button" data-action="select-manual" data-item-id="${item.id}" class="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold shadow-sm transition">
              🔍 Switch Part
            </button>
          </div>
        ` : ''}
      `;

      cardsContainer.appendChild(card);
    }
  });
}

/**
 * Open the Searchable Product Selection Modal
 */
export async function openManualSelectModal(itemId) {
  activeManualSelectItemId = itemId;
  const modal = document.getElementById('manual-select-modal');
  const searchInput = document.getElementById('manual-search-input');
  const resultsContainer = document.getElementById('manual-search-results');
  const selectedItemContext = document.getElementById('manual-select-context');

  if (!modal) return;

  const order = getCurrentOrder();
  const currentItem = order.items.find(i => i.id === itemId);

  if (selectedItemContext && currentItem) {
    selectedItemContext.textContent = `Matching for: "${currentItem.customerText}" (Ordered Qty: ${currentItem.quantity})`;
  }

  // Pre-fill search input with customer item text for fast instant match
  if (searchInput && currentItem) {
    searchInput.value = currentItem.customerText;
  }

  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');

  if (searchInput) {
    searchInput.focus();
    searchInput.select();
  }

  // Perform initial search
  await performManualModalSearch(searchInput ? searchInput.value : '');
}

/**
 * Close Manual Select Modal
 */
export function closeManualSelectModal() {
  const modal = document.getElementById('manual-select-modal');
  if (modal) modal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
  activeManualSelectItemId = null;
}

/**
 * Perform search inside the Manual Select Modal
 */
export async function performManualModalSearch(query) {
  const resultsContainer = document.getElementById('manual-search-results');
  const countBadge = document.getElementById('manual-search-count');
  if (!resultsContainer) return;

  resultsContainer.innerHTML = `
    <div class="py-12 text-center text-slate-400 text-sm">
      <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-slate-700 mb-2"></div>
      <div>Searching local product master...</div>
    </div>
  `;

  const searchResult = await searchLocalProducts(query, 50);

  if (countBadge) {
    countBadge.textContent = `${searchResult.total} matches found`;
  }

  if (searchResult.items.length === 0) {
    resultsContainer.innerHTML = `
      <div class="py-12 text-center text-slate-500">
        <div class="text-3xl mb-2">📦</div>
        <div class="font-semibold text-slate-700">No matching products found in local master</div>
        <div class="text-xs text-slate-400 mt-1">Try searching with partial words, part number, or rack number</div>
      </div>
    `;
    return;
  }

  resultsContainer.innerHTML = `
    <!-- Mobile Cards View (< 768px) -->
    <div class="responsive-card-view space-y-3 p-3 bg-slate-100/70">
      ${searchResult.items.map(product => `
        <div data-select-part="${escapeHtml(product.partNumber)}" class="bg-white rounded-xl border-2 border-slate-800 p-4 shadow-md space-y-2.5 hover:bg-sky-50/50 transition cursor-pointer">
          <!-- Part Number -->
          <div class="flex items-start justify-between gap-2 border-b border-slate-200 pb-2">
            <span class="font-extrabold text-slate-900 text-xs uppercase tracking-tight">Part Number</span>
            <code class="font-mono font-bold text-xs text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-300">${escapeHtml(product.partNumber)}</code>
          </div>

          <!-- Product Name / Description -->
          <div class="border-b border-slate-200 pb-2">
            <div class="font-extrabold text-slate-900 text-xs mb-1 uppercase tracking-tight">Product Name / Description</div>
            <div class="font-bold text-slate-900 text-sm leading-snug">${escapeHtml(product.productName)}</div>
          </div>

          <!-- Stock Qty -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Stock Qty</span>
            <span class="font-bold ${product.stockQty !== null && product.stockQty > 0 ? 'text-emerald-700 font-extrabold' : 'text-slate-700'}">${product.stockQty !== null && product.stockQty !== undefined ? product.stockQty : '—'}</span>
          </div>

          <!-- Unit -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Unit</span>
            <span class="font-bold text-slate-700">${escapeHtml(product.unit || '—')}</span>
          </div>

          <!-- MRP -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">MRP</span>
            <span class="font-extrabold text-slate-900">${product.rate !== null && product.rate !== undefined && product.rate !== '' ? `₹${Number(product.rate).toLocaleString('en-IN')}` : '—'}</span>
          </div>

          <!-- Rack Number -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Rack Number</span>
            <span class="font-bold text-slate-800 px-2 py-0.5 bg-slate-100 rounded border border-slate-200">${escapeHtml(product.rack || '—')}</span>
          </div>

          <!-- Action -->
          <div class="pt-1 flex items-center justify-between gap-2">
            <span class="font-extrabold text-slate-900 text-xs uppercase tracking-tight">Action</span>
            <button type="button" class="px-4 py-2 bg-sky-600 hover:bg-sky-700 active:scale-95 text-white rounded-lg text-xs font-bold shadow transition">
              Select this Part
            </button>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- Desktop Table View (>= 768px) -->
    <div class="responsive-table-view overflow-x-auto">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-slate-100 text-slate-600 font-semibold sticky top-0 border-b border-slate-200 shadow-sm">
          <tr>
            <th class="px-3 py-2.5">Part Number</th>
            <th class="px-3 py-2.5">Product Name / Description</th>
            <th class="px-3 py-2.5 text-center">Stock</th>
            <th class="px-3 py-2.5 text-center">Unit</th>
            <th class="px-3 py-2.5 text-center">MRP</th>
            <th class="px-3 py-2.5 text-center">Rack Number</th>
            <th class="px-3 py-2.5 text-center">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 text-slate-700">
          ${searchResult.items.map(product => `
            <tr data-select-part="${escapeHtml(product.partNumber)}" class="hover:bg-sky-50/80 transition-colors cursor-pointer group">
              <td class="px-3 py-2.5 font-mono font-bold text-slate-900">${escapeHtml(product.partNumber)}</td>
              <td class="px-3 py-2.5 font-medium text-slate-800">${escapeHtml(product.productName)}</td>
              <td class="px-3 py-2.5 text-center font-bold ${product.stockQty !== null && product.stockQty > 0 ? 'text-emerald-600' : 'text-slate-600'}">${product.stockQty !== null && product.stockQty !== undefined ? product.stockQty : '—'}</td>
              <td class="px-3 py-2.5 text-center text-slate-500">${escapeHtml(product.unit || '—')}</td>
              <td class="px-3 py-2.5 text-center font-bold text-slate-900">${product.rate !== null && product.rate !== undefined && product.rate !== '' ? `₹${Number(product.rate).toLocaleString('en-IN')}` : '—'}</td>
              <td class="px-3 py-2.5 text-center"><span class="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-medium">${escapeHtml(product.rack || '—')}</span></td>
              <td class="px-3 py-2.5 text-center">
                <button type="button" class="px-3 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded font-bold text-xs shadow-sm transition">
                  Select
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Attach selection listeners for both mobile cards and desktop table rows
  resultsContainer.querySelectorAll('[data-select-part]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const partNo = el.dataset.selectPart;
      const product = searchResult.items.find(p => p.partNumber === partNo);
      if (product) {
        selectProductForActiveItem(product);
      }
    });
  });
}

/**
 * Handle product selection in modal
 */
function selectProductForActiveItem(product) {
  if (!activeManualSelectItemId) return;

  updateItemProduct(activeManualSelectItemId, product, true);
  closeManualSelectModal();
  renderOrderTable();
  showToast(`Selected "${product.productName}" [${product.partNumber}]`, 'success');
}

/**
 * Setup Global UI Event Listeners
 */
export function initUIEventListeners() {
  const tableContainer = document.getElementById('order-table-container');

  // Unified Event Delegation on Table Container (works for both Desktop Table & Mobile Cards)
  if (tableContainer) {
    tableContainer.addEventListener('click', async (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;

      const action = target.dataset.action;
      const itemId = target.dataset.itemId;

      if (action === 'select-manual') {
        openManualSelectModal(itemId);
      } else if (action === 'remove') {
        if (confirm('Are you sure you want to remove this item from the order?')) {
          removeOrderItem(itemId);
          renderOrderTable();
          showToast('Item removed from order', 'info');
        }
      } else if (action === 'rematch') {
        await rematchItem(itemId);
        renderOrderTable();
        showToast('Re-matched item against product master', 'info');
      } else if (action === 'inc-qty') {
        const input = target.parentElement.querySelector('input');
        if (input) {
          const val = parseInt(input.value, 10) || 1;
          updateItemQuantity(itemId, val + 1);
          renderOrderTable();
        }
      } else if (action === 'dec-qty') {
        const input = target.parentElement.querySelector('input');
        if (input) {
          const val = parseInt(input.value, 10) || 1;
          if (val > 1) {
            updateItemQuantity(itemId, val - 1);
            renderOrderTable();
          }
        }
      } else if (action === 'edit-customer-text') {
        const order = getCurrentOrder();
        const item = order.items.find(i => i.id === itemId);
        if (item) {
          const newText = prompt('Edit customer handwritten wording:', item.customerText);
          if (newText !== null && newText.trim()) {
            updateItemCustomerText(itemId, newText.trim());
            await rematchItem(itemId);
            renderOrderTable();
            showToast('Updated item text and re-matched', 'success');
          }
        }
      }
    });

    // Quantity Input & Candidate Select changes
    tableContainer.addEventListener('change', async (e) => {
      const target = e.target;
      const action = target.dataset.action;
      const itemId = target.dataset.itemId;

      if (action === 'change-qty') {
        const val = parseInt(target.value, 10) || 1;
        updateItemQuantity(itemId, Math.max(1, val));
        renderOrderTable();
      } else if (action === 'select-candidate') {
        const partNo = target.value;
        if (!partNo) return;
        const order = getCurrentOrder();
        const item = order.items.find(i => i.id === itemId);
        if (item && item.candidates) {
          const candidate = item.candidates.find(c => c.product.partNumber === partNo);
          if (candidate) {
            updateItemProduct(itemId, candidate.product, false);
            renderOrderTable();
            showToast(`Switched to "${candidate.product.productName}"`, 'success');
          }
        }
      }
    });
  }

  // Manual Select Modal Search Input (Debounced)
  const manualSearchInput = document.getElementById('manual-search-input');
  if (manualSearchInput) {
    const debouncedSearch = debounce((q) => performManualModalSearch(q), 150);
    manualSearchInput.addEventListener('input', (e) => {
      debouncedSearch(e.target.value);
    });
  }

  // Modal Close buttons
  const manualModalClose = document.getElementById('manual-modal-close');
  if (manualModalClose) {
    manualModalClose.addEventListener('click', closeManualSelectModal);
  }

  // Escape key closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeManualSelectModal();
    }
  });

  // Generate PDF Button
  const btnGeneratePDF = document.getElementById('btn-generate-pdf');
  if (btnGeneratePDF) {
    btnGeneratePDF.addEventListener('click', () => {
      handleGeneratePDFClick();
    });
  }
}

/**
 * Handle PDF generation with safety validation
 */
export function handleGeneratePDFClick() {
  const order = getCurrentOrder();
  if (order.items.length === 0) {
    showToast('Cannot generate PDF: The order has no items.', 'warning');
    return;
  }

  const summary = getOrderSummary();
  if (summary.hasUnmatched) {
    const proceed = confirm(
      `⚠ WARNING: There are ${summary.unmatched} unmatched item(s) in this order.\n\n` +
      `These items will be marked as [ UNMATCHED ] on the Busy entry sheet.\n\n` +
      `Do you still want to generate the PDF now?`
    );
    if (!proceed) return;
  }

  try {
    const filename = generateBusyOrderPDF(order);
    showToast(`PDF Generated successfully: ${filename}`, 'success');
  } catch (err) {
    console.error('PDF Generation error:', err);
    showToast(`Failed to generate PDF: ${err.message}`, 'error');
  }
}

/**
 * Update Dashboard Product Stats
 */
export async function refreshDashboardStats() {
  try {
    const stats = await getShopStats();
    const countEl = document.getElementById('stat-product-count');
    const importMetaEl = document.getElementById('stat-import-meta');

    if (countEl) {
      countEl.textContent = stats.totalProducts.toLocaleString();
    }

    if (importMetaEl) {
      if (stats.lastImportDate) {
        const d = new Date(stats.lastImportDate);
        const formattedDate = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        importMetaEl.textContent = `Last imported: ${formattedDate} (${stats.lastImportFileName || 'Direct'})`;
      } else {
        importMetaEl.textContent = 'No stock PDF imported yet';
      }
    }
  } catch (e) {
    console.error('Failed to load dashboard stats', e);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
