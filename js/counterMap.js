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
import { showToast, renderOrderTable } from './ui.js';
import { addOrderItem } from './orderManager.js';
import { searchCounterMap } from './mapSearch.js';
import { calculateSectionOccupancy, calculateSubSectionOccupancy, printAllCountersReport } from './mapPrintService.js';

let activeView = 'counters'; // 'counters' | 'sections' | 'products'
let selectedCounterId = null;
let selectedSectionCode = null;
let selectedSubSectionFilter = null;
let counterDisplayMode = 'grid'; // 'grid' | 'list' (defaults to grid)

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
 * VIEW 1: ALL COUNTERS GRID & LIST (Dynamic Counter Map Reference)
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
              <span>📍 Counter Map</span>
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

        <!-- Controls: Print All & Grid/List View Toggle -->
        <div class="flex flex-wrap items-center gap-2.5 self-start md:self-center">
          <button type="button" id="btn-print-all-counters"
            class="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs transition cursor-pointer active:scale-95">
            <span>🖨</span>
            <span>Print All Counters</span>
          </button>

          <div class="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button type="button" id="counter-toggle-grid"
              class="px-3 py-1 rounded-md text-xs font-bold transition ${counterDisplayMode === 'grid' ? 'bg-white shadow-xs text-slate-900' : 'text-slate-500 hover:text-slate-900'}">
              ▦ Grid
            </button>
            <button type="button" id="counter-toggle-list"
              class="px-3 py-1 rounded-md text-xs font-bold transition ${counterDisplayMode === 'list' ? 'bg-white shadow-xs text-slate-900' : 'text-slate-500 hover:text-slate-900'}">
              ☰ List
            </button>
          </div>
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
            placeholder="Search by Counter (e.g. 1, C1) or Product (e.g. Part Number, Item, Group, MRP)..."
            class="w-full text-xs sm:text-sm pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none transition">
        </div>
      </div>
    </div>

    <!-- 8 Counters Responsive Scroll Container -->
    <div class="map-scroll-container">
      <div id="counters-content-container">
        <!-- Injected counter cards or list table -->
      </div>
    </div>
  `;

  const contentContainer = container.querySelector('#counters-content-container');
  let currentSearchQuery = '';

  const refreshDisplay = () => {
    if (currentSearchQuery) {
      const searchRes = searchCounterMap(counterIndex, currentProductMaster, currentSearchQuery);
      renderCounterSearchResults(contentContainer, searchRes);
    } else {
      renderCountersContent(contentContainer, counterList);
    }
  };

  // Initial render
  refreshDisplay();

  // Print All Counters Handler (always prints all 8 counters, independent of search or view mode)
  const printBtn = container.querySelector('#btn-print-all-counters');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      printAllCountersReport(counterIndex);
    });
  }

  // View toggle handlers
  const gridToggleBtn = container.querySelector('#counter-toggle-grid');
  const listToggleBtn = container.querySelector('#counter-toggle-list');

  if (gridToggleBtn && listToggleBtn) {
    gridToggleBtn.addEventListener('click', () => {
      if (counterDisplayMode === 'grid') return;
      counterDisplayMode = 'grid';
      gridToggleBtn.className = 'px-3 py-1 rounded-md text-xs font-bold transition bg-white shadow-xs text-slate-900';
      listToggleBtn.className = 'px-3 py-1 rounded-md text-xs font-bold transition text-slate-500 hover:text-slate-900';
      refreshDisplay();
    });

    listToggleBtn.addEventListener('click', () => {
      if (counterDisplayMode === 'list') return;
      counterDisplayMode = 'list';
      listToggleBtn.className = 'px-3 py-1 rounded-md text-xs font-bold transition bg-white shadow-xs text-slate-900';
      gridToggleBtn.className = 'px-3 py-1 rounded-md text-xs font-bold transition text-slate-500 hover:text-slate-900';
      refreshDisplay();
    });
  }

  // Search input handler supporting both Location and Product Master searches
  const filterInput = container.querySelector('#counter-list-filter-input');
  if (filterInput) {
    filterInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value.trim();
      const searchRes = searchCounterMap(counterIndex, currentProductMaster, currentSearchQuery);
      renderCounterSearchResults(contentContainer, searchRes);
    });
  }
}

function renderCountersContent(container, counters) {
  if (!container) return;

  if (counterDisplayMode === 'list') {
    container.className = 'w-full';
    renderCounterListView(container, counters);
  } else {
    container.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4';
    renderCounterCards(container, counters);
  }
}

function renderCounterSearchResults(container, searchRes) {
  if (!container) return;

  if (!searchRes || !searchRes.isSearching) {
    renderCountersContent(container, searchRes ? searchRes.matchedCounters : []);
    return;
  }

  if (searchRes.matchedCounters.length === 0) {
    container.className = 'w-full';
    container.innerHTML = `
      <div class="text-center py-12 bg-white rounded-xl border border-slate-200 text-slate-400 text-xs space-y-1">
        <div class="text-2xl">🔍</div>
        <div class="font-bold text-slate-700 text-sm">No counters or products found</div>
        <p>No counters or Product Master records match "<b>${escapeHtml(searchRes.query)}</b>".</p>
      </div>
    `;
    return;
  }

  // If search only matched counter numbers/names without product records
  if (searchRes.totalMatchedProducts === 0) {
    container.className = 'w-full space-y-4';
    container.innerHTML = `
      <div class="bg-sky-50 border border-sky-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-sky-900 font-medium">
        <div class="flex items-center gap-2">
          <span class="text-base">🔎</span>
          <span>Showing <b>${searchRes.matchedCounters.length}</b> matching counter(s) for "<b>${escapeHtml(searchRes.query)}</b>"</span>
        </div>
      </div>
      <div id="matched-counters-display"></div>
    `;
    const innerContainer = container.querySelector('#matched-counters-display');
    renderCountersContent(innerContainer, searchRes.matchedCounters);
    return;
  }

  container.className = 'w-full space-y-4';

  container.innerHTML = `
    <!-- Search Summary Banner -->
    <div class="bg-sky-50 border border-sky-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-sky-900 font-medium">
      <div class="flex items-center gap-2">
        <span class="text-base">🔎</span>
        <span>
          Found <b>${searchRes.totalMatchedProducts}</b> matching product(s) across <b>${searchRes.matchedCounters.length}</b> counter(s) for "<b>${escapeHtml(searchRes.query)}</b>"
        </span>
      </div>
    </div>

    <!-- Matched Counters List -->
    <div class="space-y-3">
      ${searchRes.matchedCounters.map(counter => {
        const matchingProds = counter.matchedProducts || [];
        const prodCount = matchingProds.length;
        const locations = counter.relevantLocations || [];
        const sections = counter.relevantSections || [];

        return `
          <div class="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <!-- Header -->
            <div class="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2.5">
                <button type="button" data-counter-select="${counter.id}"
                  class="font-mono font-extrabold text-base text-slate-900 hover:text-sky-700 underline flex items-center gap-1.5 transition">
                  <span>📍 ${escapeHtml(counter.name || counter.id)}</span>
                </button>
                <span class="text-xs px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-semibold">
                  ${prodCount} matching item${prodCount === 1 ? '' : 's'}
                </span>
                <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                  ${counter.sectionStart}-${counter.sectionEnd}
                </span>
              </div>

              <!-- Relevant Physical Locations / Sections -->
              <div class="flex flex-wrap items-center gap-1.5 text-xs">
                ${locations.length > 0 ? `
                  <span class="text-slate-500 font-semibold">Physical Location(s):</span>
                  ${locations.map(loc => `
                    <span class="font-mono font-bold px-2 py-0.5 bg-sky-100 text-sky-800 rounded border border-sky-200 text-xs">
                      ${escapeHtml(loc)}
                    </span>
                  `).join('')}
                ` : (sections.length > 0 ? `
                  <span class="text-slate-500 font-semibold">Section(s):</span>
                  ${sections.map(sec => `
                    <span class="font-mono font-bold px-2 py-0.5 bg-sky-100 text-sky-800 rounded border border-sky-200 text-xs">
                      Section ${escapeHtml(sec)}
                    </span>
                  `).join('')}
                ` : '')}

                <button type="button" data-counter-select="${counter.id}"
                  class="ml-2 text-xs font-bold text-sky-700 hover:text-sky-800 underline">
                  Inspect Counter →
                </button>
              </div>
            </div>

            <!-- Matching Products Table (Desktop) -->
            ${prodCount > 0 ? `
              <div class="hidden md:block overflow-x-auto">
                <table class="w-full text-left text-xs border-collapse">
                  <thead class="bg-slate-100/70 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th class="px-3 py-2 text-center w-10">#</th>
                      <th class="px-3 py-2 min-w-[220px]">Item Details</th>
                      <th class="px-3 py-2">Part Number</th>
                      <th class="px-3 py-2 text-center">Available Qty</th>
                      <th class="px-3 py-2 text-center">Unit</th>
                      <th class="px-3 py-2 text-right">MRP</th>
                      <th class="px-3 py-2 text-center">Group</th>
                      <th class="px-3 py-2 text-center">Counter Location</th>
                      <th class="px-3 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 text-slate-800">
                    ${matchingProds.map((p, idx) => {
                      const qty = getNumericStock(p.stockQty);
                      return `
                        <tr class="hover:bg-slate-50/80 transition">
                          <td class="px-3 py-2 text-center text-slate-400 font-mono">${idx + 1}</td>
                          <td class="px-3 py-2 font-bold text-slate-900">${escapeHtml(p.itemDetails || p.productName || '-')}</td>
                          <td class="px-3 py-2 font-mono text-slate-600 font-semibold">${escapeHtml(p.partNumber || '-')}</td>
                          <td class="px-3 py-2 text-center font-extrabold ${qty > 0 ? 'text-sky-700' : 'text-slate-400'}">${p.stockQty !== null && p.stockQty !== undefined ? p.stockQty : '0'}</td>
                          <td class="px-3 py-2 text-center text-slate-500">${escapeHtml(p.unit || 'Pcs.')}</td>
                          <td class="px-3 py-2 text-right font-mono font-bold">₹${p.rate ? Number(p.rate).toFixed(2) : (p.mrp ? Number(p.mrp).toFixed(2) : '0.00')}</td>
                          <td class="px-3 py-2 text-center"><span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">${escapeHtml(p.group || p.parentGroup || '-')}</span></td>
                          <td class="px-3 py-2 text-center font-mono font-bold text-slate-800"><span class="px-2 py-0.5 rounded bg-sky-100/70 text-sky-900 border border-sky-200">${escapeHtml(p.rack || '-')}</span></td>
                          <td class="px-3 py-2 text-center">
                            <button type="button" data-add-to-order="${escapeHtml(p.id || p.partNumber)}"
                              class="px-2.5 py-1 bg-slate-900 hover:bg-sky-600 text-white rounded text-[11px] font-bold transition">
                              + Add to Order
                            </button>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>

              <!-- Mobile Cards -->
              <div class="md:hidden p-3 space-y-2.5">
                ${matchingProds.map(p => {
                  const qty = getNumericStock(p.stockQty);
                  return `
                    <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-1.5">
                      <div class="font-bold text-slate-900">${escapeHtml(p.itemDetails || p.productName || '-')}</div>
                      <div class="grid grid-cols-2 gap-1.5 text-[11px] text-slate-600 pt-1 border-t border-slate-200/60">
                        <div>Part: <b class="font-mono text-slate-800">${escapeHtml(p.partNumber || '-')}</b></div>
                        <div>Qty: <b class="${qty > 0 ? 'text-sky-700' : 'text-slate-500'}">${p.stockQty !== null && p.stockQty !== undefined ? p.stockQty : '0'}</b> ${escapeHtml(p.unit || 'Pcs.')}</div>
                        <div>MRP: <b class="text-slate-800">₹${p.rate ? Number(p.rate).toFixed(2) : (p.mrp ? Number(p.mrp).toFixed(2) : '0.00')}</b></div>
                        <div>Loc: <b class="text-sky-800 font-mono">${escapeHtml(p.rack || '-')}</b></div>
                        <div class="col-span-2">Group: <b class="text-slate-700">${escapeHtml(p.group || p.parentGroup || '-')}</b></div>
                      </div>
                      <div class="pt-1 flex justify-end">
                        <button type="button" data-add-to-order="${escapeHtml(p.id || p.partNumber)}"
                          class="px-3 py-1 bg-slate-900 hover:bg-sky-600 text-white rounded text-[11px] font-bold transition">
                          + Add to Order
                        </button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : `
              <div class="p-3 text-center text-slate-400 text-xs">
                No products in this counter match the search query.
              </div>
            `}
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Bind drilldown buttons
  container.querySelectorAll('[data-counter-select]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCounterId = btn.dataset.counterSelect;
      activeView = 'sections';
      renderCurrentView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Bind "+ Add to Order" buttons
  container.querySelectorAll('[data-add-to-order]').forEach(btn => {
    btn.addEventListener('click', () => {
      const prodKey = btn.dataset.addToOrder;
      const product = currentProductMaster.find(p => p.id === prodKey || p.partNumber === prodKey);
      if (product) {
        const item = addOrderItem(product.itemDetails || product.productName, 1);
        item.matchedProduct = product;
        item.isManual = true;
        item.confidence = 100;
        item.tier = 'HIGH';
        renderOrderTable();
        showToast(`Added "${product.productName || product.partNumber}" to order`, 'success');
      }
    });
  });
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

    const occupancy = calculateSectionOccupancy(counter.sectionMap);

    return `
      <button type="button" data-counter-select="${counter.id}"
        class="counter-card text-left p-4 rounded-xl border border-slate-200 hover:border-sky-500 bg-white hover:bg-sky-50/20 shadow-2xs transition group flex flex-col justify-between min-h-[145px]">
        <div>
          <!-- Counter Title & Section Range -->
          <div class="flex items-center justify-between">
            <span class="font-extrabold text-base text-slate-900 group-hover:text-sky-700">
              ${counter.name || counter.id}
            </span>
            <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-mono">
              ${counter.sectionStart} to ${counter.sectionEnd}
            </span>
          </div>

          <!-- Total Configured Sections -->
          <div class="text-xs text-slate-500 mt-1 font-medium">
            ${occupancy.totalSections} sections
          </div>

          <!-- Dynamic Filled / Empty Status -->
          <div class="mt-2.5 space-y-1 text-[11px] font-mono leading-tight">
            <div class="flex items-baseline gap-1.5 text-sky-900">
              <span class="font-bold text-[10px] uppercase px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 shrink-0">Filled: ${occupancy.filledCount}</span>
              <span class="truncate font-semibold text-slate-700 tracking-wide">${occupancy.filledText || '—'}</span>
            </div>
            <div class="flex items-baseline gap-1.5 text-slate-500">
              <span class="font-bold text-[10px] uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">Empty: ${occupancy.emptyCount}</span>
              <span class="truncate font-semibold text-slate-400 tracking-wide">${occupancy.emptyText || '—'}</span>
            </div>
          </div>
        </div>

        <!-- Items & Available Qty -->
        <div class="pt-3 mt-2 border-t border-slate-100 flex items-center justify-between text-xs">
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
 * Render Counter List View Table (compact table format)
 * Columns: Counter | Sections | Filled | Empty | Items | Qty
 */
function renderCounterListView(container, counters) {
  if (!container) return;

  if (counters.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 bg-white rounded-xl border border-slate-200 text-slate-400 text-xs">
        No counters match your search.
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="responsive-table-view bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
      <div class="table-scroll-container">
        <table class="w-full text-left text-xs border-collapse map-view-table">
          <thead class="sticky top-0 bg-slate-100 text-slate-700 font-bold border-b border-slate-200 shadow-2xs z-10">
            <tr>
              <th class="px-3.5 py-2.5 bg-slate-100 font-mono">Counter</th>
              <th class="px-3 py-2.5 text-center bg-slate-100 font-mono">Sections</th>
              <th class="px-3.5 py-2.5 bg-slate-100">Filled</th>
              <th class="px-3.5 py-2.5 bg-slate-100">Empty</th>
              <th class="px-3.5 py-2.5 text-center bg-slate-100">Items</th>
              <th class="px-3.5 py-2.5 text-center bg-slate-100">Qty</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 text-slate-800">
            ${counters.map(counter => {
              const occupancy = calculateSectionOccupancy(counter.sectionMap);
              const prodCount = counter.allProducts.length;
              let qtySum = 0;
              counter.allProducts.forEach(p => { qtySum += getNumericStock(p.stockQty); });

              return `
                <tr data-counter-select="${counter.id}" class="hover:bg-sky-50/40 cursor-pointer transition">
                  <td class="px-3.5 py-2.5 font-bold text-slate-900 text-sm">
                    ${counter.name || counter.id}
                  </td>
                  <td class="px-3 py-2.5 text-center font-mono text-slate-600 font-semibold">
                    <span class="px-2 py-0.5 rounded bg-slate-100 border border-slate-200">${counter.sectionStart}-${counter.sectionEnd}</span>
                  </td>
                  <td class="px-3.5 py-2.5 font-mono">
                    <span class="font-bold text-sky-800 bg-sky-100 px-1.5 py-0.5 rounded text-[11px] mr-1.5">${occupancy.filledCount}</span>
                    <span class="text-slate-800 font-semibold tracking-wide">${occupancy.filledText || '—'}</span>
                  </td>
                  <td class="px-3.5 py-2.5 font-mono">
                    <span class="font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded text-[11px] mr-1.5">${occupancy.emptyCount}</span>
                    <span class="text-slate-400 font-medium tracking-wide">${occupancy.emptyText || '—'}</span>
                  </td>
                  <td class="px-3.5 py-2.5 text-center font-semibold text-slate-700">
                    ${prodCount}
                  </td>
                  <td class="px-3.5 py-2.5 text-center font-extrabold ${qtySum > 0 ? 'text-sky-700' : 'text-slate-400'}">
                    ${qtySum}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Bind click event on table rows
  container.querySelectorAll('[data-counter-select]').forEach(row => {
    row.addEventListener('click', () => {
      selectedCounterId = row.dataset.counterSelect;
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
          const sHasStock = secProds.some(p => getNumericStock(p.allocatedQty) > 0);

          return `
            <button type="button" data-section-select="${sec.code}"
              class="text-left p-3.5 rounded-xl border border-slate-200 hover:border-sky-500 bg-white hover:bg-sky-50/20 shadow-2xs transition group flex flex-col justify-between min-h-[110px]">
              <div>
                <div class="flex items-center justify-between">
                  <span class="font-mono font-extrabold text-lg text-slate-900 group-hover:text-sky-700">
                    Section ${sec.code}
                  </span>
                  <div class="flex items-center gap-1">
                    <span class="text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${sHasStock ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-500'}">
                      ${sHasStock ? 'Filled' : 'Empty'}
                    </span>
                    ${subSecCount > 0 ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-mono">${subSecCount} sub</span>` : ''}
                  </div>
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

  const subOcc = calculateSubSectionOccupancy(secData);

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

      <!-- Sub-section Occupancy Banner (if sub-sections exist) -->
      ${subOcc ? `
        <div class="mt-3.5 p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
          <div class="font-bold text-slate-800 mb-1.5 flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <span>📊 Sub-section Occupancy</span>
            </span>
            <span class="text-[11px] text-slate-500 font-normal">Total: ${subOcc.totalSubSections} sub-section(s)</span>
          </div>
          <div class="flex flex-wrap gap-4 font-mono text-xs">
            <div class="flex items-baseline gap-1.5 text-sky-900">
              <span class="font-bold text-[10px] uppercase px-2 py-0.5 rounded bg-sky-100 text-sky-800 shrink-0">Filled: ${subOcc.filledCount}</span>
              <span class="font-semibold text-slate-800">${subOcc.filledText || 'None'}</span>
            </div>
            <div class="flex items-baseline gap-1.5 text-slate-600">
              <span class="font-bold text-[10px] uppercase px-2 py-0.5 rounded bg-slate-200 text-slate-700 shrink-0">Empty: ${subOcc.emptyCount}</span>
              <span class="font-medium text-slate-500">${subOcc.emptyText || 'None'}</span>
            </div>
          </div>
        </div>
      ` : ''}

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
