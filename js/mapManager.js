/**
 * Map Manager & Settings Modal Controller
 * Handles CRUD operations for Racks, Counters, Sections, and Sub-sections.
 * Also handles Product Assignment to Counter Sections.
 */

import {
  getRackConfigs,
  saveRackConfig,
  getCounterConfigs,
  saveCounterConfig,
  getAllProducts,
  assignProductToCounter
} from './db.js';
import { generateSections } from './mapConfigData.js';
import { showToast } from './ui.js';
import { loadRackMap } from './rackMap.js';
import { loadCounterMap } from './counterMap.js';

let activeManageTab = 'racks'; // 'racks' | 'counters'

/**
 * Open the Manage Maps Modal
 */
export async function openManageMapsModal(defaultTab = 'racks') {
  activeManageTab = defaultTab;
  const modal = document.getElementById('manage-maps-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  renderManageModalTabs();
  await loadAndRenderManageContent();
}

/**
 * Close the Manage Maps Modal
 */
export function closeManageMapsModal() {
  const modal = document.getElementById('manage-maps-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Render tab headers inside Manage Maps modal
 */
function renderManageModalTabs() {
  const btnRacks = document.getElementById('manage-tab-btn-racks');
  const btnCounters = document.getElementById('manage-tab-btn-counters');

  if (activeManageTab === 'racks') {
    btnRacks?.classList.add('bg-slate-900', 'text-white');
    btnRacks?.classList.remove('text-slate-600', 'hover:bg-slate-100');
    btnCounters?.classList.remove('bg-slate-900', 'text-white');
    btnCounters?.classList.add('text-slate-600', 'hover:bg-slate-100');
  } else {
    btnCounters?.classList.add('bg-slate-900', 'text-white');
    btnCounters?.classList.remove('text-slate-600', 'hover:bg-slate-100');
    btnRacks?.classList.remove('bg-slate-900', 'text-white');
    btnRacks?.classList.add('text-slate-600', 'hover:bg-slate-100');
  }
}

/**
 * Load and render the content of the selected management tab
 */
export async function loadAndRenderManageContent() {
  const contentContainer = document.getElementById('manage-maps-content');
  if (!contentContainer) return;

  if (activeManageTab === 'racks') {
    const racks = await getRackConfigs();
    renderManageRacksTab(contentContainer, racks);
  } else {
    const counters = await getCounterConfigs();
    renderManageCountersTab(contentContainer, counters);
  }
}

/**
 * Render Manage Racks Tab
 */
function renderManageRacksTab(container, racks) {
  container.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
        <div>
          <h4 class="text-sm font-bold text-slate-900">Rack Inventory Locations (${racks.length} total)</h4>
          <p class="text-xs text-slate-500 mt-0.5">Manage physical racks and shelf boundaries.</p>
        </div>
        <button type="button" id="btn-modal-add-rack"
          class="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-xs self-start sm:self-auto">
          <span>+ Add New Rack</span>
        </button>
      </div>

      <div class="max-h-[380px] overflow-y-auto space-y-2 pr-1">
        ${racks.map(rack => `
          <div class="p-3 bg-white rounded-xl border ${rack.archived ? 'border-dashed border-slate-300 bg-slate-50/50 opacity-60' : 'border-slate-200'} flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div class="flex items-center gap-2">
                <span class="font-mono font-extrabold text-sm text-slate-900">${rack.name || rack.id}</span>
                <span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                  ${rack.sectionStart}-${rack.sectionEnd} (${(rack.sections || []).length} sections)
                </span>
                ${rack.archived ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">Archived</span>' : ''}
              </div>
            </div>

            <div class="flex items-center gap-1.5 self-end sm:self-auto">
              <button type="button" data-edit-rack="${rack.id}"
                class="px-2.5 py-1 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition">
                Rename
              </button>
              <button type="button" data-toggle-archive-rack="${rack.id}"
                class="px-2.5 py-1 text-xs font-bold ${rack.archived ? 'text-emerald-700 hover:bg-emerald-50' : 'text-rose-700 hover:bg-rose-50'} rounded-md transition">
                ${rack.archived ? 'Restore' : 'Archive'}
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Bind Add Rack
  container.querySelector('#btn-modal-add-rack')?.addEventListener('click', promptAddNewRack);

  // Bind Rename Rack
  container.querySelectorAll('[data-edit-rack]').forEach(btn => {
    btn.addEventListener('click', () => {
      promptRenameRack(btn.dataset.editRack);
    });
  });

  // Bind Archive / Restore Rack
  container.querySelectorAll('[data-toggle-archive-rack]').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleArchiveRack(btn.dataset.toggleArchiveRack);
    });
  });
}

/**
 * Render Manage Counters Tab
 */
function renderManageCountersTab(container, counters) {
  container.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
        <div>
          <h4 class="text-sm font-bold text-slate-900">Counter Stations (${counters.length} total)</h4>
          <p class="text-xs text-slate-500 mt-0.5">Manage front shop desks, billing lanes, and pickup trays.</p>
        </div>
        <button type="button" id="btn-modal-add-counter"
          class="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-xs self-start sm:self-auto">
          <span>+ Add Counter</span>
        </button>
      </div>

      <div class="max-h-[380px] overflow-y-auto space-y-2 pr-1">
        ${counters.map(c => `
          <div class="p-3 bg-white rounded-xl border ${c.archived ? 'border-dashed border-slate-300 bg-slate-50/50 opacity-60' : 'border-slate-200'} flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div class="flex items-center gap-2">
                <span class="font-extrabold text-sm text-slate-900">${c.name || c.id}</span>
                <span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">
                  ${c.sectionStart}-${c.sectionEnd} (${(c.sections || []).length} sections)
                </span>
                ${c.archived ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">Archived</span>' : ''}
              </div>
            </div>

            <div class="flex items-center gap-1.5 self-end sm:self-auto">
              <button type="button" data-edit-counter="${c.id}"
                class="px-2.5 py-1 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition">
                Rename
              </button>
              <button type="button" data-toggle-archive-counter="${c.id}"
                class="px-2.5 py-1 text-xs font-bold ${c.archived ? 'text-emerald-700 hover:bg-emerald-50' : 'text-rose-700 hover:bg-rose-50'} rounded-md transition">
                ${c.archived ? 'Restore' : 'Archive'}
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Bind Add Counter
  container.querySelector('#btn-modal-add-counter')?.addEventListener('click', promptAddNewCounter);

  // Bind Rename Counter
  container.querySelectorAll('[data-edit-counter]').forEach(btn => {
    btn.addEventListener('click', () => {
      promptRenameCounter(btn.dataset.editCounter);
    });
  });

  // Bind Archive / Restore Counter
  container.querySelectorAll('[data-toggle-archive-counter]').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleArchiveCounter(btn.dataset.toggleArchiveCounter);
    });
  });
}

/**
 * ----------------------------------------------------------------------------
 * RACK ACTIONS
 * ----------------------------------------------------------------------------
 */
async function promptAddNewRack() {
  const rackNumStr = prompt('Enter Rack Number (e.g. "74"):');
  if (!rackNumStr) return;
  const num = parseInt(rackNumStr.replace(/\D/g, ''), 10);
  if (!num || isNaN(num)) {
    alert('Please enter a valid numeric rack number.');
    return;
  }

  const id = `R${num}`;
  const racks = await getRackConfigs();
  if (racks.some(r => r.id === id && !r.archived)) {
    alert(`Rack ${num} already exists.`);
    return;
  }

  const name = prompt(`Enter Rack Name:`, `Rack ${num}`);
  const startChar = (prompt('Enter Section Start Letter (default A):', 'A') || 'A').toUpperCase();
  const endChar = (prompt('Enter Section End Letter (e.g. J):', 'J') || 'J').toUpperCase();

  const newRack = {
    id,
    rackNum: num,
    name: name || `Rack ${num}`,
    sectionStart: startChar,
    sectionEnd: endChar,
    archived: false,
    createdAt: Date.now(),
    sections: generateSections(startChar, endChar)
  };

  await saveRackConfig(newRack);
  showToast(`${newRack.name} created with sections ${startChar} to ${endChar}`, 'success');
  await loadAndRenderManageContent();
  await loadRackMap();
}

async function promptRenameRack(rackId) {
  const racks = await getRackConfigs();
  const rack = racks.find(r => r.id === rackId);
  if (!rack) return;

  const newName = prompt(`Enter new name for ${rack.name || rack.id}:`, rack.name || rack.id);
  if (!newName) return;

  rack.name = newName.trim();
  await saveRackConfig(rack);
  showToast(`Rack renamed to ${rack.name}`, 'success');
  await loadAndRenderManageContent();
  await loadRackMap();
}

async function toggleArchiveRack(rackId) {
  const racks = await getRackConfigs();
  const rack = racks.find(r => r.id === rackId);
  if (!rack) return;

  rack.archived = !rack.archived;
  await saveRackConfig(rack);
  showToast(`${rack.name || rack.id} ${rack.archived ? 'archived' : 'restored'}`, 'info');
  await loadAndRenderManageContent();
  await loadRackMap();
}

/**
 * ----------------------------------------------------------------------------
 * COUNTER ACTIONS
 * ----------------------------------------------------------------------------
 */
async function promptAddNewCounter() {
  const numStr = prompt('Enter Counter Number (e.g. "9"):');
  if (!numStr) return;
  const num = parseInt(numStr.replace(/\D/g, ''), 10);
  if (!num || isNaN(num)) {
    alert('Please enter a valid numeric counter number.');
    return;
  }

  const id = `C${num}`;
  const counters = await getCounterConfigs();
  if (counters.some(c => c.id === id && !c.archived)) {
    alert(`Counter ${num} already exists.`);
    return;
  }

  const name = prompt(`Enter Counter Name:`, `Counter ${num}`);
  const startChar = (prompt('Enter Section Start Letter (default A):', 'A') || 'A').toUpperCase();
  const endChar = (prompt('Enter Section End Letter (e.g. T):', 'T') || 'T').toUpperCase();

  const newCounter = {
    id,
    counterNum: num,
    name: name || `Counter ${num}`,
    sectionStart: startChar,
    sectionEnd: endChar,
    archived: false,
    createdAt: Date.now(),
    sections: generateSections(startChar, endChar)
  };

  await saveCounterConfig(newCounter);
  showToast(`${newCounter.name} created with sections ${startChar} to ${endChar}`, 'success');
  await loadAndRenderManageContent();
  await loadCounterMap();
}

async function promptRenameCounter(counterId) {
  const counters = await getCounterConfigs();
  const counter = counters.find(c => c.id === counterId);
  if (!counter) return;

  const newName = prompt(`Enter new name for ${counter.name || counter.id}:`, counter.name || counter.id);
  if (!newName) return;

  counter.name = newName.trim();
  await saveCounterConfig(counter);
  showToast(`Counter renamed to ${counter.name}`, 'success');
  await loadAndRenderManageContent();
  await loadCounterMap();
}

async function toggleArchiveCounter(counterId) {
  const counters = await getCounterConfigs();
  const counter = counters.find(c => c.id === counterId);
  if (!counter) return;

  counter.archived = !counter.archived;
  await saveCounterConfig(counter);
  showToast(`${counter.name || counter.id} ${counter.archived ? 'archived' : 'restored'}`, 'info');
  await loadAndRenderManageContent();
  await loadCounterMap();
}

/**
 * ----------------------------------------------------------------------------
 * SECTION PROMPTS (Called from module views)
 * ----------------------------------------------------------------------------
 */
export async function promptAddSection(targetType, targetId) {
  const code = prompt('Enter New Section Code (e.g. "AA", "Z1", "EXTRA"):');
  if (!code) return;
  const cleanCode = code.trim().toUpperCase();

  const displayName = prompt(`Enter Display Name for Section ${cleanCode} (optional):`, '');

  if (targetType === 'rack') {
    const racks = await getRackConfigs();
    const rack = racks.find(r => r.id === targetId);
    if (!rack) return;
    if (!rack.sections) rack.sections = [];
    if (rack.sections.some(s => s.code === cleanCode && !s.archived)) {
      alert(`Section ${cleanCode} already exists in ${rack.name || rack.id}.`);
      return;
    }
    rack.sections.push({
      code: cleanCode,
      displayName: (displayName || '').trim(),
      archived: false,
      subSections: []
    });
    await saveRackConfig(rack);
    showToast(`Section ${cleanCode} added to ${rack.name}`, 'success');
    await loadRackMap();
  } else {
    const counters = await getCounterConfigs();
    const counter = counters.find(c => c.id === targetId);
    if (!counter) return;
    if (!counter.sections) counter.sections = [];
    if (counter.sections.some(s => s.code === cleanCode && !s.archived)) {
      alert(`Section ${cleanCode} already exists in ${counter.name || counter.id}.`);
      return;
    }
    counter.sections.push({
      code: cleanCode,
      displayName: (displayName || '').trim(),
      archived: false,
      subSections: []
    });
    await saveCounterConfig(counter);
    showToast(`Section ${cleanCode} added to ${counter.name}`, 'success');
    await loadCounterMap();
  }
}

/**
 * ----------------------------------------------------------------------------
 * ASSIGN PRODUCT TO COUNTER MODAL
 * ----------------------------------------------------------------------------
 */
export async function openAssignProductToCounterModal(counterId, sectionCode) {
  const modal = document.getElementById('assign-product-modal');
  if (!modal) return;

  const targetBadge = document.getElementById('assign-target-location');
  if (targetBadge) {
    targetBadge.textContent = `${counterId} / Section ${sectionCode}`;
  }

  modal.classList.remove('hidden');

  // Load all products from Product Master
  const products = (await getAllProducts()) || [];
  const searchInput = document.getElementById('assign-product-search-input');
  const resultsContainer = document.getElementById('assign-product-results');

  function renderList(query = '') {
    if (!resultsContainer) return;
    const q = query.trim().toLowerCase();
    const filtered = products.filter(p => {
      if (!q) return true;
      return (
        (p.partNumber || '').toLowerCase().includes(q) ||
        (p.productName || '').toLowerCase().includes(q) ||
        (p.itemDetails || '').toLowerCase().includes(q) ||
        (p.group || p.parentGroup || '').toLowerCase().includes(q)
      );
    }).slice(0, 30);

    if (filtered.length === 0) {
      resultsContainer.innerHTML = '<div class="text-center py-6 text-slate-400 text-xs">No products matched.</div>';
      return;
    }

    resultsContainer.innerHTML = filtered.map(p => `
      <div class="p-3 bg-white rounded-lg border border-slate-200 hover:border-sky-400 flex items-center justify-between gap-3 transition">
        <div class="min-w-0">
          <div class="font-bold text-xs text-slate-900 truncate">${escapeHtml(p.productName || p.itemDetails || '-')}</div>
          <div class="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
            <span class="font-mono font-semibold">${escapeHtml(p.partNumber)}</span>
            <span>&bull;</span>
            <span>Qty: <b>${p.stockQty ?? 0}</b></span>
            <span>&bull;</span>
            <span>MRP: ₹${p.rate ? Number(p.rate).toFixed(2) : '-'}</span>
          </div>
        </div>
        <button type="button" data-assign-part="${escapeHtml(p.partNumber)}"
          class="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold transition shrink-0">
          Assign
        </button>
      </div>
    `).join('');

    resultsContainer.querySelectorAll('[data-assign-part]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const partNumber = btn.dataset.assignPart;
        await assignProductToCounter(partNumber, counterId, sectionCode);
        showToast(`Product ${partNumber} assigned to ${counterId} / Section ${sectionCode}`, 'success');
        modal.classList.add('hidden');
        await loadCounterMap();
      });
    });
  }

  renderList('');

  if (searchInput) {
    searchInput.value = '';
    searchInput.oninput = (e) => renderList(e.target.value);
  }
}

export function closeAssignProductModal() {
  const modal = document.getElementById('assign-product-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Initialize event listeners for modals on DOM ready
 */
export function initMapManagerEvents() {
  document.getElementById('manage-maps-close')?.addEventListener('click', closeManageMapsModal);
  document.getElementById('assign-product-modal-close')?.addEventListener('click', closeAssignProductModal);

  document.getElementById('manage-tab-btn-racks')?.addEventListener('click', () => {
    activeManageTab = 'racks';
    renderManageModalTabs();
    loadAndRenderManageContent();
  });

  document.getElementById('manage-tab-btn-counters')?.addEventListener('click', () => {
    activeManageTab = 'counters';
    renderManageModalTabs();
    loadAndRenderManageContent();
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
