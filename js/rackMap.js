/**
 * Rack Map Module Controller
 * Maharashtra Automobile — Physical Storage Floor Reference Layer
 *
 * Flow:
 *  Rack Map → Select Rack → Display that Rack's sections → Click Section → Display products
 *
 * 71 Active Racks (R1–R73 excluding R12 and R64)
 * Single Source of Truth: Product Master in IndexedDB
 */

import { getAllProducts, getRackConfigs, saveRackConfig } from './db.js';
import { parseProductRack, UNASSIGNED_SECTION_CODE } from './rackParser.js';
import { showToast } from './ui.js';

let activeView = 'racks'; // 'racks' | 'sections' | 'products'
let selectedRackId = null;
let selectedSectionCode = null;

// Cached data
let currentRackConfigs = [];
let currentProductMaster = [];
let rackProductIndex = new Map(); // rackId -> { products: Set(p), sections: Map(code -> [p]) }

/**
 * Main entry point called when Rack Map tab is opened
 */
export async function loadRackMap() {
  const container = document.getElementById('tab-rack-map');
  if (!container) return;

  try {
    // 1. Fetch live products from IndexedDB (Product Master)
    currentProductMaster = (await getAllProducts()) || [];

    // 2. Fetch rack configurations from IndexedDB
    currentRackConfigs = await getRackConfigs();

    // 3. Index products by rack and section
    buildRackProductIndex();

    // 4. Render active view
    renderCurrentView();
  } catch (err) {
    console.error('Failed to load Rack Map:', err);
    showToast('Error loading Rack Map: ' + err.message, 'error');
  }
}

/**
 * Build fast lookup map from current Product Master
 */
function buildRackProductIndex() {
  rackProductIndex.clear();

  // Initialize index for all configured racks
  currentRackConfigs.forEach(rack => {
    rackProductIndex.set(rack.id, {
      allProducts: [],
      sectionMap: new Map() // code -> array of products
    });
  });

  // Distribute products into racks and sections
  currentProductMaster.forEach(product => {
    if (!product.rack) return;
    const parsed = parseProductRack(product.rack);
    if (!parsed) return;

    // Normalize rack key (e.g. R1, R66)
    const rackId = parsed.rackId;

    if (!rackProductIndex.has(rackId)) {
      // Dynamic rack found in products that might not be in standard 71
      rackProductIndex.set(rackId, {
        allProducts: [],
        sectionMap: new Map()
      });
    }

    const rackData = rackProductIndex.get(rackId);
    rackData.allProducts.push(product);

    // Add to each section listed (e.g. R-60 N & P belongs to both N and P)
    parsed.sections.forEach(secCode => {
      if (!rackData.sectionMap.has(secCode)) {
        rackData.sectionMap.set(secCode, []);
      }
      rackData.sectionMap.get(secCode).push(product);
    });
  });
}

/**
 * Route rendering based on active view state
 */
function renderCurrentView() {
  const container = document.getElementById('tab-rack-map');
  if (!container) return;

  if (activeView === 'products' && selectedRackId && selectedSectionCode) {
    renderSectionProductsView(container);
  } else if (activeView === 'sections' && selectedRackId) {
    renderRackSectionsView(container);
  } else {
    activeView = 'racks';
    selectedRackId = null;
    selectedSectionCode = null;
    renderAllRacksView(container);
  }
}

/**
 * ----------------------------------------------------------------------------
 * VIEW 1: ALL RACKS GRID (71 Active Racks)
 * ----------------------------------------------------------------------------
 */
function renderAllRacksView(container) {
  // Calculate total products and total quantity across all racks
  let totalMappedProducts = 0;
  let totalMappedQuantity = 0;

  for (const rackData of rackProductIndex.values()) {
    totalMappedProducts += rackData.allProducts.length;
    for (const p of rackData.allProducts) {
      const q = Number(p.stockQty);
      if (!isNaN(q) && q > 0) totalMappedQuantity += q;
    }
  }

  // Filter out archived racks for display
  const activeRacks = currentRackConfigs.filter(r => !r.archived);

  container.innerHTML = `
    <!-- Top Header & Summary -->
    <div class="bg-white rounded-xl shadow-xs border border-slate-200 p-5 sm:p-6 transition">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <span>🗺️ Shop Rack Map</span>
            </h2>
            <span class="text-xs font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded">
              ${activeRacks.length} Active Racks
            </span>
          </div>
          <p class="text-xs text-slate-500 mt-1">
            Physical shop floor shelves and storage bays. Select a rack to inspect its sections and items.
          </p>
        </div>

        <div class="flex items-center gap-2.5">
          <button type="button" id="btn-open-manage-racks"
            class="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold border border-slate-300 transition flex items-center gap-1.5 shadow-2xs">
            <span>⚙️</span>
            <span>Manage Racks</span>
          </button>
        </div>
      </div>

      <!-- Quick Metrics Bar -->
      <div class="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
          <div class="text-slate-500 font-medium">Active Racks</div>
          <div class="text-base font-extrabold text-slate-900 mt-0.5">${activeRacks.length}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
          <div class="text-slate-500 font-medium">Total Products</div>
          <div class="text-base font-extrabold text-emerald-700 mt-0.5">${totalMappedProducts.toLocaleString()}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80 col-span-2 sm:col-span-1">
          <div class="text-slate-500 font-medium">Total Available Qty</div>
          <div class="text-base font-extrabold text-emerald-700 mt-0.5">${totalMappedQuantity.toLocaleString()}</div>
        </div>
      </div>

      <!-- Quick Rack Filter / Jump Input -->
      <div class="mt-4">
        <div class="relative">
          <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-sm">
            🔎
          </span>
          <input type="text" id="rack-list-filter-input"
            placeholder="Filter by Rack number (e.g. 1, 66, R60)..."
            class="w-full text-xs sm:text-sm pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none transition">
        </div>
      </div>
    </div>

    <!-- 71 Racks Responsive Grid -->
    <div id="racks-grid-container" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      <!-- Injected rack cards -->
    </div>
  `;

  // Render rack cards
  const gridContainer = container.querySelector('#racks-grid-container');
  renderRackCards(gridContainer, activeRacks);

  // Bind filter input
  const filterInput = container.querySelector('#rack-list-filter-input');
  if (filterInput) {
    filterInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const filtered = activeRacks.filter(r => {
        if (!q) return true;
        const rIdClean = r.id.toUpperCase();
        const rNum = String(r.rackNum);
        return rIdClean.includes(q) || rNum.includes(q) || r.name.toUpperCase().includes(q);
      });
      renderRackCards(gridContainer, filtered);
    });
  }

  // Bind Manage Racks modal trigger
  const btnManage = container.querySelector('#btn-open-manage-racks');
  if (btnManage) {
    btnManage.addEventListener('click', () => {
      import('./mapManager.js').then(m => m.openManageMapsModal('racks'));
    });
  }
}

function renderRackCards(container, racks) {
  if (!container) return;

  if (racks.length === 0) {
    container.innerHTML = `
      <div class="col-span-full text-center py-10 bg-white rounded-xl border border-slate-200 text-slate-400 text-xs">
        No racks match your filter.
      </div>
    `;
    return;
  }

  container.innerHTML = racks.map(rack => {
    const rackData = rackProductIndex.get(rack.id) || { allProducts: [], sectionMap: new Map() };
    const prodCount = rackData.allProducts.length;
    let qtySum = 0;
    rackData.allProducts.forEach(p => {
      const q = Number(p.stockQty);
      if (!isNaN(q) && q > 0) qtySum += q;
    });

    const configuredSectionCount = (rack.sections || []).filter(s => !s.archived).length;
    const hasUnassigned = rackData.sectionMap.has(UNASSIGNED_SECTION_CODE);

    return `
      <button type="button" data-rack-select="${rack.id}"
        class="text-left p-3.5 rounded-xl border border-slate-200 hover:border-emerald-500 bg-white hover:bg-emerald-50/20 shadow-2xs transition group flex flex-col justify-between min-h-[110px]">
        <div>
          <div class="flex items-center justify-between">
            <span class="font-mono font-extrabold text-base text-slate-900 group-hover:text-emerald-700">
              ${rack.name || rack.id}
            </span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
              ${rack.sectionStart}-${rack.sectionEnd}
            </span>
          </div>
          <div class="text-[11px] text-slate-500 mt-1">
            ${configuredSectionCount} sections ${hasUnassigned ? '<span class="text-amber-600 font-bold" title="Has unassigned items">⚠</span>' : ''}
          </div>
        </div>

        <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
          <span class="text-slate-500 font-medium"><b>${prodCount}</b> items</span>
          <span class="font-bold ${qtySum > 0 ? 'text-emerald-700' : 'text-slate-400'}">Qty: ${qtySum}</span>
        </div>
      </button>
    `;
  }).join('');

  // Bind click event on cards
  container.querySelectorAll('[data-rack-select]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedRackId = btn.dataset.rackSelect;
      activeView = 'sections';
      renderCurrentView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

/**
 * ----------------------------------------------------------------------------
 * VIEW 2: RACK SECTIONS VIEW
 * ----------------------------------------------------------------------------
 */
function renderRackSectionsView(container) {
  const rack = currentRackConfigs.find(r => r.id === selectedRackId);
  if (!rack) {
    activeView = 'racks';
    renderCurrentView();
    return;
  }

  const rackData = rackProductIndex.get(rack.id) || { allProducts: [], sectionMap: new Map() };
  const prodCount = rackData.allProducts.length;
  let qtySum = 0;
  rackData.allProducts.forEach(p => {
    const q = Number(p.stockQty);
    if (!isNaN(q) && q > 0) qtySum += q;
  });

  const activeSections = (rack.sections || []).filter(s => !s.archived);
  const unassignedProducts = rackData.sectionMap.get(UNASSIGNED_SECTION_CODE) || [];

  container.innerHTML = `
    <!-- Header with Breadcrumbs -->
    <div class="bg-white rounded-xl shadow-xs border border-slate-200 p-5 sm:p-6 transition">
      <div class="flex items-center gap-2 text-xs text-slate-500 mb-2">
        <button type="button" id="btn-back-to-racks" class="hover:text-slate-900 font-bold flex items-center gap-1 text-emerald-700">
          <span>← All Racks</span>
        </button>
        <span>/</span>
        <span class="font-mono font-bold text-slate-700">${rack.name || rack.id}</span>
      </div>

      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 class="text-xl font-extrabold text-slate-900 font-mono flex items-center gap-2">
            <span>${rack.name || rack.id}</span>
            <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-sans">
              Sections: ${rack.sectionStart} to ${rack.sectionEnd}
            </span>
          </h2>
          <p class="text-xs text-slate-500 mt-1">
            Select a section shelf to view products stored in this physical position.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button type="button" id="btn-add-section-to-rack"
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
          <div class="text-base font-extrabold text-emerald-700 mt-0.5">${prodCount}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80 col-span-2 sm:col-span-1">
          <div class="text-slate-500 font-medium">Total Quantity</div>
          <div class="text-base font-extrabold text-emerald-700 mt-0.5">${qtySum}</div>
        </div>
      </div>
    </div>

    <!-- Unassigned Products Alert Banner if present -->
    ${unassignedProducts.length > 0 ? `
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-2.5">
          <span class="text-xl">⚠️</span>
          <div>
            <div class="text-xs font-bold text-amber-900">
              ${unassignedProducts.length} Product(s) with Unassigned Section
            </div>
            <div class="text-[11px] text-amber-700">
              These items specify ${rack.name || rack.id} but lack an exact section letter.
            </div>
          </div>
        </div>
        <button type="button" data-section-select="${UNASSIGNED_SECTION_CODE}"
          class="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition self-start sm:self-auto">
          Review Unassigned Items (${unassignedProducts.length})
        </button>
      </div>
    ` : ''}

    <!-- Sections Grid -->
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      ${activeSections.map(sec => {
        const secProds = rackData.sectionMap.get(sec.code) || [];
        const sCount = secProds.length;
        let sQty = 0;
        secProds.forEach(p => {
          const q = Number(p.stockQty);
          if (!isNaN(q) && q > 0) sQty += q;
        });
        const subCount = (sec.subSections || []).filter(sub => !sub.archived).length;

        return `
          <button type="button" data-section-select="${sec.code}"
            class="text-left p-3.5 rounded-xl border border-slate-200 hover:border-emerald-500 bg-white hover:bg-emerald-50/20 shadow-2xs transition group flex flex-col justify-between min-h-[110px]">
            <div>
              <div class="flex items-center justify-between">
                <span class="font-mono font-extrabold text-lg text-slate-900 group-hover:text-emerald-700">
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
              <span class="font-bold ${sQty > 0 ? 'text-emerald-700' : 'text-slate-400'}">Qty: ${sQty}</span>
            </div>
          </button>
        `;
      }).join('')}
    </div>
  `;

  // Bind back button
  container.querySelector('#btn-back-to-racks')?.addEventListener('click', () => {
    activeView = 'racks';
    selectedRackId = null;
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
  container.querySelector('#btn-add-section-to-rack')?.addEventListener('click', () => {
    import('./mapManager.js').then(m => m.promptAddSection('rack', rack.id));
  });
}

/**
 * ----------------------------------------------------------------------------
 * VIEW 3: SECTION PRODUCTS VIEW
 * ----------------------------------------------------------------------------
 */
function renderSectionProductsView(container) {
  const rack = currentRackConfigs.find(r => r.id === selectedRackId);
  if (!rack) {
    activeView = 'racks';
    renderCurrentView();
    return;
  }

  const isUnassigned = selectedSectionCode === UNASSIGNED_SECTION_CODE;
  const section = isUnassigned
    ? { code: 'Unassigned', displayName: 'Unassigned Location (Needs Review)', subSections: [] }
    : (rack.sections || []).find(s => s.code === selectedSectionCode) || { code: selectedSectionCode, displayName: '', subSections: [] };

  const rackData = rackProductIndex.get(rack.id) || { allProducts: [], sectionMap: new Map() };
  const products = rackData.sectionMap.get(selectedSectionCode) || [];

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
        <button type="button" id="btn-back-to-all-racks" class="hover:text-slate-900 font-bold text-emerald-700">
          All Racks
        </button>
        <span>/</span>
        <button type="button" id="btn-back-to-rack-sections" class="hover:text-slate-900 font-bold text-emerald-700 font-mono">
          ${rack.name || rack.id}
        </button>
        <span>/</span>
        <span class="font-mono font-bold text-slate-700">Section ${section.code}</span>
      </div>

      <!-- Section Title & Rename -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-xl font-extrabold text-slate-900 font-mono">
              ${rack.name || rack.id} — Section ${section.code}
            </h2>
            ${!isUnassigned ? `
              <button type="button" id="btn-rename-section"
                class="px-2 py-1 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition flex items-center gap-1">
                <span>✏️ Rename</span>
              </button>
            ` : ''}
          </div>

          <!-- Editable Display Name -->
          <div class="text-sm font-semibold text-emerald-700 mt-1">
            ${section.displayName ? escapeHtml(section.displayName) : '<span class="text-slate-400 font-normal italic">No display name assigned (e.g. "AIR FILTER DREAM YUGA")</span>'}
          </div>
        </div>

        ${!isUnassigned ? `
          <button type="button" id="btn-add-subsection"
            class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-2xs self-start sm:self-auto">
            <span>+ Add Sub-section</span>
          </button>
        ` : ''}
      </div>

      <!-- Sub-sections List if any -->
      ${activeSubSections.length > 0 ? `
        <div class="pt-3 pb-1 flex flex-wrap items-center gap-2 text-xs">
          <span class="text-slate-400 font-semibold text-[11px]">Sub-sections:</span>
          ${activeSubSections.map(sub => `
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 border border-slate-200 font-medium">
              <span class="font-bold font-mono text-emerald-800">${sub.code || sub.id}</span>
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
          <div class="text-base font-extrabold text-emerald-700 mt-0.5">${totalQuantity}</div>
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
        <span>Products in this Section (${totalProducts})</span>
      </div>

      ${totalProducts === 0 ? `
        <div class="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-xs">
          No products currently assigned to <b>${rack.name || rack.id} / Section ${section.code}</b> in Product Master.
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
                    <td class="px-3 py-2 text-center font-extrabold ${qty > 0 ? 'text-emerald-700' : 'text-slate-400'}">${qty}</td>
                    <td class="px-3 py-2 text-center text-slate-500">${escapeHtml(p.unit || 'Pcs.')}</td>
                    <td class="px-3 py-2 text-right font-mono font-bold">₹${p.rate ? Number(p.rate).toFixed(2) : '0.00'}</td>
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
                  <div class="font-mono font-extrabold text-xs ${qty > 0 ? 'text-emerald-700' : 'text-slate-400'} shrink-0">
                    Qty: ${qty}
                  </div>
                </div>

                <div class="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                  <span class="font-mono font-semibold text-slate-700">${escapeHtml(p.partNumber || '-')}</span>
                  <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">${escapeHtml(p.group || p.parentGroup || '-')}</span>
                  <span class="font-mono font-bold text-slate-900">₹${p.rate ? Number(p.rate).toFixed(2) : '0.00'}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;

  // Breadcrumb handlers
  container.querySelector('#btn-back-to-all-racks')?.addEventListener('click', () => {
    activeView = 'racks';
    selectedRackId = null;
    selectedSectionCode = null;
    renderCurrentView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  container.querySelector('#btn-back-to-rack-sections')?.addEventListener('click', () => {
    activeView = 'sections';
    selectedSectionCode = null;
    renderCurrentView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Rename section display name handler
  container.querySelector('#btn-rename-section')?.addEventListener('click', () => {
    promptRenameSectionDisplayName(rack, section.code);
  });

  // Add sub-section handler
  container.querySelector('#btn-add-subsection')?.addEventListener('click', () => {
    promptAddSubSection(rack, section.code);
  });

  // Sub-section rename & archive handlers
  container.querySelectorAll('[data-rename-sub]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const subId = btn.dataset.renameSub;
      promptRenameSubSection(rack, section.code, subId);
    });
  });

  container.querySelectorAll('[data-archive-sub]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const subId = btn.dataset.archiveSub;
      archiveSubSection(rack, section.code, subId);
    });
  });
}

/**
 * ----------------------------------------------------------------------------
 * SECTION & SUB-SECTION CRUD ACTIONS
 * ----------------------------------------------------------------------------
 */
async function promptRenameSectionDisplayName(rack, sectionCode) {
  const sec = (rack.sections || []).find(s => s.code === sectionCode);
  if (!sec) return;

  const current = sec.displayName || '';
  const newName = prompt(`Enter display name for ${rack.name || rack.id} Section ${sectionCode}:\n(e.g. "AIR FILTER DREAM YUGA")`, current);

  if (newName === null) return; // Cancelled
  sec.displayName = newName.trim();

  await saveRackConfig(rack);
  showToast(`Section ${sectionCode} updated to "${sec.displayName || 'No name'}"`, 'success');
  renderCurrentView();
}

async function promptAddSubSection(rack, sectionCode) {
  const sec = (rack.sections || []).find(s => s.code === sectionCode);
  if (!sec) return;

  if (!sec.subSections) sec.subSections = [];

  const existingCount = sec.subSections.length;
  const defaultCode = `${sectionCode}-${existingCount + 1}`;
  const code = prompt(`Enter Sub-section Code:\n(e.g. "${defaultCode}")`, defaultCode);
  if (!code) return;

  const displayName = prompt(`Enter Display Name for ${code} (optional):`, '');

  sec.subSections.push({
    id: `${rack.id}_${sectionCode}_${code.trim()}`,
    code: code.trim(),
    displayName: (displayName || '').trim(),
    archived: false,
    createdAt: Date.now()
  });

  await saveRackConfig(rack);
  showToast(`Sub-section ${code} added`, 'success');
  renderCurrentView();
}

async function promptRenameSubSection(rack, sectionCode, subId) {
  const sec = (rack.sections || []).find(s => s.code === sectionCode);
  if (!sec || !sec.subSections) return;
  const sub = sec.subSections.find(s => s.id === subId);
  if (!sub) return;

  const newName = prompt(`Enter new display name for Sub-section ${sub.code}:`, sub.displayName || '');
  if (newName === null) return;

  sub.displayName = newName.trim();
  await saveRackConfig(rack);
  showToast(`Sub-section ${sub.code} updated`, 'success');
  renderCurrentView();
}

async function archiveSubSection(rack, sectionCode, subId) {
  const sec = (rack.sections || []).find(s => s.code === sectionCode);
  if (!sec || !sec.subSections) return;
  const sub = sec.subSections.find(s => s.id === subId);
  if (!sub) return;

  if (!confirm(`Archive Sub-section ${sub.code}? It can be restored in Manage Maps.`)) return;

  sub.archived = true;
  await saveRackConfig(rack);
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
