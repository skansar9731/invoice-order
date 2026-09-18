/**
 * Counter Map Module Controller
 * Maharashtra Automobile — Front Counter Workflow & Physical Stations
 *
 * Flow:
 *  Counter Map → Select Counter (1-8) → Display Counter's sections → Click Section → Display products
 *
 * 8 Initial Counters with exact section ranges:
 *  Counter 1: A to X
 *  Counter 2: A to P
 *  Counter 3: A to P
 *  Counter 4: A to T
 *  Counter 5: A to L
 *  Counter 6: A to X
 *  Counter 7: A to B
 *  Counter 8: A to T
 *
 * Independent of Rack Map. Single Source of Truth: Product Master in IndexedDB.
 */

import {
  getAllProducts,
  getCounterConfigs,
  saveCounterConfig,
  getCounterProductMappings,
  removeProductFromCounter
} from './db.js';
import { showToast } from './ui.js';

let activeView = 'counters'; // 'counters' | 'sections' | 'products'
let selectedCounterId = null;
let selectedSectionCode = null;

// Cached data
let currentCounterConfigs = [];
let currentProductMaster = [];
let currentCounterMappings = [];
let counterProductIndex = new Map(); // counterId -> { allProducts: [], sectionMap: Map(code -> [p]) }

/**
 * Main entry point called when Counter Map tab is opened
 */
export async function loadCounterMap() {
  const container = document.getElementById('tab-counter-map');
  if (!container) return;

  try {
    // 1. Fetch Product Master (Source of Truth)
    currentProductMaster = (await getAllProducts()) || [];

    // 2. Fetch Counter Configurations
    currentCounterConfigs = await getCounterConfigs();

    // 3. Fetch Counter Product Mappings
    currentCounterMappings = (await getCounterProductMappings()) || [];

    // 4. Index products mapped to counters
    buildCounterProductIndex();

    // 5. Render active view
    renderCurrentView();
  } catch (err) {
    console.error('Failed to load Counter Map:', err);
    showToast('Error loading Counter Map: ' + err.message, 'error');
  }
}

/**
 * Build index of products belonging to each counter and section
 */
function buildCounterProductIndex() {
  counterProductIndex.clear();

  // Initialize for all active counters
  currentCounterConfigs.forEach(counter => {
    counterProductIndex.set(counter.id, {
      allProducts: [],
      sectionMap: new Map()
    });
  });

  // Map products via explicit counterProductMapping store
  const productMasterMap = new Map();
  currentProductMaster.forEach(p => productMasterMap.set(p.partNumber.trim().toUpperCase(), p));

  currentCounterMappings.forEach(mapping => {
    const product = productMasterMap.get(mapping.partNumber);
    if (!product) return; // Stale mapping for deleted product

    const counterData = counterProductIndex.get(mapping.counterId);
    if (!counterData) return;

    // Attach mapping id for removal action
    const enrichedProduct = { ...product, _mappingId: mapping.id, _subSectionId: mapping.subSectionId };

    if (!counterData.allProducts.some(p => p.partNumber === product.partNumber)) {
      counterData.allProducts.push(enrichedProduct);
    }

    const sec = mapping.sectionCode.toUpperCase();
    if (!counterData.sectionMap.has(sec)) {
      counterData.sectionMap.set(sec, []);
    }
    counterData.sectionMap.get(sec).push(enrichedProduct);
  });

  // Also check if any product's rack field explicitly references a counter (e.g. "C-1 A", "COUNTER 1 A")
  currentProductMaster.forEach(p => {
    if (!p.rack) return;
    const raw = p.rack.trim().toUpperCase();
    const cMatch = raw.match(/(?:COUNTER|C)[-_\s]*([1-8])[-_\s]*([A-Z])/i);
    if (cMatch) {
      const cId = `C${cMatch[1]}`;
      const sec = cMatch[2].toUpperCase();
      const counterData = counterProductIndex.get(cId);
      if (counterData) {
        if (!counterData.allProducts.some(item => item.partNumber === p.partNumber)) {
          counterData.allProducts.push(p);
        }
        if (!counterData.sectionMap.has(sec)) {
          counterData.sectionMap.set(sec, []);
        }
        if (!counterData.sectionMap.get(sec).some(item => item.partNumber === p.partNumber)) {
          counterData.sectionMap.get(sec).push(p);
        }
      }
    }
  });
}

/**
 * Route view rendering
 */
function renderCurrentView() {
  const container = document.getElementById('tab-counter-map');
  if (!container) return;

  if (activeView === 'products' && selectedCounterId && selectedSectionCode) {
    renderSectionProductsView(container);
  } else if (activeView === 'sections' && selectedCounterId) {
    renderCounterSectionsView(container);
  } else {
    activeView = 'counters';
    selectedCounterId = null;
    selectedSectionCode = null;
    renderAllCountersView(container);
  }
}

/**
 * ----------------------------------------------------------------------------
 * VIEW 1: ALL COUNTERS GRID (8 Counters)
 * ----------------------------------------------------------------------------
 */
function renderAllCountersView(container) {
  let totalMappedProducts = 0;
  let totalMappedQuantity = 0;

  for (const cData of counterProductIndex.values()) {
    totalMappedProducts += cData.allProducts.length;
    for (const p of cData.allProducts) {
      const q = Number(p.stockQty);
      if (!isNaN(q) && q > 0) totalMappedQuantity += q;
    }
  }

  const activeCounters = currentCounterConfigs.filter(c => !c.archived);

  container.innerHTML = `
    <!-- Top Header & Summary -->
    <div class="bg-white rounded-xl shadow-xs border border-slate-200 p-5 sm:p-6 transition">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <span>📍 Shop Counter Map</span>
            </h2>
            <span class="text-xs font-bold px-2 py-0.5 bg-sky-100 text-sky-800 rounded">
              ${activeCounters.length} Counters
            </span>
          </div>
          <p class="text-xs text-slate-500 mt-1">
            Physical front-desk counter stations, dispatch trays, and customer pickup bins.
          </p>
        </div>

        <div class="flex items-center gap-2.5">
          <button type="button" id="btn-open-manage-counters"
            class="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold border border-slate-300 transition flex items-center gap-1.5 shadow-2xs">
            <span>⚙️</span>
            <span>Manage Counters</span>
          </button>
        </div>
      </div>

      <!-- Quick Metrics Bar -->
      <div class="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
          <div class="text-slate-500 font-medium">Active Counters</div>
          <div class="text-base font-extrabold text-slate-900 mt-0.5">${activeCounters.length}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
          <div class="text-slate-500 font-medium">Total Products Mapped</div>
          <div class="text-base font-extrabold text-sky-700 mt-0.5">${totalMappedProducts.toLocaleString()}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80 col-span-2 sm:col-span-1">
          <div class="text-slate-500 font-medium">Total Available Qty</div>
          <div class="text-base font-extrabold text-sky-700 mt-0.5">${totalMappedQuantity.toLocaleString()}</div>
        </div>
      </div>
    </div>

    <!-- 8 Counters Responsive Grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      ${activeCounters.map(counter => {
        const cData = counterProductIndex.get(counter.id) || { allProducts: [], sectionMap: new Map() };
        const prodCount = cData.allProducts.length;
        let qtySum = 0;
        cData.allProducts.forEach(p => {
          const q = Number(p.stockQty);
          if (!isNaN(q) && q > 0) qtySum += q;
        });
        const sectionCount = (counter.sections || []).filter(s => !s.archived).length;

        return `
          <button type="button" data-counter-select="${counter.id}"
            class="text-left p-4 rounded-xl border border-slate-200 hover:border-sky-500 bg-white hover:bg-sky-50/20 shadow-2xs transition group flex flex-col justify-between min-h-[130px]">
            <div>
              <div class="flex items-center justify-between">
                <span class="font-extrabold text-base text-slate-900 group-hover:text-sky-700">
                  ${counter.name || counter.id}
                </span>
                <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-mono">
                  ${counter.sectionStart} to ${counter.sectionEnd}
                </span>
              </div>
              <div class="text-xs text-slate-500 mt-1">
                ${sectionCount} Sections configured
              </div>
            </div>

            <div class="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span class="text-slate-500 font-medium"><b>${prodCount}</b> items</span>
              <span class="font-bold ${qtySum > 0 ? 'text-sky-700' : 'text-slate-400'}">Qty: ${qtySum}</span>
            </div>
          </button>
        `;
      }).join('')}
    </div>
  `;

  // Bind click event on counters
  container.querySelectorAll('[data-counter-select]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCounterId = btn.dataset.counterSelect;
      activeView = 'sections';
      renderCurrentView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Bind Manage Counters button
  container.querySelector('#btn-open-manage-counters')?.addEventListener('click', () => {
    import('./mapManager.js').then(m => m.openManageMapsModal('counters'));
  });
}

/**
 * ----------------------------------------------------------------------------
 * VIEW 2: COUNTER SECTIONS VIEW
 * ----------------------------------------------------------------------------
 */
function renderCounterSectionsView(container) {
  const counter = currentCounterConfigs.find(c => c.id === selectedCounterId);
  if (!counter) {
    activeView = 'counters';
    renderCurrentView();
    return;
  }

  const cData = counterProductIndex.get(counter.id) || { allProducts: [], sectionMap: new Map() };
  const prodCount = cData.allProducts.length;
  let qtySum = 0;
  cData.allProducts.forEach(p => {
    const q = Number(p.stockQty);
    if (!isNaN(q) && q > 0) qtySum += q;
  });

  const activeSections = (counter.sections || []).filter(s => !s.archived);

  container.innerHTML = `
    <!-- Header with Breadcrumbs -->
    <div class="bg-white rounded-xl shadow-xs border border-slate-200 p-5 sm:p-6 transition">
      <div class="flex items-center gap-2 text-xs text-slate-500 mb-2">
        <button type="button" id="btn-back-to-counters" class="hover:text-slate-900 font-bold flex items-center gap-1 text-sky-700">
          <span>← All Counters</span>
        </button>
        <span>/</span>
        <span class="font-bold text-slate-700">${counter.name || counter.id}</span>
      </div>

      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 class="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <span>${counter.name || counter.id}</span>
            <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800 font-mono">
              Sections: ${counter.sectionStart} to ${counter.sectionEnd}
            </span>
          </h2>
          <p class="text-xs text-slate-500 mt-1">
            Independent counter station layout. Select a section to view or assign products.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button type="button" id="btn-add-section-to-counter"
            class="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-xs">
            <span>+ Add Section</span>
          </button>
        </div>
      </div>

      <!-- Dynamic Totals Banner -->
      <div class="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
          <div class="text-slate-500 font-medium">Configured Sections</div>
          <div class="text-base font-extrabold text-slate-900 mt-0.5">${activeSections.length}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
          <div class="text-slate-500 font-medium">Total Products</div>
          <div class="text-base font-extrabold text-sky-700 mt-0.5">${prodCount}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80 col-span-2 sm:col-span-1">
          <div class="text-slate-500 font-medium">Total Quantity</div>
          <div class="text-base font-extrabold text-sky-700 mt-0.5">${qtySum}</div>
        </div>
      </div>
    </div>

    <!-- Sections Grid -->
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      ${activeSections.map(sec => {
        const secProds = cData.sectionMap.get(sec.code) || [];
        const sCount = secProds.length;
        let sQty = 0;
        secProds.forEach(p => {
          const q = Number(p.stockQty);
          if (!isNaN(q) && q > 0) sQty += q;
        });
        const subCount = (sec.subSections || []).filter(sub => !sub.archived).length;

        return `
          <button type="button" data-section-select="${sec.code}"
            class="text-left p-3.5 rounded-xl border border-slate-200 hover:border-sky-500 bg-white hover:bg-sky-50/20 shadow-2xs transition group flex flex-col justify-between min-h-[110px]">
            <div>
              <div class="flex items-center justify-between">
                <span class="font-mono font-extrabold text-lg text-slate-900 group-hover:text-sky-700">
                  ${sec.code}
                </span>
                ${subCount > 0 ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">${subCount} sub</span>` : ''}
              </div>
              <div class="text-[11px] text-slate-600 font-medium truncate mt-1" title="${escapeHtml(sec.displayName || '')}">
                ${sec.displayName ? escapeHtml(sec.displayName) : '<span class="text-slate-400 italic">No name</span>'}
              </div>
            </div>

            <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
              <span class="text-slate-500 font-medium"><b>${sCount}</b> items</span>
              <span class="font-bold ${sQty > 0 ? 'text-sky-700' : 'text-slate-400'}">Qty: ${sQty}</span>
            </div>
          </button>
        `;
      }).join('')}
    </div>
  `;

  // Bind back button
  container.querySelector('#btn-back-to-counters')?.addEventListener('click', () => {
    activeView = 'counters';
    selectedCounterId = null;
    selectedSectionCode = null;
    renderCurrentView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Bind section click
  container.querySelectorAll('[data-section-select]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedSectionCode = btn.dataset.sectionSelect;
      activeView = 'products';
      renderCurrentView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Bind add section button
  container.querySelector('#btn-add-section-to-counter')?.addEventListener('click', () => {
    import('./mapManager.js').then(m => m.promptAddSection('counter', counter.id));
  });
}

/**
 * ----------------------------------------------------------------------------
 * VIEW 3: COUNTER SECTION PRODUCTS VIEW
 * ----------------------------------------------------------------------------
 */
function renderSectionProductsView(container) {
  const counter = currentCounterConfigs.find(c => c.id === selectedCounterId);
  if (!counter) {
    activeView = 'counters';
    renderCurrentView();
    return;
  }

  const section = (counter.sections || []).find(s => s.code === selectedSectionCode) || {
    code: selectedSectionCode,
    displayName: '',
    subSections: []
  };

  const cData = counterProductIndex.get(counter.id) || { allProducts: [], sectionMap: new Map() };
  const products = cData.sectionMap.get(selectedSectionCode) || [];

  // Dynamic totals
  const totalProducts = products.length;
  let totalQuantity = 0;
  products.forEach(p => {
    const q = Number(p.stockQty);
    if (!isNaN(q) && q > 0) totalQuantity += q;
  });

  const activeSubSections = (section.subSections || []).filter(s => !s.archived);

  container.innerHTML = `
    <!-- Header with Breadcrumbs -->
    <div class="bg-white rounded-xl shadow-xs border border-slate-200 p-5 sm:p-6 transition">
      <div class="flex items-center gap-2 text-xs text-slate-500 mb-2">
        <button type="button" id="btn-back-to-all-counters" class="hover:text-slate-900 font-bold text-sky-700">
          All Counters
        </button>
        <span>/</span>
        <button type="button" id="btn-back-to-counter-sections" class="hover:text-slate-900 font-bold text-sky-700 font-mono">
          ${counter.name || counter.id}
        </button>
        <span>/</span>
        <span class="font-mono font-bold text-slate-700">Section ${section.code}</span>
      </div>

      <!-- Section Title & Actions -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-xl font-extrabold text-slate-900">
              ${counter.name || counter.id} — Section ${section.code}
            </h2>
            <button type="button" id="btn-rename-counter-section"
              class="px-2 py-1 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition flex items-center gap-1">
              <span>✏️ Rename</span>
            </button>
          </div>

          <!-- Editable Display Name -->
          <div class="text-sm font-semibold text-sky-700 mt-1">
            ${section.displayName ? escapeHtml(section.displayName) : '<span class="text-slate-400 font-normal italic">No display name assigned (e.g. "FAST-MOVING SPARK PLUGS")</span>'}
          </div>
        </div>

        <div class="flex items-center gap-2 self-start sm:self-auto">
          <button type="button" id="btn-assign-product-modal"
            class="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-xs">
            <span>+ Assign Product</span>
          </button>
          <button type="button" id="btn-add-counter-subsection"
            class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-2xs">
            <span>+ Sub-section</span>
          </button>
        </div>
      </div>

      <!-- Sub-sections List if any -->
      ${activeSubSections.length > 0 ? `
        <div class="pt-3 pb-1 flex flex-wrap items-center gap-2 text-xs">
          <span class="text-slate-400 font-semibold text-[11px]">Sub-sections:</span>
          ${activeSubSections.map(sub => `
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 border border-slate-200 font-medium">
              <span class="font-bold font-mono text-sky-800">${sub.code || sub.id}</span>
              ${sub.displayName ? `<span>• ${escapeHtml(sub.displayName)}</span>` : ''}
              <button type="button" data-rename-sub="${sub.id}" class="text-slate-400 hover:text-slate-800 font-bold" title="Rename Sub-section">✏️</button>
              <button type="button" data-archive-sub="${sub.id}" class="text-slate-400 hover:text-rose-600 font-bold" title="Archive Sub-section">✕</button>
            </span>
          `).join('')}
        </div>
      ` : ''}

      <!-- Dynamic Totals Banner -->
      <div class="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
          <div class="text-slate-500 font-medium">Total Products</div>
          <div class="text-base font-extrabold text-slate-900 mt-0.5">${totalProducts}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
          <div class="text-slate-500 font-medium">Total Available Qty</div>
          <div class="text-base font-extrabold text-sky-700 mt-0.5">${totalQuantity}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80 col-span-2 sm:col-span-1">
          <div class="text-slate-500 font-medium">Source Authority</div>
          <div class="text-xs font-bold text-slate-700 mt-1">Product Master (Live)</div>
        </div>
      </div>
    </div>

    <!-- Products List (Dual-View: Desktop Table, Mobile Cards) -->
    <div class="space-y-3">
      <div class="flex items-center justify-between text-xs font-bold text-slate-700 px-1">
        <span>Assigned Products (${totalProducts})</span>
      </div>

      ${totalProducts === 0 ? `
        <div class="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-2">
          <div class="text-slate-400 text-xs">
            No products currently mapped to <b>${counter.name || counter.id} / Section ${section.code}</b>.
          </div>
          <button type="button" id="btn-empty-assign"
            class="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-lg transition inline-flex items-center gap-1.5 shadow-xs">
            <span>+ Assign Product from Master</span>
          </button>
        </div>
      ` : `
        <!-- Desktop Table View -->
        <div class="responsive-table-view bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
          <table class="w-full text-left text-xs border-collapse">
            <thead class="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th class="px-3 py-2.5 w-12 text-center">#</th>
                <th class="px-3 py-2.5 min-w-[240px]">Product Name / Item Details</th>
                <th class="px-3 py-2.5">Part Number</th>
                <th class="px-3 py-2.5">Group</th>
                <th class="px-3 py-2.5 text-center">Available Qty</th>
                <th class="px-3 py-2.5 text-center">Unit</th>
                <th class="px-3 py-2.5 text-right">MRP</th>
                <th class="px-3 py-2.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-slate-800">
              ${products.map((p, idx) => {
                const qty = (p.stockQty !== null && p.stockQty !== undefined && p.stockQty !== '') ? Number(p.stockQty) : 0;
                return `
                  <tr class="hover:bg-slate-50/80 transition">
                    <td class="px-3 py-2 text-center text-slate-400 font-mono">${idx + 1}</td>
                    <td class="px-3 py-2 font-bold text-slate-900">${escapeHtml(p.productName || p.itemDetails || '-')}</td>
                    <td class="px-3 py-2 font-mono text-slate-600 font-semibold">${escapeHtml(p.partNumber || '-')}</td>
                    <td class="px-3 py-2"><span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">${escapeHtml(p.group || p.parentGroup || '-')}</span></td>
                    <td class="px-3 py-2 text-center font-extrabold ${qty > 0 ? 'text-sky-700' : 'text-slate-400'}">${qty}</td>
                    <td class="px-3 py-2 text-center text-slate-500">${escapeHtml(p.unit || 'Pcs.')}</td>
                    <td class="px-3 py-2 text-right font-mono font-bold">₹${p.rate ? Number(p.rate).toFixed(2) : '0.00'}</td>
                    <td class="px-3 py-2 text-center">
                      ${p._mappingId ? `
                        <button type="button" data-unassign-mapping="${p._mappingId}"
                          class="px-2 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-50 rounded border border-rose-200 transition"
                          title="Remove from Counter Section">
                          Unassign
                        </button>
                      ` : `
                        <span class="text-[10px] text-slate-400 italic">Rack field</span>
                      `}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- Mobile Cards View -->
        <div class="responsive-card-view space-y-2.5">
          ${products.map((p, idx) => {
            const qty = (p.stockQty !== null && p.stockQty !== undefined && p.stockQty !== '') ? Number(p.stockQty) : 0;
            return `
              <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-2">
                <div class="flex items-start justify-between gap-2">
                  <div class="font-bold text-xs text-slate-900 leading-tight">
                    ${escapeHtml(p.productName || p.itemDetails || '-')}
                  </div>
                  <div class="font-mono font-extrabold text-xs ${qty > 0 ? 'text-sky-700' : 'text-slate-400'} shrink-0">
                    Qty: ${qty}
                  </div>
                </div>

                <div class="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                  <span class="font-mono font-semibold text-slate-700">${escapeHtml(p.partNumber || '-')}</span>
                  <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">${escapeHtml(p.group || p.parentGroup || '-')}</span>
                  <span class="font-mono font-bold text-slate-900">₹${p.rate ? Number(p.rate).toFixed(2) : '0.00'}</span>
                  ${p._mappingId ? `
                    <button type="button" data-unassign-mapping="${p._mappingId}"
                      class="px-2 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-50 rounded border border-rose-200 transition">
                      Remove
                    </button>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;

  // Breadcrumbs
  container.querySelector('#btn-back-to-all-counters')?.addEventListener('click', () => {
    activeView = 'counters';
    selectedCounterId = null;
    selectedSectionCode = null;
    renderCurrentView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  container.querySelector('#btn-back-to-counter-sections')?.addEventListener('click', () => {
    activeView = 'sections';
    selectedSectionCode = null;
    renderCurrentView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Rename Section
  container.querySelector('#btn-rename-counter-section')?.addEventListener('click', () => {
    promptRenameCounterSectionDisplayName(counter, section.code);
  });

  // Add Sub-section
  container.querySelector('#btn-add-counter-subsection')?.addEventListener('click', () => {
    promptAddCounterSubSection(counter, section.code);
  });

  // Assign Product Modal triggers
  const openAssignModal = () => {
    import('./mapManager.js').then(m => m.openAssignProductToCounterModal(counter.id, section.code));
  };
  container.querySelector('#btn-assign-product-modal')?.addEventListener('click', openAssignModal);
  container.querySelector('#btn-empty-assign')?.addEventListener('click', openAssignModal);

  // Unassign mapping handler
  container.querySelectorAll('[data-unassign-mapping]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const mId = btn.dataset.unassignMapping;
      if (!confirm('Unassign this product from this counter section?')) return;
      await removeProductFromCounter(mId);
      showToast('Product unassigned', 'info');
      await loadCounterMap();
    });
  });

  // Sub-section rename & archive handlers
  container.querySelectorAll('[data-rename-sub]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const subId = btn.dataset.renameSub;
      promptRenameCounterSubSection(counter, section.code, subId);
    });
  });

  container.querySelectorAll('[data-archive-sub]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const subId = btn.dataset.archiveSub;
      archiveCounterSubSection(counter, section.code, subId);
    });
  });
}

/**
 * ----------------------------------------------------------------------------
 * COUNTER SECTION & SUB-SECTION CRUD ACTIONS
 * ----------------------------------------------------------------------------
 */
async function promptRenameCounterSectionDisplayName(counter, sectionCode) {
  const sec = (counter.sections || []).find(s => s.code === sectionCode);
  if (!sec) return;

  const current = sec.displayName || '';
  const newName = prompt(`Enter display name for ${counter.name || counter.id} Section ${sectionCode}:\n(e.g. "FAST-MOVING SPARK PLUGS")`, current);

  if (newName === null) return;
  sec.displayName = newName.trim();

  await saveCounterConfig(counter);
  showToast(`Section ${sectionCode} updated to "${sec.displayName || 'No name'}"`, 'success');
  renderCurrentView();
}

async function promptAddCounterSubSection(counter, sectionCode) {
  const sec = (counter.sections || []).find(s => s.code === sectionCode);
  if (!sec) return;

  if (!sec.subSections) sec.subSections = [];

  const existingCount = sec.subSections.length;
  const defaultCode = `${sectionCode}-${existingCount + 1}`;
  const code = prompt(`Enter Sub-section Code:\n(e.g. "${defaultCode}")`, defaultCode);
  if (!code) return;

  const displayName = prompt(`Enter Display Name for ${code} (optional):`, '');

  sec.subSections.push({
    id: `${counter.id}_${sectionCode}_${code.trim()}`,
    code: code.trim(),
    displayName: (displayName || '').trim(),
    archived: false,
    createdAt: Date.now()
  });

  await saveCounterConfig(counter);
  showToast(`Sub-section ${code} added`, 'success');
  renderCurrentView();
}

async function promptRenameCounterSubSection(counter, sectionCode, subId) {
  const sec = (counter.sections || []).find(s => s.code === sectionCode);
  if (!sec || !sec.subSections) return;
  const sub = sec.subSections.find(s => s.id === subId);
  if (!sub) return;

  const newName = prompt(`Enter new display name for Sub-section ${sub.code}:`, sub.displayName || '');
  if (newName === null) return;

  sub.displayName = newName.trim();
  await saveCounterConfig(counter);
  showToast(`Sub-section ${sub.code} updated`, 'success');
  renderCurrentView();
}

async function archiveCounterSubSection(counter, sectionCode, subId) {
  const sec = (counter.sections || []).find(s => s.code === sectionCode);
  if (!sec || !sec.subSections) return;
  const sub = sec.subSections.find(s => s.id === subId);
  if (!sub) return;

  if (!confirm(`Archive Sub-section ${sub.code}?`)) return;

  sub.archived = true;
  await saveCounterConfig(counter);
  showToast(`Sub-section ${sub.code} archived`, 'info');
  renderCurrentView();
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
