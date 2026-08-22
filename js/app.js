/**
 * Main Application Controller & Event Coordinator
 */

import { getDB, clearProductStore, countProducts, getAllProducts, upsertProducts } from './db.js';
import { INITIAL_PRODUCTS } from './sampleData.js';
import { extractOrderFromImage, getAIConfig, saveAIConfig, getAIStatus } from './aiService.js';
import { matchAllOrderItems } from './matchingEngine.js';
import { processStockPDFImport, extractProductsFromPDF } from './productImporter.js';
import {
  getCurrentOrder,
  resetOrder,
  updateOrderMeta,
  setOrderItems,
  addOrderItem,
  subscribeOrder
} from './orderManager.js';
import {
  renderOrderTable,
  initUIEventListeners,
  showToast,
  refreshDashboardStats,
  handleGeneratePDFClick
} from './ui.js';
import { searchLocalProducts, debounce, invalidateSearchCache } from './productSearch.js';

let pendingImportData = null;

// Initialize on DOM Ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      // 1. Initialize IndexedDB
      await getDB();
      await refreshDashboardStats();
      updateAIStatusBadge();

      // 2. Setup UI & Event Listeners
      initUIEventListeners();
      initAppNavigation();
      initOrderEntryEvents();
      initStockImportEvents();
      initQuickSearchEvents();
      initSettingsEvents();
      initPWA();

      // 3. Subscribe to Order state updates
      subscribeOrder((order) => {
        renderOrderTable();
      });

      // 4. Initial empty table render
      renderOrderTable();

      console.log('Maharashtra Automobile PWA initialized successfully.');
    } catch (err) {
      console.error('Initialization error:', err);
      showToast('Initialization error: ' + err.message, 'error');
    }
  });
}

function updateAIStatusBadge(isConnectedOverride = null) {
  const badge = document.getElementById('stat-ai-status');
  if (!badge) return;
  const status = getAIStatus();
  
  if (isConnectedOverride === true) {
    badge.textContent = 'AI: NETLIFY / GEMINI CONNECTED';
    badge.className = 'text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
  } else if (isConnectedOverride === false) {
    badge.textContent = 'AI: Connection Error';
    badge.className = 'text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30';
  } else if (status.mode === 'netlify') {
    badge.textContent = 'AI: Netlify / Gemini Ready';
    badge.className = 'text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider bg-sky-500/20 text-sky-300 border border-sky-500/30';
  } else {
    badge.textContent = 'AI: Not Connected';
    badge.className = 'text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30';
  }
}

/**
 * Tab Navigation Handling
 */
function initAppNavigation() {
  const tabs = document.querySelectorAll('[data-tab-target]');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = tab.dataset.tabTarget;

      tabs.forEach(t => {
        t.classList.remove('bg-slate-900', 'text-white', 'shadow-sm');
        t.classList.add('text-slate-600', 'hover:bg-slate-100');
      });

      tab.classList.add('bg-slate-900', 'text-white', 'shadow-sm');
      tab.classList.remove('text-slate-600', 'hover:bg-slate-100');

      tabContents.forEach(content => {
        if (content.id === targetId) {
          content.classList.remove('hidden');
        } else {
          content.classList.add('hidden');
        }
      });

      if (targetId === 'tab-search') {
        const searchInput = document.getElementById('finder-search-input');
        if (searchInput) {
          searchInput.focus();
          loadQuickSearchInitial();
        }
      } else if (targetId === 'tab-stock') {
        refreshDashboardStats();
      }
    });
  });
}

let currentImageObjectURL = null;

/**
 * Order Entry Flow & Image Upload Event Listeners
 */
function initOrderEntryEvents() {
  const fileInput = document.getElementById('order-image-input');
  const dropZone = document.getElementById('order-dropzone');
  const btnBrowseOrderImage = document.getElementById('btn-browse-order-image');
  const btnChangeImage = document.getElementById('btn-change-image');
  const btnRemoveImage = document.getElementById('btn-remove-image');
  const btnNewOrder = document.getElementById('btn-new-order');
  const customerNameInput = document.getElementById('order-customer-name');
  const btnAddManualItem = document.getElementById('btn-add-manual-item');

  // Customer Name Binding
  if (customerNameInput) {
    customerNameInput.addEventListener('input', (e) => {
      updateOrderMeta({ customerName: e.target.value });
    });
  }

  // New Order Button
  if (btnNewOrder) {
    btnNewOrder.addEventListener('click', () => {
      if (confirm('Start a new order? This will clear the current session.')) {
        removeUploadedImage(false);
        showToast('New order session started', 'info');
      }
    });
  }

  // Browse Image Button click -> Trigger File Input
  if (btnBrowseOrderImage) {
    btnBrowseOrderImage.addEventListener('click', (e) => {
      e.stopPropagation();
      if (fileInput) fileInput.click();
    });
  }

  // Entire Dropzone click -> Trigger File Input
  if (dropZone) {
    dropZone.addEventListener('click', () => {
      if (fileInput) fileInput.click();
    });

    // Keyboard support for accessibility (Enter or Space)
    dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (fileInput) fileInput.click();
      }
    });

    // Drag & Drop handlers
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('border-slate-900', 'bg-slate-100', 'ring-2', 'ring-slate-900');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('border-slate-900', 'bg-slate-100', 'ring-2', 'ring-slate-900');
      }, false);
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dt = e.dataTransfer;
      const file = dt?.files?.[0];
      if (file) {
        handleImageFile(file);
      }
    });
  }

  // Real File Input Change
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        handleImageFile(file);
      }
    });
  }

  // Change Image Button
  if (btnChangeImage) {
    btnChangeImage.addEventListener('click', (e) => {
      e.stopPropagation();
      if (fileInput) fileInput.click();
    });
  }

  // Remove Image Button
  if (btnRemoveImage) {
    btnRemoveImage.addEventListener('click', (e) => {
      e.stopPropagation();
      removeUploadedImage(true);
    });
  }

  // Add Manual Item Button
  if (btnAddManualItem) {
    btnAddManualItem.addEventListener('click', () => {
      const itemName = prompt('Enter customer item name / description:');
      if (itemName && itemName.trim()) {
        const qtyStr = prompt('Enter ordered quantity:', '1');
        const qty = parseInt(qtyStr, 10) || 1;
        addOrderItem(itemName.trim(), qty);
        showToast(`Added "${itemName.trim()}" to order`, 'info');
      }
    });
  }
}

/**
 * Single unified processing function for both Browse and Drag & Drop image files
 * @param {File} file - Selected or dropped browser File object
 */
export async function handleImageFile(file) {
  if (!file) return;

  // 1. Validate File type / MIME type (.jpg, .jpeg, .png, .webp)
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const validExts = ['.jpg', '.jpeg', '.png', '.webp'];
  const fileName = file.name || '';
  const fileExt = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
  const isValidType = validTypes.includes(file.type) || validExts.includes(fileExt);

  if (!isValidType) {
    showToast('Please select a JPG, JPEG, PNG, or WEBP image.', 'warning');
    const fileInput = document.getElementById('order-image-input');
    if (fileInput) fileInput.value = '';
    return;
  }

  // 2. Validate File size (Max 10 MB)
  const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
  if (file.size > MAX_SIZE_BYTES) {
    showToast('Image is too large. Please upload an image under 10 MB.', 'warning');
    const fileInput = document.getElementById('order-image-input');
    if (fileInput) fileInput.value = '';
    return;
  }

  // 3. Reset input value so re-selecting the SAME file triggers change event again
  const fileInput = document.getElementById('order-image-input');
  if (fileInput) fileInput.value = '';

  // 4. Clear previous extracted order items, matching results, confidence, and manual selections
  const fresh = resetOrder();
  const customerNameInput = document.getElementById('order-customer-name');
  const orderNumberInput = document.getElementById('order-number-display');
  if (customerNameInput) customerNameInput.value = '';
  if (orderNumberInput) orderNumberInput.textContent = fresh.orderNo;

  // 5. Update image preview with URL.createObjectURL (and revoke previous URL to prevent memory leaks)
  if (currentImageObjectURL) {
    try {
      URL.revokeObjectURL(currentImageObjectURL);
    } catch (e) {}
    currentImageObjectURL = null;
  }

  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    try {
      currentImageObjectURL = URL.createObjectURL(file);
    } catch (e) {}
  }

  const previewImg = document.getElementById('order-image-preview');
  const previewContainer = document.getElementById('image-preview-container');
  const filenameEl = document.getElementById('order-image-filename');

  if (previewImg && currentImageObjectURL) {
    previewImg.src = currentImageObjectURL;
  }
  if (filenameEl) {
    filenameEl.textContent = file.name || 'Handwritten Slip';
  }
  if (previewContainer) {
    previewContainer.classList.remove('hidden');
  }

  // 6. Start a NEW extraction request with the actual File object
  await processOrderExtraction(file);
}

/**
 * Remove active image and reset order session
 */
export function removeUploadedImage(showNotification = true) {
  if (currentImageObjectURL) {
    try {
      URL.revokeObjectURL(currentImageObjectURL);
    } catch (e) {}
    currentImageObjectURL = null;
  }

  const previewContainer = document.getElementById('image-preview-container');
  const previewImg = document.getElementById('order-image-preview');
  const fileInput = document.getElementById('order-image-input');
  const customerNameInput = document.getElementById('order-customer-name');
  const orderNumberInput = document.getElementById('order-number-display');

  if (previewContainer) previewContainer.classList.add('hidden');
  if (previewImg) previewImg.src = '';
  if (fileInput) fileInput.value = '';

  const fresh = resetOrder();
  if (customerNameInput) customerNameInput.value = '';
  if (orderNumberInput) orderNumberInput.textContent = fresh.orderNo;

  if (showNotification) {
    showToast('Image removed and order session reset.', 'info');
  }
}

/**
 * Run AI extraction on selected image and match items locally
 * Passes the actual File object to extractOrderFromImage
 */
async function processOrderExtraction(imageFile) {
  const processingOverlay = document.getElementById('ai-processing-overlay');
  const processingStepEl = document.getElementById('ai-processing-step');

  try {
    if (processingOverlay) {
      processingOverlay.classList.remove('hidden');
      if (processingStepEl) processingStepEl.textContent = 'Sending handwritten slip to AI extraction service...';
    }

    // Step 1: AI Transcription (Accepts real File object, calls Netlify / Gemini)
    const extractedItems = await extractOrderFromImage(imageFile);
    updateAIStatusBadge(true);

    if (processingStepEl) {
      processingStepEl.textContent = `Matching ${extractedItems.length} items against local product master...`;
    }

    // Step 2: Match against local IndexedDB Product Master
    const matchedItems = await matchAllOrderItems(extractedItems);

    // Step 3: Populate Order Items
    setOrderItems(matchedItems);

    showToast(`Successfully extracted and matched ${matchedItems.length} order items!`, 'success');
  } catch (err) {
    console.warn('AI Order extraction info:', err.message);
    updateAIStatusBadge(false);
    // Show clear, safe message when AI call fails or is not configured
    showToast(err.message, 'warning', 6000);
  } finally {
    if (processingOverlay) {
      processingOverlay.classList.add('hidden');
    }
  }
}


/**
 * Stock Master Import & Management Events
 */
function initStockImportEvents() {
  const stockFileInput = document.getElementById('stock-pdf-input');
  const btnTriggerUpload = document.getElementById('btn-trigger-stock-upload');
  const importModal = document.getElementById('import-preview-modal');
  const btnCloseModal = document.getElementById('import-modal-close');
  const btnCancelImport = document.getElementById('btn-cancel-import');
  const btnMergeStock = document.getElementById('btn-confirm-merge');
  const btnReplaceMaster = document.getElementById('btn-confirm-replace');
  const btnClearMaster = document.getElementById('btn-clear-master');
  const btnResetSampleMaster = document.getElementById('btn-reset-sample-master');
  const importProgressContainer = document.getElementById('import-progress-container');
  const importProgressBar = document.getElementById('import-progress-bar');
  const importProgressText = document.getElementById('import-progress-text');

  // Trigger File Dialog
  if (btnTriggerUpload && stockFileInput) {
    btnTriggerUpload.addEventListener('click', () => stockFileInput.click());
  }

  // Stock PDF File Selected
  if (stockFileInput) {
    stockFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        showToast('Reading stock PDF pages...', 'info');
        
        // Extract & Parse for Preview via coordinate parser
        const { products, warnings, totalPages } = await extractProductsFromPDF(file);

        if (products.length === 0) {
          showToast('No valid product rows could be detected in this PDF.', 'error');
          return;
        }

        // Store in pending object for modal
        pendingImportData = {
          file,
          validProducts: products,
          unparsedLines: warnings
        };

        // Populate Preview Modal
        populateImportPreviewModal(file.name, products, warnings);
      } catch (err) {
        console.error('PDF Read error:', err);
        showToast('Failed to parse stock PDF: ' + err.message, 'error');
      } finally {
        stockFileInput.value = '';
      }
    });
  }

  // Close Import Modal
  [btnCloseModal, btnCancelImport].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        if (importModal) importModal.classList.add('hidden');
        pendingImportData = null;
      });
    }
  });

  // Confirm Merge / Update Stock
  if (btnMergeStock) {
    btnMergeStock.addEventListener('click', async () => {
      if (!pendingImportData) return;
      await executeStockImport(false);
    });
  }

  // Confirm Replace Master
  if (btnReplaceMaster) {
    btnReplaceMaster.addEventListener('click', async () => {
      if (!pendingImportData) return;
      const confirmed = confirm(
        '⚠ CAUTION: Replace Product Master will DELETE all current local products and replace them with this file.\n\nAre you sure you want to proceed?'
      );
      if (confirmed) {
        await executeStockImport(true);
      }
    });
  }

  // Clear Master Action
  if (btnClearMaster) {
    btnClearMaster.addEventListener('click', async () => {
      const confirmed = confirm('⚠ DANGER: Are you sure you want to completely clear the local product database?');
      if (confirmed) {
        await clearProductStore();
        invalidateSearchCache();
        await refreshDashboardStats();
        showToast('Product master cleared successfully', 'info');
      }
    });
  }

  // Reset to Sample Master
  if (btnResetSampleMaster) {
    btnResetSampleMaster.addEventListener('click', async () => {
      const confirmed = confirm('Reset local database to initial demo spare-parts catalogue?');
      if (confirmed) {
        await upsertProducts(INITIAL_PRODUCTS, true, null, {
          fileName: 'Initial_Demo_Catalogue.pdf',
          date: new Date().toISOString()
        });
        invalidateSearchCache();
        await refreshDashboardStats();
        showToast('Product master reset to demo catalogue', 'success');
      }
    });
  }
}

/**
 * Display Preview Modal before committing to DB
 */
function populateImportPreviewModal(fileName, validProducts, unparsedLines) {
  const modal = document.getElementById('import-preview-modal');
  const fileNameEl = document.getElementById('import-file-name');
  const totalDetectedEl = document.getElementById('import-detected-count');
  const sampleTableBody = document.getElementById('import-sample-table-body');
  const unparsedWarningEl = document.getElementById('import-unparsed-warning');

  if (!modal) return;

  if (fileNameEl) fileNameEl.textContent = fileName;
  if (totalDetectedEl) totalDetectedEl.textContent = validProducts.length.toLocaleString();

  if (unparsedWarningEl) {
    if (unparsedLines.length > 0) {
      unparsedWarningEl.classList.remove('hidden');
      unparsedWarningEl.textContent = `ℹ Note: Skipped ${unparsedLines.length} header/page/non-product lines.`;
    } else {
      unparsedWarningEl.classList.add('hidden');
    }
  }

  // Display first 15 sample rows
  if (sampleTableBody) {
    sampleTableBody.innerHTML = '';
    const sampleSlice = validProducts.slice(0, 15);
    
    sampleSlice.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-100 text-xs';
      tr.innerHTML = `
        <td class="px-3 py-2 text-slate-400 text-center">${idx + 1}</td>
        <td class="px-3 py-2 font-mono font-bold text-slate-900">${escapeHtml(item.partNumber)}</td>
        <td class="px-3 py-2 font-medium text-slate-800">${escapeHtml(item.productName)}</td>
        <td class="px-3 py-2 text-center font-bold text-slate-800">${item.stockQty}</td>
        <td class="px-3 py-2 text-center">${escapeHtml(item.rack || '-')}</td>
        <td class="px-3 py-2 text-center text-slate-500">${escapeHtml(item.unit || 'Pcs.')}</td>
      `;
      sampleTableBody.appendChild(tr);
    });
  }

  modal.classList.remove('hidden');
}

/**
 * Execute Stock Import into IndexedDB with Progress Reporting
 */
async function executeStockImport(isReplace = false) {
  if (!pendingImportData) return;

  const modal = document.getElementById('import-preview-modal');
  const progressContainer = document.getElementById('import-progress-container');
  const progressBar = document.getElementById('import-progress-bar');
  const progressText = document.getElementById('import-progress-text');

  try {
    if (progressContainer) progressContainer.classList.remove('hidden');

    const result = await processStockPDFImport(pendingImportData.file, isReplace, (step, msg, pct) => {
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (progressText) progressText.textContent = `${msg} (${pct}%)`;
    });

    if (modal) modal.classList.add('hidden');
    pendingImportData = null;

    await refreshDashboardStats();
    showToast(`Stock import complete! ${result.importedCount} products saved (${result.mode}).`, 'success');
  } catch (err) {
    console.error('Import execution error:', err);
    showToast('Import failed: ' + err.message, 'error');
  } finally {
    if (progressContainer) progressContainer.classList.add('hidden');
  }
}

/**
 * Quick Search & Part Finder Tab
 */
function initQuickSearchEvents() {
  const searchInput = document.getElementById('finder-search-input');
  const resultsContainer = document.getElementById('finder-results-container');
  const countBadge = document.getElementById('finder-results-count');

  if (searchInput) {
    const debouncedFinder = debounce(async (query) => {
      const res = await searchLocalProducts(query, 50);
      renderQuickSearchResults(res);
    }, 150);

    searchInput.addEventListener('input', (e) => {
      debouncedFinder(e.target.value);
    });
  }
}

async function loadQuickSearchInitial() {
  const searchInput = document.getElementById('finder-search-input');
  const query = searchInput ? searchInput.value : '';
  const res = await searchLocalProducts(query, 50);
  renderQuickSearchResults(res);
}

function renderQuickSearchResults(searchResult) {
  const resultsContainer = document.getElementById('finder-results-container');
  const countBadge = document.getElementById('finder-results-count');
  if (!resultsContainer) return;

  if (countBadge) {
    countBadge.textContent = `${searchResult.total.toLocaleString()} total products matching`;
  }

  if (searchResult.items.length === 0) {
    resultsContainer.innerHTML = `
      <div class="py-12 text-center text-slate-500">
        <div class="text-3xl mb-2">🔍</div>
        <div class="font-semibold text-slate-700">No parts found</div>
        <div class="text-xs text-slate-400 mt-1">Try another search term or part number</div>
      </div>
    `;
    return;
  }

  resultsContainer.innerHTML = `
    <table class="w-full text-left text-xs border-collapse">
      <thead class="bg-slate-100 text-slate-700 font-bold sticky top-0 border-b border-slate-200">
        <tr>
          <th class="px-4 py-3">Part Number</th>
          <th class="px-4 py-3">Product Name / Description</th>
          <th class="px-4 py-3 text-center">Rack Location</th>
          <th class="px-4 py-3 text-center">Stock Qty</th>
          <th class="px-4 py-3 text-center">Unit</th>
          <th class="px-4 py-3 text-center">Action</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100 text-slate-700">
        ${searchResult.items.map(p => `
          <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-4 py-3 font-mono font-bold text-slate-900">${escapeHtml(p.partNumber)}</td>
            <td class="px-4 py-3 font-medium text-slate-800 text-sm">${escapeHtml(p.productName)}</td>
            <td class="px-4 py-3 text-center"><span class="px-2 py-0.5 bg-slate-100 font-semibold rounded text-slate-700">${escapeHtml(p.rack || '—')}</span></td>
            <td class="px-4 py-3 text-center font-bold ${p.stockQty !== null && p.stockQty > 0 ? 'text-emerald-600' : 'text-slate-600'}">${p.stockQty !== null && p.stockQty !== undefined ? p.stockQty : '—'}</td>
            <td class="px-4 py-3 text-center text-slate-500">${escapeHtml(p.unit || '—')}</td>
            <td class="px-4 py-3 text-center">
              <button data-add-to-order="${escapeHtml(p.partNumber)}" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded text-xs font-semibold shadow-sm transition">
                + Add to Order
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Attach "+ Add to Order" handlers
  resultsContainer.querySelectorAll('[data-add-to-order]').forEach(btn => {
    btn.addEventListener('click', () => {
      const partNo = btn.dataset.addToOrder;
      const product = searchResult.items.find(p => p.partNumber === partNo);
      if (product) {
        const item = addOrderItem(product.productName, 1);
        item.matchedProduct = product;
        item.isManual = true;
        item.confidence = 100;
        item.tier = 'HIGH';
        renderOrderTable();
        showToast(`Added "${product.productName}" to order`, 'success');
      }
    });
  });
}

/**
 * Settings & AI Configuration Events
 */
function initSettingsEvents() {
  const modeSelect = document.getElementById('settings-ai-mode');
  const netlifyInput = document.getElementById('settings-netlify-endpoint');
  const btnSaveSettings = document.getElementById('btn-save-settings');

  const currentConfig = getAIConfig();
  if (modeSelect) modeSelect.value = currentConfig.mode || 'netlify';
  if (netlifyInput) netlifyInput.value = currentConfig.netlifyEndpoint || '/.netlify/functions/extract-order';

  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', () => {
      const newConfig = {
        mode: modeSelect ? modeSelect.value : 'netlify',
        netlifyEndpoint: netlifyInput ? netlifyInput.value.trim() : '/.netlify/functions/extract-order'
      };
      saveAIConfig(newConfig);
      updateAIStatusBadge();
      showToast('AI Settings updated successfully', 'success');
    });
  }
}

/**
 * PWA Service Worker Registration & Online/Offline Handlers
 */
function initPWA() {
  const offlineBadge = document.getElementById('offline-indicator');

  function updateOnlineStatus() {
    if (navigator.onLine) {
      if (offlineBadge) offlineBadge.classList.add('hidden');
    } else {
      if (offlineBadge) offlineBadge.classList.remove('hidden');
      showToast('You are currently offline. Local product matching & PDF generation remain fully functional.', 'info', 5000);
    }
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js')
        .then(reg => console.log('PWA ServiceWorker registered with scope:', reg.scope))
        .catch(err => console.warn('ServiceWorker registration skipped:', err));
    });
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
