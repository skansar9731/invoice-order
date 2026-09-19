/**
 * Map Manager & Settings Modal Controller
 * Handles Counter station settings and Product Assignment to Counter Sections.
 * Rack Map is 100% automatic and derived from Product Master (no manual CRUD).
 */

import {
  getCounterConfigs,
  saveCounterConfig,
  getAllProducts,
  assignProductToCounter
} from './db.js';
import { generateSections } from './mapConfigData.js';
import { showToast } from './ui.js';
import { loadCounterMap } from './counterMap.js';

let activeManageTab = 'counters'; // 'counters'

/**
 * Open the Manage Maps Modal (defaults to Counters)
 */
export async function openManageMapsModal(defaultTab = 'counters') {
  activeManageTab = 'counters';
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

  if (btnRacks) btnRacks.classList.add('hidden');
  if (btnCounters) {
    btnCounters.classList.add('bg-slate-900', 'text-white');
    btnCounters.classList.remove('text-slate-600', 'hover:bg-slate-100');
  }
}

/**
 * Load and render the content of the management tab
 */
export async function loadAndRenderManageContent() {
  const contentContainer = document.getElementById('manage-maps-content');
  if (!contentContainer) return;

  const counters = await getCounterConfigs();
  renderManageCountersTab(contentContainer, counters);
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
          <p class="text-xs text-slate-500 mt-0.5">Front shop desks, billing lanes, and pickup trays.</p>
        </div>
      </div>

      <div class="max-h-[380px] overflow-y-auto space-y-2 pr-1">
        ${counters.map(c => `
          <div class="p-3 bg-white rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div class="flex items-center gap-2">
                <span class="font-extrabold text-sm text-slate-900">${c.name || c.id}</span>
                <span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">
                  ${c.sectionStart}-${c.sectionEnd} (${(c.sections || []).length} sections)
                </span>
              </div>
            </div>

            <div class="flex items-center gap-1.5 self-end sm:self-auto">
              <button type="button" data-edit-counter="${c.id}"
                class="px-2.5 py-1 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition">
                Rename
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Bind Rename Counter
  container.querySelectorAll('[data-edit-counter]').forEach(btn => {
    btn.addEventListener('click', () => {
      promptRenameCounter(btn.dataset.editCounter);
    });
  });
}

/**
 * Counter rename action
 */
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

/**
 * Section Prompts for Counter
 */
export async function promptAddSection(targetType, targetId) {
  if (targetType !== 'counter') return;

  const code = prompt('Enter New Section Code (e.g. "AA", "Z1"):');
  if (!code) return;
  const cleanCode = code.trim().toUpperCase();

  const displayName = prompt(`Enter Display Name for Section ${cleanCode} (optional):`, '');

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
