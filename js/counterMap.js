/**
 * Counter Map Module Controller
 * Maharashtra Automobile — Front Counter Workflow & Physical Stations
 *
 * 100% AUTOMATIC and derived purely from the existing Product Master (product.rack).
 * Read-only reference layer with ZERO manual CRUD configuration.
 * Single Source of Truth: Product Master in IndexedDB.
 *
 * Predefined 8 Initial Counters:
 *  Counter 1: A to X (24 sections)
 *  Counter 2: A to P (16 sections)
 *  Counter 3: A to P (16 sections)
 *  Counter 4: A to T (20 sections)
 *  Counter 5: A to L (12 sections)
 *  Counter 6: A to X (24 sections)
 *  Counter 7: A to B (2 sections)
 *  Counter 8: A to T (20 sections)
 */

import { getAllProducts } from './db.js';
import { INITIAL_COUNTERS_SPEC, generateSections } from './mapConfigData.js';
import { parseProductCounter, UNASSIGNED_SECTION_CODE, distributeQuantityAcrossSections } from './rackParser.js';
import { showToast } from './ui.js';

let activeView = 'counters'; // 'counters' | 'sections' | 'products'
let selectedCounterId = null;
let selectedSectionCode = null;
let selectedSubSectionFilter = null;

// In-memory runtime data derived dynamically on load
let currentProductMaster = [];
let counterIndex = new Map(); // counterId -> CounterData

/**
 * Main entry point called when Counter Map tab is opened
 */
export async function loadCounterMap() {
  const container = document.getElementById('tab-counter-map');
  if (!container) return;

  try {
    // 1. Fetch live products from IndexedDB (Product Master - Single Source of Truth)
    currentProductMaster = (await getAllProducts()) || [];

    // 2. Build 100% automatic dynamic index directly from Product Master
    buildAutomaticCounterIndex();

    // 3. Render active view
    renderCurrentView();
  } catch (err) {
    console.error('Failed to load Counter Map:', err);
    showToast('Error loading Counter Map: ' + err.message, 'error');
  }
}

/**
 * Build 100% automatic Counter, Section, and Sub-section index from Product Master
 */
function buildAutomaticCounterIndex() {
  counterIndex.clear();

  // 1. Seed index with the 8 standard predefined active counters (C1–C8)
  INITIAL_COUNTERS_SPEC.forEach(spec => {
    const counterId = `C${spec.num}`;
    const predefinedSecCodes = generateSections(spec.range[0], spec.range[1]).map(s => s.code);

    counterIndex.set(counterId, {
      id: counterId,
      counterNum: spec.num,
      name: `Counter ${spec.num}`,
      sectionStart: spec.range[0],
      sectionEnd: spec.range[1],
      isDynamic: false,
      allProducts: [],
      sectionMap: new Map() // code -> SectionData
    });

    const cData = counterIndex.get(counterId);
    predefinedSecCodes.forEach(code => {
      cData.sectionMap.set(code, {
        code,
        products: [],
        subSectionMap: new Map()
      });
    });
  });

  // 2. Distribute products from Product Master into Counters, Sections, and Sub-sections
  currentProductMaster.forEach(product => {
    if (!product.rack || !String(product.rack).trim()) {
      return;
    }

    const parsed = parseProductCounter(product.rack);
    if (!parsed) {
      return;
    }

    const counterId = parsed.counterId;

    // If counter is dynamic, create dynamic entry
    if (!counterIndex.has(counterId)) {
      counterIndex.set(counterId, {
        id: counterId,
        counterNum: parsed.counterNum,
        name: `Counter ${parsed.counterNum}`,
        sectionStart: parsed.sections[0] || 'A',
        sectionEnd: parsed.sections[parsed.sections.length - 1] || 'Z',
        isDynamic: true,
        allProducts: [],
        sectionMap: new Map()
      });
    }

    const counterData = counterIndex.get(counterId);
    counterData.allProducts.push(product);

    if (!parsed.hasRecognizableSection) {
      // Unassigned section within counter station
      const totalStock = getNumericStock(product.stockQty);
      const unassignedSecCode = UNASSIGNED_SECTION_CODE;

      if (!counterData.sectionMap.has(unassignedSecCode)) {
        counterData.sectionMap.set(unassignedSecCode, {
          code: 'Unassigned',
          products: [],
          subSectionMap: new Map()
        });
      }
      counterData.sectionMap.get(unassignedSecCode).products.push({
        ...product,
        allocatedQty: totalStock,
        subSection: null,
        isDistributed: false
      });
      return;
    }

    const totalStock = getNumericStock(product.stockQty);
    const locations = parsed.locations || [];
    const numLocations = locations.length;

    if (numLocations > 1) {
      const distributedQtys = distributeQuantityAcrossSections(totalStock, numLocations);

      locations.forEach((loc, idx) => {
        const secCode = loc.section;
        const subCode = loc.subSection || null;
        const allocatedQty = distributedQtys[idx];

        if (!counterData.sectionMap.has(secCode)) {
          counterData.sectionMap.set(secCode, {
            code: secCode,
            products: [],
            subSectionMap: new Map()
          });
        }

        const secData = counterData.sectionMap.get(secCode);
        const itemRecord = {
          ...product,
          allocatedQty,
          subSection: subCode,
          isDistributed: true,
          distributionInfo: {
            totalQty: totalStock,
            allLocations: locations.map(l => l.label || l.section),
            currentLocation: loc.label || loc.section,
            allQuantities: distributedQtys
          }
        };

        secData.products.push(itemRecord);

        if (subCode) {
          if (!secData.subSectionMap.has(subCode)) {
            secData.subSectionMap.set(subCode, {
              code: subCode,
              products: []
            });
          }
          secData.subSectionMap.get(subCode).products.push(itemRecord);
        }
      });
    } else {
      const loc = locations[0] || { section: parsed.sections[0], subSection: null };
      const secCode = loc.section;
      const subCode = loc.subSection || null;

      if (!counterData.sectionMap.has(secCode)) {
        counterData.sectionMap.set(secCode, {
          code: secCode,
          products: [],
          subSectionMap: new Map()
        });
      }

      const secData = counterData.sectionMap.get(secCode);
      const itemRecord = {
        ...product,
        allocatedQty: totalStock,
        subSection: subCode,
        isDistributed: false
      };

      secData.products.push(itemRecord);

      if (subCode) {
        if (!secData.subSectionMap.has(subCode)) {
          secData.subSectionMap.set(subCode, {
            code: subCode,
            products: []
          });
        }
        secData.subSectionMap.get(subCode).products.push(itemRecord);
      }
    }
  });
}

function getNumericStock(val) {
  if (val === null || val === undefined || val === '') return 0;
  const num = Number(val);
  return isNaN(num) ? 0 : num;
}

/**
 * Route rendering based on active view state
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
    selectedSubSectionFilter = null;
    renderAllCountersView(container);
  }
}

/**
 * ----------------------------------------------------------------------------
 * VIEW 1: ALL COUNTERS GRID (Dynamic Counter Map Reference)
 * ----------------------------------------------------------------------------
 */
function renderAllCountersView(container) {
  let totalMappedProducts = 0;
  let totalMappedQuantity = 0;

  const counterList = Array.from(counterIndex.values()).sort((a, b) => a.counterNum - b.counterNum);

  counterList.forEach(counter => {
    totalMappedProducts += counter.allProducts.length;
    counter.allProducts.forEach(p => {
      totalMappedQuantity += getNumericStock(p.stockQty);
    });
  });

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
              ${counterList.length} Counters
            </span>
            <span class="text-[11px] font-semibold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded">
              Automatic Live Map
            </span>
          </div>
          <p class="text-xs text-slate-500 mt-1">
            Physical front-desk counter stations, dispatch trays, and customer pickup bins.
          </p>
        </div>
      </div>

      <!-- Quick Metrics Bar -->
      <div class="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
          <div class="text-slate-500 font-medium">Active Counters</div>
          <div class="text-base font-extrabold text-slate-900 mt-0.5">${counterList.length}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
          <div class="text-slate-500 font-medium">Mapped Products</div>
          <div class="text-base font-extrabold text-sky-700 mt-0.5">${totalMappedProducts.toLocaleString()}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80 col-span-2 sm:col-span-1">
          <div class="text-slate-500 font-medium">Total Available Qty</div>
          <div class="text-base font-extrabold text-sky-700 mt-0.5">${totalMappedQuantity.toLocaleString()}</div>
        </div>
      </div>

      <!-- Quick Counter Filter / Search -->
      <div class="mt-4">
        <div class="relative">
          <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-sm">
            🔎
          </span>
          <input type="text" id="counter-list-filter-input"
            placeholder="Filter by Counter number (e.g. 1, 5, C2)..."
            class="w-full text-xs sm:text-sm pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none transition">
        </div>
      </div>
    </div>

    <!-- 8 Counters Responsive Scroll Container -->
    <div class="map-scroll-container">
      <div id="counters-grid-container" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <!-- Injected counter cards -->
      </div>
    </div>
  `;

  const gridContainer = container.querySelector('#counters-grid-container');
  renderCounterCards(gridContainer, counterList);

  const filterInput = container.querySelector('#counter-list-filter-input');
  if (filterInput) {
    filterInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const filtered = counterList.filter(c => {
        if (!q) return true;
        const cIdClean = c.id.toUpperCase();
        const cNum = String(c.counterNum);
        return cIdClean.includes(q) || cNum.includes(q) || c.name.toUpperCase().includes(q);
      });
      renderCounterCards(gridContainer, filtered);
    });
  }
}

function renderCounterCards(container, counters) {
  if (!container) return;

  if (counters.length === 0) {
    container.innerHTML = `
      <div class="col-span-full text-center py-10 bg-white rounded-xl border border-slate-200 text-slate-400 text-xs">
        No counters match your search.
      </div>
    `;
    return;
  }

  container.innerHTML = counters.map(counter => {
    const prodCount = counter.allProducts.length;
    let qtySum = 0;
    counter.allProducts.forEach(p => {
      qtySum += getNumericStock(p.stockQty);
    });
    const sectionCount = counter.sectionMap.size;

    return `
      <button type="button" data-counter-select="${counter.id}"
        class="counter-card text-left p-4 rounded-xl border border-slate-200 hover:border-sky-500 bg-white hover:bg-sky-50/20 shadow-2xs transition group flex flex-col justify-between min-h-[130px]">
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
            ${sectionCount} sections
          </div>
        </div>

        <div class="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          <span class="text-slate-500 font-medium"><b>${prodCount}</b> items</span>
          <span class="font-bold ${qtySum > 0 ? 'text-sky-700' : 'text-slate-400'}">Qty: ${qtySum}</span>
        </div>
      </button>
    `;
  }).join('');

  container.querySelectorAll('[data-counter-select]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCounterId = btn.dataset.counterSelect;
      activeView = 'sections';
      renderCurrentView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

/**
 * ----------------------------------------------------------------------------
 * VIEW 2: COUNTER SECTIONS VIEW
 * ----------------------------------------------------------------------------
 */
function renderCounterSectionsView(container) {
  const counter = counterIndex.get(selectedCounterId);
  if (!counter) {
    activeView = 'counters';
    renderCurrentView();
    return;
  }

  const prodCount = counter.allProducts.length;
  let qtySum = 0;
  counter.allProducts.forEach(p => {
    qtySum += getNumericStock(p.stockQty);
  });

  const sectionsList = Array.from(counter.sectionMap.values()).sort((a, b) => a.code.localeCompare(b.code));

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
            Select a section to view products stored at this counter station.
          </p>
        </div>
      </div>

      <!-- Dynamic Totals Banner -->
      <div class="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
          <div class="text-slate-500 font-medium">Sections Detected</div>
          <div class="text-base font-extrabold text-slate-900 mt-0.5">${sectionsList.length}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
          <div class="text-slate-500 font-medium">Mapped Products</div>
          <div class="text-base font-extrabold text-sky-700 mt-0.5">${prodCount}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80 col-span-2 sm:col-span-1">
          <div class="text-slate-500 font-medium">Total Quantity</div>
          <div class="text-base font-extrabold text-sky-700 mt-0.5">${qtySum}</div>
        </div>
      </div>
    </div>

    <!-- Sections Responsive Scroll Container -->
    <div class="map-scroll-container">
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        ${sectionsList.map(sec => {
          const secProds = sec.products || [];
          const sCount = secProds.length;
          let sQty = 0;
          secProds.forEach(p => {
            sQty += getNumericStock(p.allocatedQty);
          });
          const subSecCount = sec.subSectionMap.size;

          return `
            <button type="button" data-section-select="${sec.code}"
              class="text-left p-3.5 rounded-xl border border-slate-200 hover:border-sky-500 bg-white hover:bg-sky-50/20 shadow-2xs transition group flex flex-col justify-between min-h-[110px]">
              <div>
                <div class="flex items-center justify-between">
                  <span class="font-mono font-extrabold text-lg text-slate-900 group-hover:text-sky-700">
                    Section ${sec.code}
                  </span>
                  ${subSecCount > 0 ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">${subSecCount} sub</span>` : ''}
                </div>
                <div class="text-[11px] text-slate-500 mt-1">
                  ${subSecCount > 0 ? `${subSecCount} sub-section(s)` : 'Direct tray'}
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
    </div>
  `;

  // Bind back button
  container.querySelector('#btn-back-to-counters')?.addEventListener('click', () => {
    activeView = 'counters';
    selectedCounterId = null;
    selectedSectionCode = null;
    selectedSubSectionFilter = null;
    renderCurrentView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Bind section click
  container.querySelectorAll('[data-section-select]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedSectionCode = btn.dataset.sectionSelect;
      selectedSubSectionFilter = null;
      activeView = 'products';
      renderCurrentView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

/**
 * ----------------------------------------------------------------------------
 * VIEW 3: COUNTER SECTION & SUB-SECTIONS PRODUCTS VIEW
 * ----------------------------------------------------------------------------
 */
function renderSectionProductsView(container) {
  const counter = counterIndex.get(selectedCounterId);
  if (!counter) {
    activeView = 'counters';
    renderCurrentView();
    return;
  }

  const secData = counter.sectionMap.get(selectedSectionCode) || {
    code: selectedSectionCode,
    products: [],
    subSectionMap: new Map()
  };

  const allSectionProducts = secData.products || [];
  const subSectionEntries = Array.from(secData.subSectionMap.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));

  const displayedProducts = selectedSubSectionFilter
    ? allSectionProducts.filter(p => p.subSection === selectedSubSectionFilter)
    : allSectionProducts;

  const totalProducts = allSectionProducts.length;
  let totalQuantity = 0;
  allSectionProducts.forEach(p => {
    totalQuantity += getNumericStock(p.allocatedQty);
  });

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
        <span class="font-mono font-bold text-slate-700">Section ${secData.code}</span>
      </div>

      <!-- Section Title -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-xl font-extrabold text-slate-900">
              ${counter.name || counter.id} — Section ${secData.code}
            </h2>
          </div>
          <div class="text-xs text-slate-500 mt-1">
            Dynamic stock reference derived directly from Product Master.
          </div>
        </div>
      </div>

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
          <div class="text-slate-500 font-medium">Sub-sections Detected</div>
          <div class="text-base font-extrabold text-slate-900 mt-0.5">${subSectionEntries.length}</div>
        </div>
      </div>

      <!-- Sub-sections Filter Pills (if sub-sections exist) -->
      ${subSectionEntries.length > 0 ? `
        <div class="mt-4 pt-3 border-t border-slate-100">
          <div class="text-[11px] font-bold text-slate-600 mb-2">Filter by Sub-section:</div>
          <div class="flex flex-wrap gap-1.5">
            <button type="button" data-sub-filter=""
              class="px-2.5 py-1 rounded-lg text-xs font-bold transition ${selectedSubSectionFilter === null ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">
              All (${totalProducts} items • Qty: ${totalQuantity})
            </button>
            ${subSectionEntries.map(([subCode, subInfo]) => {
              const subProds = subInfo.products || [];
              let subQty = 0;
              subProds.forEach(p => { subQty += getNumericStock(p.allocatedQty); });
              const isSelected = selectedSubSectionFilter === subCode;

              return `
                <button type="button" data-sub-filter="${escapeHtml(subCode)}"
                  class="px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${isSelected ? 'bg-sky-700 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">
                  <span>Sub-section ${escapeHtml(subCode)}</span>
                  <span class="text-[10px] opacity-80">(${subProds.length} • Qty: ${subQty})</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}
    </div>

    <!-- Products List (Desktop Table & Mobile Cards) -->
    <div class="space-y-3">
      <div class="flex items-center justify-between text-xs font-bold text-slate-700 px-1">
        <span>
          Products in this Counter Location (${displayedProducts.length}${selectedSubSectionFilter ? ` in Sub-section ${selectedSubSectionFilter}` : ''})
        </span>
      </div>

      ${displayedProducts.length === 0 ? `
        <div class="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-xs">
          No products currently located at <b>${counter.name || counter.id} / Section ${secData.code}</b>.
        </div>
      ` : `
        <!-- Desktop Table View with Sticky Header & Scroll -->
        <div class="responsive-table-view bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div class="table-scroll-container">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="sticky top-0 bg-slate-100 text-slate-700 font-bold border-b border-slate-200 shadow-2xs z-10">
                <tr>
                  <th class="px-3 py-2.5 w-12 text-center bg-slate-100">#</th>
                  <th class="px-3 py-2.5 min-w-[240px] bg-slate-100">Product Name / Item Details</th>
                  <th class="px-3 py-2.5 bg-slate-100">Part Number</th>
                  <th class="px-3 py-2.5 bg-slate-100">Group</th>
                  <th class="px-3 py-2.5 text-center bg-slate-100">Sub-section</th>
                  <th class="px-3 py-2.5 text-center bg-slate-100">Available Qty</th>
                  <th class="px-3 py-2.5 text-center bg-slate-100">Unit</th>
                  <th class="px-3 py-2.5 text-right bg-slate-100">MRP</th>
                  <th class="px-3 py-2.5 text-center bg-slate-100">Counter Field</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 text-slate-800">
                ${displayedProducts.map((p, idx) => {
                  const qty = getNumericStock(p.allocatedQty);
                  return `
                    <tr class="hover:bg-slate-50/80 transition">
                      <td class="px-3 py-2 text-center text-slate-400 font-mono">${idx + 1}</td>
                      <td class="px-3 py-2 font-bold text-slate-900">
                        <div>${escapeHtml(p.productName || p.itemDetails || '-')}</div>
                        ${p.isDistributed ? `
                          <div class="text-[10px] font-normal text-sky-700 bg-sky-50 inline-block px-1.5 py-0.5 rounded border border-sky-200 mt-0.5">
                            Distributed: ${qty} of ${p.distributionInfo.totalQty} across ${p.distributionInfo.allLocations.join(', ')}
                          </div>
                        ` : ''}
                      </td>
                      <td class="px-3 py-2 font-mono text-slate-600 font-semibold">${escapeHtml(p.partNumber || '-')}</td>
                      <td class="px-3 py-2"><span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">${escapeHtml(p.group || p.parentGroup || '-')}</span></td>
                      <td class="px-3 py-2 text-center font-mono">
                        ${p.subSection ? `<span class="px-2 py-0.5 rounded bg-sky-100 text-sky-800 font-bold">Sub ${escapeHtml(p.subSection)}</span>` : '<span class="text-slate-400">-</span>'}
                      </td>
                      <td class="px-3 py-2 text-center font-extrabold ${qty > 0 ? 'text-sky-700' : 'text-slate-400'}">
                        ${qty}
                      </td>
                      <td class="px-3 py-2 text-center text-slate-500">${escapeHtml(p.unit || 'Pcs.')}</td>
                      <td class="px-3 py-2 text-right font-mono font-bold">₹${p.rate ? Number(p.rate).toFixed(2) : '0.00'}</td>
                      <td class="px-3 py-2 text-center font-mono text-slate-500">${escapeHtml(p.rack || '-')}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Mobile Cards View with Scroll -->
        <div class="responsive-card-view map-scroll-container p-1 space-y-2.5">
          ${displayedProducts.map(p => {
            const qty = getNumericStock(p.allocatedQty);
            return `
              <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-2">
                <div class="flex items-start justify-between gap-2">
                  <div class="font-bold text-xs text-slate-900 leading-tight">
                    ${escapeHtml(p.productName || p.itemDetails || '-')}
                    ${p.isDistributed ? `
                      <div class="text-[10px] font-normal text-sky-700 bg-sky-50 inline-block px-1.5 py-0.5 rounded border border-sky-200 mt-1">
                        Distributed: ${qty} of ${p.distributionInfo.totalQty} across ${p.distributionInfo.allLocations.join(', ')}
                      </div>
                    ` : ''}
                  </div>
                  <div class="font-mono font-extrabold text-xs ${qty > 0 ? 'text-sky-700' : 'text-slate-400'} shrink-0 text-right">
                    Qty: ${qty}
                  </div>
                </div>

                <div class="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                  <span class="font-mono font-semibold text-slate-700">${escapeHtml(p.partNumber || '-')}</span>
                  ${p.subSection ? `<span class="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-bold font-mono">Sub ${escapeHtml(p.subSection)}</span>` : ''}
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
  container.querySelector('#btn-back-to-all-counters')?.addEventListener('click', () => {
    activeView = 'counters';
    selectedCounterId = null;
    selectedSectionCode = null;
    selectedSubSectionFilter = null;
    renderCurrentView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  container.querySelector('#btn-back-to-counter-sections')?.addEventListener('click', () => {
    activeView = 'sections';
    selectedSectionCode = null;
    selectedSubSectionFilter = null;
    renderCurrentView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Sub-section filter pills handlers
  container.querySelectorAll('[data-sub-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const filterVal = btn.dataset.subFilter;
      selectedSubSectionFilter = filterVal || null;
      renderCurrentView();
    });
  });
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
