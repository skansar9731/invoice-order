/**
 * Rack Map Module Controller
 * Maharashtra Automobile — Physical Storage Floor Reference Layer
 *
 * 100% AUTOMATIC and derived purely from the existing Product Master (product.rack).
 * Read-only reference layer with ZERO manual CRUD configuration.
 * Single Source of Truth: Product Master in IndexedDB.
 *
 * Hierarchy:
 *  Rack (e.g. R60, R15) → Section (e.g. A, B, C) → Sub-section (e.g. 1, 2, 7) → Products
 */

import { getAllProducts } from './db.js';
import { INITIAL_RACKS_SPEC, generateSections } from './mapConfigData.js';
import { parseProductRack, UNASSIGNED_SECTION_CODE, distributeQuantityAcrossSections } from './rackParser.js';
import { showToast, renderOrderTable } from './ui.js';
import { addOrderItem } from './orderManager.js';
import { searchRackMap } from './mapSearch.js';

let activeView = 'racks'; // 'racks' | 'sections' | 'products'
let selectedRackId = null;
let selectedSectionCode = null;
let selectedSubSectionFilter = null; // null for All, or specific sub-section code

// In-memory runtime data derived dynamically on load
let currentProductMaster = [];
let rackIndex = new Map(); // rackId -> RackData

/**
 * Main entry point called when Rack Map tab is opened
 */
export async function loadRackMap() {
  const container = document.getElementById('tab-rack-map');
  if (!container) return;

  try {
    // 1. Fetch live products from IndexedDB (Product Master - Single Source of Truth)
    currentProductMaster = (await getAllProducts()) || [];

    // 2. Build 100% automatic dynamic index directly from Product Master
    buildAutomaticRackIndex();

    // 3. Render active view
    renderCurrentView();
  } catch (err) {
    console.error('Failed to load Rack Map:', err);
    showToast('Error loading Rack Map: ' + err.message, 'error');
  }
}

/**
 * Build 100% automatic Rack, Section, and Sub-section index from Product Master
 */
function buildAutomaticRackIndex() {
  rackIndex.clear();

  // 1. Seed index with the 71 standard predefined active racks (R1–R73 excluding R12 and R64)
  INITIAL_RACKS_SPEC.forEach(spec => {
    const rackId = `R${spec.num}`;
    const predefinedSecCodes = generateSections(spec.range[0], spec.range[1]).map(s => s.code);

    rackIndex.set(rackId, {
      id: rackId,
      rackNum: spec.num,
      name: `Rack ${spec.num}`,
      sectionStart: spec.range[0],
      sectionEnd: spec.range[1],
      isDynamic: false,
      allProducts: [],
      sectionMap: new Map(), // code -> SectionData
      unassignedSectionProducts: []
    });

    // Pre-populate predefined sections
    const rData = rackIndex.get(rackId);
    predefinedSecCodes.forEach(code => {
      rData.sectionMap.set(code, {
        code,
        products: [],
        subSectionMap: new Map() // subCode -> { code, products: [], totalQty: 0 }
      });
    });
  });

  // 2. Distribute products from Product Master into Racks, Sections, and Sub-sections
  currentProductMaster.forEach(product => {
    if (!product.rack || !String(product.rack).trim()) {
      return;
    }

    const parsed = parseProductRack(product.rack);
    if (!parsed) {
      return;
    }

    const rackId = parsed.rackId;

    // If rack is dynamic (not in standard 71), create dynamic entry
    if (!rackIndex.has(rackId)) {
      rackIndex.set(rackId, {
        id: rackId,
        rackNum: parsed.rackNum,
        name: `Rack ${parsed.rackNum}`,
        sectionStart: parsed.sections[0] || 'A',
        sectionEnd: parsed.sections[parsed.sections.length - 1] || 'Z',
        isDynamic: true,
        allProducts: [],
        sectionMap: new Map(),
        unassignedSectionProducts: []
      });
    }

    const rackData = rackIndex.get(rackId);
    rackData.allProducts.push(product);

    // If no recognizable section in rack string (e.g. product specifies just "R-5")
    if (!parsed.hasRecognizableSection) {
      rackData.unassignedSectionProducts.push({
        ...product,
        allocatedQty: getNumericStock(product.stockQty),
        subSection: null,
        isDistributed: false
      });
      return;
    }

    // Distribute stock quantity evenly across recognized physical locations
    const totalStock = getNumericStock(product.stockQty);
    const locations = parsed.locations || [];
    const numLocations = locations.length;

    if (numLocations > 1) {
      const distributedQtys = distributeQuantityAcrossSections(totalStock, numLocations);

      locations.forEach((loc, idx) => {
        const secCode = loc.section;
        const subCode = loc.subSection || null;
        const allocatedQty = distributedQtys[idx];

        if (!rackData.sectionMap.has(secCode)) {
          rackData.sectionMap.set(secCode, {
            code: secCode,
            products: [],
            subSectionMap: new Map()
          });
        }

        const secData = rackData.sectionMap.get(secCode);
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

        // Sub-section tracking if sub-section exists (e.g. A1 -> subSection '1')
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
      // Single physical location
      const loc = locations[0] || { section: parsed.sections[0], subSection: null };
      const secCode = loc.section;
      const subCode = loc.subSection || null;

      if (!rackData.sectionMap.has(secCode)) {
        rackData.sectionMap.set(secCode, {
          code: secCode,
          products: [],
          subSectionMap: new Map()
        });
      }

      const secData = rackData.sectionMap.get(secCode);
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
    selectedSubSectionFilter = null;
    renderAllRacksView(container);
  }
}

/**
 * ----------------------------------------------------------------------------
 * VIEW 1: ALL RACKS GRID (Dynamic Rack Map Reference)
 * ----------------------------------------------------------------------------
 */
function renderAllRacksView(container) {
  // Compute overall shop totals at render time
  let totalMappedProducts = 0;
  let totalMappedQuantity = 0;

  const rackList = Array.from(rackIndex.values()).sort((a, b) => a.rackNum - b.rackNum);

  rackList.forEach(rack => {
    totalMappedProducts += rack.allProducts.length;
    rack.allProducts.forEach(p => {
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
              <span>🗺️ Rack Map</span>
            </h2>
            <span class="text-xs font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded">
              ${rackList.length} Racks
            </span>
            <span class="text-[11px] font-semibold px-2 py-0.5 bg-sky-100 text-sky-800 rounded">
              Automatic Live Map
            </span>
          </div>
          <p class="text-xs text-slate-500 mt-1">
            Physical shop floor layout automatically generated from current Product Master data.
          </p>
        </div>
      </div>

      <!-- Quick Metrics Bar -->
      <div class="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
          <div class="text-slate-500 font-medium">Active Racks</div>
          <div class="text-base font-extrabold text-slate-900 mt-0.5">${rackList.length}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
          <div class="text-slate-500 font-medium">Mapped Products</div>
          <div class="text-base font-extrabold text-emerald-700 mt-0.5">${totalMappedProducts.toLocaleString()}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80 col-span-2 sm:col-span-1">
          <div class="text-slate-500 font-medium">Total Available Qty</div>
          <div class="text-base font-extrabold text-emerald-700 mt-0.5">${totalMappedQuantity.toLocaleString()}</div>
        </div>
      </div>

      <!-- Quick Rack Filter / Search -->
      <div class="mt-4">
        <div class="relative">
          <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-sm">
            🔎
          </span>
          <input type="text" id="rack-list-filter-input"
            placeholder="Search by Rack (e.g. 72, R-72) or Product (e.g. 21K, Clutch, Bajaj, MRP)..."
            class="w-full text-xs sm:text-sm pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none transition">
        </div>
      </div>
    </div>

    <!-- Racks Responsive Scroll Container -->
    <div class="map-scroll-container">
      <div id="racks-grid-container" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <!-- Injected rack cards -->
      </div>
    </div>

  `;

  // Render rack cards
  const gridContainer = container.querySelector('#racks-grid-container');
  renderRackCards(gridContainer, rackList);

  // Search input handler supporting both Location and Product Master searches
  const filterInput = container.querySelector('#rack-list-filter-input');
  if (filterInput) {
    filterInput.addEventListener('input', (e) => {
      const q = e.target.value;
      const searchRes = searchRackMap(rackIndex, currentProductMaster, q);
      renderRackSearchResults(gridContainer, searchRes);
    });
  }
}

function renderRackSearchResults(container, searchRes) {
  if (!container) return;

  if (!searchRes || !searchRes.isSearching) {
    container.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3';
    renderRackCards(container, searchRes.matchedRacks);
    return;
  }

  if (searchRes.matchedRacks.length === 0) {
    container.className = 'w-full';
    container.innerHTML = `
      <div class="text-center py-12 bg-white rounded-xl border border-slate-200 text-slate-400 text-xs space-y-1">
        <div class="text-2xl">🔍</div>
        <div class="font-bold text-slate-700 text-sm">No racks or products found</div>
        <p>No racks or Product Master records match "<b>${escapeHtml(searchRes.query)}</b>".</p>
      </div>
    `;
    return;
  }

  container.className = 'w-full space-y-4';

  container.innerHTML = `
    <!-- Search Summary Banner -->
    <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-emerald-900 font-medium">
      <div class="flex items-center gap-2">
        <span class="text-base">🔎</span>
        <span>
          ${searchRes.totalMatchedProducts > 0
            ? `Found <b>${searchRes.totalMatchedProducts}</b> matching product(s) across <b>${searchRes.matchedRacks.length}</b> rack(s) for "<b>${escapeHtml(searchRes.query)}</b>"`
            : `Showing <b>${searchRes.matchedRacks.length}</b> matching rack(s) for "<b>${escapeHtml(searchRes.query)}</b>"`}
        </span>
      </div>
    </div>

    <!-- Matched Racks List -->
    <div class="space-y-3">
      ${searchRes.matchedRacks.map(rack => {
        const matchingProds = rack.matchedProducts || [];
        const prodCount = matchingProds.length;
        const locations = rack.relevantLocations || [];
        const sections = rack.relevantSections || [];

        return `
          <div class="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <!-- Header -->
            <div class="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2.5">
                <button type="button" data-rack-select="${rack.id}"
                  class="font-mono font-extrabold text-base text-slate-900 hover:text-emerald-700 underline flex items-center gap-1.5 transition">
                  <span>🗺️ ${escapeHtml(rack.name || rack.id)}</span>
                </button>
                <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                  ${prodCount} matching item${prodCount === 1 ? '' : 's'}
                </span>
                <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                  ${rack.sectionStart}-${rack.sectionEnd}
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

                <button type="button" data-rack-select="${rack.id}"
                  class="ml-2 text-xs font-bold text-emerald-700 hover:text-emerald-800 underline">
                  Inspect Rack →
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
                      <th class="px-3 py-2 text-center">Rack Location</th>
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
                          <td class="px-3 py-2 text-center font-extrabold ${qty > 0 ? 'text-emerald-700' : 'text-slate-400'}">${p.stockQty !== null && p.stockQty !== undefined ? p.stockQty : '0'}</td>
                          <td class="px-3 py-2 text-center text-slate-500">${escapeHtml(p.unit || 'Pcs.')}</td>
                          <td class="px-3 py-2 text-right font-mono font-bold">₹${p.rate ? Number(p.rate).toFixed(2) : (p.mrp ? Number(p.mrp).toFixed(2) : '0.00')}</td>
                          <td class="px-3 py-2 text-center"><span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">${escapeHtml(p.group || p.parentGroup || '-')}</span></td>
                          <td class="px-3 py-2 text-center font-mono font-bold text-slate-800"><span class="px-2 py-0.5 rounded bg-amber-100/70 text-amber-900 border border-amber-200">${escapeHtml(p.rack || '-')}</span></td>
                          <td class="px-3 py-2 text-center">
                            <button type="button" data-add-to-order="${escapeHtml(p.id || p.partNumber)}"
                              class="px-2.5 py-1 bg-slate-900 hover:bg-emerald-600 text-white rounded text-[11px] font-bold transition">
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
                        <div>Qty: <b class="${qty > 0 ? 'text-emerald-700' : 'text-slate-500'}">${p.stockQty !== null && p.stockQty !== undefined ? p.stockQty : '0'}</b> ${escapeHtml(p.unit || 'Pcs.')}</div>
                        <div>MRP: <b class="text-slate-800">₹${p.rate ? Number(p.rate).toFixed(2) : (p.mrp ? Number(p.mrp).toFixed(2) : '0.00')}</b></div>
                        <div>Rack: <b class="text-amber-800 font-mono">${escapeHtml(p.rack || '-')}</b></div>
                        <div class="col-span-2">Group: <b class="text-slate-700">${escapeHtml(p.group || p.parentGroup || '-')}</b></div>
                      </div>
                      <div class="pt-1 flex justify-end">
                        <button type="button" data-add-to-order="${escapeHtml(p.id || p.partNumber)}"
                          class="px-3 py-1 bg-slate-900 hover:bg-emerald-600 text-white rounded text-[11px] font-bold transition">
                          + Add to Order
                        </button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : `
              <div class="p-3 text-center text-slate-400 text-xs">
                No products in this rack match the search query.
              </div>
            `}
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Bind drilldown buttons
  container.querySelectorAll('[data-rack-select]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedRackId = btn.dataset.rackSelect;
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

function renderRackCards(container, racks) {
  if (!container) return;

  if (racks.length === 0) {
    container.innerHTML = `
      <div class="col-span-full text-center py-10 bg-white rounded-xl border border-slate-200 text-slate-400 text-xs">
        No racks match your search.
      </div>
    `;
    return;
  }

  container.innerHTML = racks.map(rack => {
    const prodCount = rack.allProducts.length;
    let qtySum = 0;
    rack.allProducts.forEach(p => {
      qtySum += getNumericStock(p.stockQty);
    });

    // Count sections with products or total defined sections
    const sectionCount = rack.sectionMap.size;

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
            ${sectionCount} sections
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
  const rack = rackIndex.get(selectedRackId);
  if (!rack) {
    activeView = 'racks';
    renderCurrentView();
    return;
  }

  const prodCount = rack.allProducts.length;
  let qtySum = 0;
  rack.allProducts.forEach(p => {
    qtySum += getNumericStock(p.stockQty);
  });

  const sectionsList = Array.from(rack.sectionMap.values()).sort((a, b) => a.code.localeCompare(b.code));
  const unassignedSecItems = rack.unassignedSectionProducts || [];

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
            Select a section to inspect products and sub-sections stored at this location.
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
          <div class="text-base font-extrabold text-emerald-700 mt-0.5">${prodCount}</div>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80 col-span-2 sm:col-span-1">
          <div class="text-slate-500 font-medium">Total Quantity</div>
          <div class="text-base font-extrabold text-emerald-700 mt-0.5">${qtySum}</div>
        </div>
      </div>
    </div>

    <!-- Notice if items specify this rack but lack section letter -->
    ${unassignedSecItems.length > 0 ? `
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-2.5">
          <span class="text-xl">⚠️</span>
          <div>
            <div class="text-xs font-bold text-amber-900">
              ${unassignedSecItems.length} item(s) specify ${rack.name || rack.id} without a section letter
            </div>
            <div class="text-[11px] text-amber-700">
              e.g. Raw rack field is "${escapeHtml(unassignedSecItems[0]?.rack || '')}"
            </div>
          </div>
        </div>
        <button type="button" data-section-select="${UNASSIGNED_SECTION_CODE}"
          class="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition self-start sm:self-auto">
          View Unassigned Items (${unassignedSecItems.length})
        </button>
      </div>
    ` : ''}

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
              class="text-left p-3.5 rounded-xl border border-slate-200 hover:border-emerald-500 bg-white hover:bg-emerald-50/20 shadow-2xs transition group flex flex-col justify-between min-h-[110px]">
              <div>
                <div class="flex items-center justify-between">
                  <span class="font-mono font-extrabold text-lg text-slate-900 group-hover:text-emerald-700">
                    Section ${sec.code}
                  </span>
                  ${subSecCount > 0 ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">${subSecCount} sub</span>` : ''}
                </div>
                <div class="text-[11px] text-slate-500 mt-1">
                  ${subSecCount > 0 ? `${subSecCount} sub-section(s)` : 'Direct bay'}
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
    </div>
  `;

  // Bind back button
  container.querySelector('#btn-back-to-racks')?.addEventListener('click', () => {
    activeView = 'racks';
    selectedRackId = null;
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
 * VIEW 3: SECTION & SUB-SECTIONS PRODUCTS VIEW
 * ----------------------------------------------------------------------------
 */
function renderSectionProductsView(container) {
  const rack = rackIndex.get(selectedRackId);
  if (!rack) {
    activeView = 'racks';
    renderCurrentView();
    return;
  }

  const isUnassignedSection = selectedSectionCode === UNASSIGNED_SECTION_CODE;
  const secData = isUnassignedSection
    ? { code: 'Unassigned', products: rack.unassignedSectionProducts || [], subSectionMap: new Map() }
    : (rack.sectionMap.get(selectedSectionCode) || { code: selectedSectionCode, products: [], subSectionMap: new Map() });

  const allSectionProducts = secData.products || [];
  const subSectionEntries = Array.from(secData.subSectionMap.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));

  // Filter products by selected sub-section if active
  const displayedProducts = selectedSubSectionFilter
    ? allSectionProducts.filter(p => p.subSection === selectedSubSectionFilter)
    : allSectionProducts;

  // Dynamic totals
  const totalProducts = allSectionProducts.length;
  let totalQuantity = 0;
  allSectionProducts.forEach(p => {
    totalQuantity += getNumericStock(p.allocatedQty);
  });

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
        <span class="font-mono font-bold text-slate-700">
          ${isUnassignedSection ? 'Unassigned Section' : `Section ${secData.code}`}
        </span>
      </div>

      <!-- Section Title -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-xl font-extrabold text-slate-900 font-mono">
              ${rack.name || rack.id} — ${isUnassignedSection ? 'Unassigned Section' : `Section ${secData.code}`}
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
          <div class="text-base font-extrabold text-emerald-700 mt-0.5">${totalQuantity}</div>
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
                  class="px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${isSelected ? 'bg-emerald-700 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">
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
          Products in this Location (${displayedProducts.length}${selectedSubSectionFilter ? ` in Sub-section ${selectedSubSectionFilter}` : ''})
        </span>
      </div>

      ${displayedProducts.length === 0 ? `
        <div class="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-xs">
          No products currently located in this position.
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
                  <th class="px-3 py-2.5 text-center bg-slate-100">Rack Field</th>
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
                          <div class="text-[10px] font-normal text-amber-700 bg-amber-50 inline-block px-1.5 py-0.5 rounded border border-amber-200 mt-0.5">
                            Distributed: ${qty} of ${p.distributionInfo.totalQty} across ${p.distributionInfo.allLocations.join(', ')}
                          </div>
                        ` : ''}
                      </td>
                      <td class="px-3 py-2 font-mono text-slate-600 font-semibold">${escapeHtml(p.partNumber || '-')}</td>
                      <td class="px-3 py-2"><span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">${escapeHtml(p.group || p.parentGroup || '-')}</span></td>
                      <td class="px-3 py-2 text-center font-mono">
                        ${p.subSection ? `<span class="px-2 py-0.5 rounded bg-sky-100 text-sky-800 font-bold">Sub ${escapeHtml(p.subSection)}</span>` : '<span class="text-slate-400">-</span>'}
                      </td>
                      <td class="px-3 py-2 text-center font-extrabold ${qty > 0 ? 'text-emerald-700' : 'text-slate-400'}">
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
                      <div class="text-[10px] font-normal text-amber-700 bg-amber-50 inline-block px-1.5 py-0.5 rounded border border-amber-200 mt-1">
                        Distributed: ${qty} of ${p.distributionInfo.totalQty} across ${p.distributionInfo.allLocations.join(', ')}
                      </div>
                    ` : ''}
                  </div>
                  <div class="font-mono font-extrabold text-xs ${qty > 0 ? 'text-emerald-700' : 'text-slate-400'} shrink-0 text-right">
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
  container.querySelector('#btn-back-to-all-racks')?.addEventListener('click', () => {
    activeView = 'racks';
    selectedRackId = null;
    selectedSectionCode = null;
    selectedSubSectionFilter = null;
    renderCurrentView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  container.querySelector('#btn-back-to-rack-sections')?.addEventListener('click', () => {
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
