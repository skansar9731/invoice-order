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

// Multi-Image State Management (Preserves exact sequence of images)
export let uploadedImages = []; // [{ id, file, objectUrl, name, size, status, extractedItems, error }]

export function getUploadedImages() {
  return uploadedImages;
}

/**
 * Order Entry Flow & Multi-Image Upload Event Listeners
 */
function initOrderEntryEvents() {
  const fileInput = document.getElementById('order-image-input');
  const dropZone = document.getElementById('order-dropzone');
  const btnBrowseOrderImage = document.getElementById('btn-browse-order-image');
  const btnAddMoreImages = document.getElementById('btn-add-more-images');
  const btnClearAllImages = document.getElementById('btn-clear-all-images');
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
      if (confirm('Start a new order? This will clear the current session and all uploaded images.')) {
        clearAllImages(false);
        showToast('New order session started', 'info');
      }
    });
  }

  // Browse Images Button click -> Trigger File Input
  if (btnBrowseOrderImage) {
    btnBrowseOrderImage.addEventListener('click', (e) => {
      e.stopPropagation();
      if (fileInput) fileInput.click();
    });
  }

  // Add More Images Button click -> Trigger File Input
  if (btnAddMoreImages) {
    btnAddMoreImages.addEventListener('click', (e) => {
      e.stopPropagation();
      if (fileInput) fileInput.click();
    });
  }

  // Clear All Images Button
  if (btnClearAllImages) {
    btnClearAllImages.addEventListener('click', (e) => {
      e.stopPropagation();
      clearAllImages(true);
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

    // Drag & Drop handlers (supports single & multiple files)
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
      const files = dt?.files;
      if (files && files.length > 0) {
        handleImageFiles(files);
      }
    });
  }

  // Real File Input Change
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleImageFiles(files);
      }
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
 * Handle addition of 1 or more image files
 * Preserves the exact user-provided sequence
 * @param {FileList | File[] | File} filesInput
 */
export async function handleImageFiles(filesInput) {
  if (!filesInput) return;

  let rawFiles = [];
  if (Array.isArray(filesInput)) {
    rawFiles = filesInput;
  } else if (typeof FileList !== 'undefined' && filesInput instanceof FileList) {
    rawFiles = Array.from(filesInput);
  } else if (filesInput && typeof filesInput.length === 'number' && typeof filesInput.item === 'function') {
    rawFiles = Array.from(filesInput);
  } else if (filesInput && (filesInput instanceof Blob || typeof filesInput.name === 'string')) {
    rawFiles = [filesInput];
  } else if (filesInput && typeof filesInput[Symbol.iterator] === 'function') {
    rawFiles = Array.from(filesInput);
  } else {
    rawFiles = [filesInput];
  }

  if (rawFiles.length === 0) return;

  // Check maximum 10 images limit
  const MAX_IMAGES = 10;
  const availableSlots = MAX_IMAGES - uploadedImages.length;
  if (availableSlots <= 0) {
    showToast(`Maximum limit of ${MAX_IMAGES} images per order reached.`, 'warning');
    const fileInput = document.getElementById('order-image-input');
    if (fileInput) fileInput.value = '';
    return;
  }

  const filesToAdd = rawFiles.slice(0, availableSlots);
  if (rawFiles.length > availableSlots) {
    showToast(`Only ${availableSlots} more image(s) can be added (max ${MAX_IMAGES}).`, 'warning');
  }

  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const validExts = ['.jpg', '.jpeg', '.png', '.webp'];
  const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

  const newlyAddedImages = [];
  let invalidCount = 0;
  let oversizedCount = 0;

  for (let i = 0; i < filesToAdd.length; i++) {
    const file = filesToAdd[i];
    const fileName = file.name || `image_${Date.now()}_${i}.jpg`;
    const fileExt = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    const isValidType = validTypes.includes(file.type) || validExts.includes(fileExt);

    if (!isValidType) {
      invalidCount++;
      continue;
    }

    if (file.size > MAX_SIZE_BYTES) {
      oversizedCount++;
      continue;
    }

    let objectUrl = '';
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      try {
        objectUrl = URL.createObjectURL(file);
      } catch (e) {}
    }

    const imgRecord = {
      id: `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      file,
      objectUrl,
      name: fileName,
      size: file.size,
      status: 'pending', // 'pending' | 'extracting' | 'completed' | 'error'
      extractedItems: [],
      error: null
    };

    newlyAddedImages.push(imgRecord);
  }

  // Reset file input value so selecting the same file consecutively triggers change event
  const fileInput = document.getElementById('order-image-input');
  if (fileInput) fileInput.value = '';

  if (invalidCount > 0) {
    showToast(`${invalidCount} file(s) ignored: Please select JPG, JPEG, PNG, or WEBP images.`, 'warning');
  }
  if (oversizedCount > 0) {
    showToast(`${oversizedCount} image(s) ignored: Exceeds 10 MB limit.`, 'warning');
  }

  if (newlyAddedImages.length === 0) return;

  // Append new images preserving exact sequence
  uploadedImages.push(...newlyAddedImages);
  renderImageGallery();

  // Process extraction for all pending images
  await processBatchExtraction();
}

// Backward compatibility alias for single image calls
export async function handleImageFile(file) {
  return handleImageFiles(file);
}

/**
 * Process extraction for all pending images in sequential order
 */
export async function processBatchExtraction() {
  const pendingImages = uploadedImages.filter(img => img.status === 'pending');
  if (pendingImages.length === 0) return;

  const overlay = document.getElementById('ai-processing-overlay');
  const stepEl = document.getElementById('ai-processing-step');
  const pagesListEl = document.getElementById('ai-processing-pages-list');

  if (overlay) overlay.classList.remove('hidden');

  const total = uploadedImages.length;

  for (let i = 0; i < uploadedImages.length; i++) {
    const imgRecord = uploadedImages[i];
    if (imgRecord.status !== 'pending') continue;

    imgRecord.status = 'extracting';
    renderImageGallery();

    if (stepEl) {
      stepEl.textContent = `Extracting image ${i + 1} of ${total}: "${imgRecord.name}"...`;
    }

    if (pagesListEl) {
      renderProcessingOverlayList(pagesListEl, i);
    }

    try {
      // Pass actual File object to existing extractOrderFromImage
      const rawItems = await extractOrderFromImage(imgRecord.file);
      
      // Tag items with sourceImage number (1-based index)
      imgRecord.extractedItems = (rawItems || []).map(item => ({
        customerText: item.customerText,
        quantity: item.quantity,
        sourceImage: i + 1
      }));
      imgRecord.status = 'completed';
      imgRecord.error = null;
    } catch (err) {
      console.warn(`Extraction error for image ${i + 1} (${imgRecord.name}):`, err.message);
      imgRecord.status = 'error';
      imgRecord.error = err.message || 'Extraction failed';
      imgRecord.extractedItems = [];
    }

    renderImageGallery();
    if (pagesListEl) {
      renderProcessingOverlayList(pagesListEl, i);
    }
  }

  if (overlay) overlay.classList.add('hidden');

  // Merge all extracted items in exact sequential image order
  await syncOrderItemsFromImages();
}

/**
 * Render the status of all images inside the AI processing overlay
 */
function renderProcessingOverlayList(containerEl, activeIndex) {
  if (!containerEl) return;
  containerEl.innerHTML = uploadedImages.map((img, idx) => {
    let statusText = 'Waiting...';
    let statusColor = 'text-slate-400';
    if (img.status === 'completed') {
      statusText = `✓ Completed (${img.extractedItems.length} items)`;
      statusColor = 'text-emerald-400 font-semibold';
    } else if (img.status === 'extracting') {
      statusText = '⏳ Extracting handwriting...';
      statusColor = 'text-sky-300 font-semibold animate-pulse';
    } else if (img.status === 'error') {
      statusText = `✕ Failed (${img.error || 'Error'})`;
      statusColor = 'text-rose-400 font-semibold';
    }
    return `
      <div class="flex items-center justify-between text-xs py-1 border-b border-slate-800/80 last:border-0">
        <span class="font-medium text-slate-200">Image ${idx + 1}: ${escapeHtml(img.name)}</span>
        <span class="${statusColor}">${statusText}</span>
      </div>
    `;
  }).join('');
}

/**
 * Merge extracted items from all images in sequential order and run local matching
 */
export async function syncOrderItemsFromImages() {
  const allExtractedItems = [];
  let completedCount = 0;
  let failedImages = [];

  uploadedImages.forEach((img, idx) => {
    if (img.status === 'completed' && Array.isArray(img.extractedItems)) {
      completedCount++;
      img.extractedItems.forEach(item => {
        allExtractedItems.push({
          customerText: item.customerText,
          quantity: item.quantity,
          sourceImage: idx + 1
        });
      });
    } else if (img.status === 'error') {
      failedImages.push(`Image ${idx + 1}`);
    }
  });

  if (allExtractedItems.length > 0) {
    // Step 2: Match against local IndexedDB Product Master
    const matchedItems = await matchAllOrderItems(allExtractedItems);
    setOrderItems(matchedItems);
    updateAIStatusBadge(true);

    if (failedImages.length > 0) {
      showToast(`${failedImages.join(', ')} failed. Extracted ${matchedItems.length} items from ${completedCount} image(s).`, 'warning', 7000);
    } else {
      showToast(`Successfully extracted ${matchedItems.length} items from ${completedCount} image(s)!`, 'success');
    }
  } else if (failedImages.length > 0) {
    updateAIStatusBadge(false);
    showToast(`Failed to extract items from ${failedImages.join(', ')}. Please retry.`, 'warning', 7000);
  } else {
    resetOrder();
  }
}

/**
 * Retry extraction for a specific failed image
 */
export async function retryImageExtraction(imageId) {
  const imgRecord = uploadedImages.find(img => img.id === imageId);
  if (!imgRecord) return;

  imgRecord.status = 'pending';
  imgRecord.error = null;
  renderImageGallery();
  await processBatchExtraction();
}

/**
 * Remove a specific image by ID and re-sync order
 */
export async function removeImageById(imageId) {
  const idx = uploadedImages.findIndex(img => img.id === imageId);
  if (idx < 0) return;

  const removed = uploadedImages[idx];
  if (removed && removed.objectUrl) {
    try {
      URL.revokeObjectURL(removed.objectUrl);
    } catch (e) {}
  }

  uploadedImages.splice(idx, 1);

  // Re-number remaining images
  uploadedImages.forEach((img, i) => {
    if (Array.isArray(img.extractedItems)) {
      img.extractedItems.forEach(item => {
        item.sourceImage = i + 1;
      });
    }
  });

  renderImageGallery();
  await syncOrderItemsFromImages();
  showToast('Image removed from order.', 'info');
}

/**
 * Clear all images and reset order session
 */
export function clearAllImages(showNotification = true) {
  uploadedImages.forEach(img => {
    if (img.objectUrl) {
      try {
        URL.revokeObjectURL(img.objectUrl);
      } catch (e) {}
    }
  });
  uploadedImages.length = 0;

  const fileInput = document.getElementById('order-image-input');
  const customerNameInput = document.getElementById('order-customer-name');
  const orderNumberInput = document.getElementById('order-number-display');

  if (fileInput) fileInput.value = '';

  const fresh = resetOrder();
  if (customerNameInput) customerNameInput.value = '';
  if (orderNumberInput) orderNumberInput.textContent = fresh.orderNo;

  renderImageGallery();

  if (showNotification) {
    showToast('All images removed and order session reset.', 'info');
  }
}

// Backward compatibility alias for single image remove
export function removeUploadedImage(showNotification = true) {
  return clearAllImages(showNotification);
}

/**
 * Render Image Gallery UI cards
 */
export function renderImageGallery() {
  const galleryContainer = document.getElementById('image-gallery-container');
  const dropzone = document.getElementById('order-dropzone');
  const grid = document.getElementById('image-thumbnails-grid');
  const countEl = document.getElementById('gallery-image-count');

  if (!galleryContainer || !grid) return;

  if (uploadedImages.length === 0) {
    galleryContainer.classList.add('hidden');
    if (dropzone) dropzone.classList.remove('hidden');
    return;
  }

  galleryContainer.classList.remove('hidden');
  if (countEl) {
    countEl.textContent = `${uploadedImages.length} ${uploadedImages.length === 1 ? 'Image' : 'Images'}`;
  }

  grid.innerHTML = uploadedImages.map((img, idx) => {
    let statusBadge = '';
    if (img.status === 'completed') {
      statusBadge = `<span class="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-semibold">✓ ${img.extractedItems.length} Items</span>`;
    } else if (img.status === 'extracting') {
      statusBadge = `<span class="text-[10px] px-1.5 py-0.5 bg-sky-100 text-sky-800 rounded font-semibold animate-pulse">⏳ Reading...</span>`;
    } else if (img.status === 'error') {
      statusBadge = `
        <div class="flex items-center gap-1">
          <span class="text-[10px] px-1.5 py-0.5 bg-rose-100 text-rose-800 rounded font-semibold">✕ Failed</span>
          <button type="button" data-retry-img="${escapeHtml(img.id)}" class="text-[10px] text-sky-700 hover:text-sky-900 font-bold underline">Retry</button>
        </div>
      `;
    } else {
      statusBadge = `<span class="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded font-medium">Queued</span>`;
    }

    return `
      <div class="relative bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col group hover:shadow-md transition">
        <!-- Sequence Badge (#1, #2...) -->
        <div class="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 bg-slate-900/80 text-white rounded text-[10px] font-mono font-bold shadow-sm backdrop-blur-xs">
          #${idx + 1}
        </div>
        
        <!-- Delete Button -->
        <button type="button" data-remove-img="${escapeHtml(img.id)}" title="Remove this image" class="absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full bg-white/90 hover:bg-rose-600 hover:text-white text-slate-600 flex items-center justify-center text-xs font-bold shadow-sm transition border border-slate-200">
          ✕
        </button>

        <!-- Thumbnail Image -->
        <div class="h-24 bg-slate-900 flex items-center justify-center overflow-hidden">
          ${img.objectUrl ? `<img src="${img.objectUrl}" alt="Page ${idx + 1}" class="w-full h-full object-cover">` : `<div class="text-slate-400 text-xs">📷</div>`}
        </div>

        <!-- Info & Status -->
        <div class="p-2 space-y-1 bg-white">
          <div class="font-mono text-[10px] font-semibold text-slate-800 truncate" title="${escapeHtml(img.name)}">
            ${escapeHtml(img.name)}
          </div>
          <div class="flex items-center justify-between">
            ${statusBadge}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach Retry and Remove listeners
  grid.querySelectorAll('[data-remove-img]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.removeImg;
      removeImageById(id);
    });
  });

  grid.querySelectorAll('[data-retry-img]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.retryImg;
      retryImageExtraction(id);
    });
  });
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

  // Display first 15 sample rows (both Mobile Cards & Desktop Table)
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

  const sampleCardsContainer = document.getElementById('import-sample-cards');
  if (sampleCardsContainer) {
    sampleCardsContainer.innerHTML = '';
    const sampleSlice = validProducts.slice(0, 15);
    sampleSlice.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'bg-white rounded-lg border border-slate-200 p-3 text-xs space-y-1.5 shadow-xs';
      card.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <div class="font-bold text-slate-900 text-sm">${idx + 1}. ${escapeHtml(item.productName)}</div>
          <code class="font-mono font-bold text-[11px] text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">${escapeHtml(item.partNumber)}</code>
        </div>
        <div class="flex items-center justify-between text-slate-600 bg-slate-50 p-2 rounded border border-slate-100 text-xs">
          <div>Rack: <b class="text-slate-800">${escapeHtml(item.rack || '-')}</b></div>
          <div>Stock: <b class="text-slate-900">${item.stockQty}</b> ${escapeHtml(item.unit || 'Pcs.')}</div>
        </div>
      `;
      sampleCardsContainer.appendChild(card);
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
    <!-- Mobile Cards View (< 768px) -->
    <div class="responsive-card-view space-y-3 p-3 bg-slate-100/70">
      ${searchResult.items.map(p => `
        <div class="bg-white rounded-xl border-2 border-slate-800 p-4 shadow-md space-y-2.5">
          <!-- Part Number -->
          <div class="flex items-start justify-between gap-2 border-b border-slate-200 pb-2">
            <span class="font-extrabold text-slate-900 text-xs tracking-tight uppercase">Part Number</span>
            <code class="font-mono font-bold text-xs text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-300">${escapeHtml(p.partNumber)}</code>
          </div>

          <!-- Product Name / Description -->
          <div class="border-b border-slate-200 pb-2">
            <div class="font-extrabold text-slate-900 text-xs mb-1 uppercase tracking-tight">Product Name / Description</div>
            <div class="font-bold text-slate-900 text-sm leading-snug">${escapeHtml(p.productName)}</div>
          </div>

          <!-- Stock Qty -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Stock Qty</span>
            <span class="font-bold ${p.stockQty !== null && p.stockQty > 0 ? 'text-emerald-700 font-extrabold' : 'text-slate-700'}">${p.stockQty !== null && p.stockQty !== undefined ? p.stockQty : '—'}</span>
          </div>

          <!-- Unit -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Unit</span>
            <span class="font-bold text-slate-700">${escapeHtml(p.unit || '—')}</span>
          </div>

          <!-- MRP -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">MRP</span>
            <span class="font-extrabold text-slate-900">${p.rate !== null && p.rate !== undefined && p.rate !== '' ? `₹${Number(p.rate).toLocaleString('en-IN')}` : '—'}</span>
          </div>

          <!-- Rack Number -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Rack Number</span>
            <span class="font-bold text-slate-800 px-2 py-0.5 bg-slate-100 rounded border border-slate-200">${escapeHtml(p.rack || '—')}</span>
          </div>

          <!-- Action -->
          <div class="pt-1 flex items-center justify-between gap-2">
            <span class="font-extrabold text-slate-900 text-xs uppercase tracking-tight">Action</span>
            <button type="button" data-add-to-order="${escapeHtml(p.partNumber)}" class="px-4 py-2 bg-slate-900 hover:bg-slate-800 active:scale-95 text-white rounded-lg text-xs font-bold shadow transition flex items-center gap-1.5">
              <span>+ Add to Order</span>
            </button>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- Desktop Table View (>= 768px) -->
    <div class="responsive-table-view overflow-x-auto">
      <table class="w-full text-left text-xs border-collapse">
        <thead class="bg-slate-100 text-slate-700 font-bold sticky top-0 border-b border-slate-200">
          <tr>
            <th class="px-4 py-3">Part Number</th>
            <th class="px-4 py-3">Product Name / Description</th>
            <th class="px-4 py-3 text-center">Stock Qty</th>
            <th class="px-4 py-3 text-center">Unit</th>
            <th class="px-4 py-3 text-center">MRP</th>
            <th class="px-4 py-3 text-center">Rack Number</th>
            <th class="px-4 py-3 text-center">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 text-slate-700">
          ${searchResult.items.map(p => `
            <tr class="hover:bg-slate-50 transition-colors">
              <td class="px-4 py-3 font-mono font-bold text-slate-900">${escapeHtml(p.partNumber)}</td>
              <td class="px-4 py-3 font-medium text-slate-800 text-sm">${escapeHtml(p.productName)}</td>
              <td class="px-4 py-3 text-center font-bold ${p.stockQty !== null && p.stockQty > 0 ? 'text-emerald-600' : 'text-slate-600'}">${p.stockQty !== null && p.stockQty !== undefined ? p.stockQty : '—'}</td>
              <td class="px-4 py-3 text-center text-slate-500">${escapeHtml(p.unit || '—')}</td>
              <td class="px-4 py-3 text-center font-bold text-slate-900">${p.rate !== null && p.rate !== undefined && p.rate !== '' ? `₹${Number(p.rate).toLocaleString('en-IN')}` : '—'}</td>
              <td class="px-4 py-3 text-center"><span class="px-2 py-0.5 bg-slate-100 font-semibold rounded text-slate-700">${escapeHtml(p.rack || '—')}</span></td>
              <td class="px-4 py-3 text-center">
                <button type="button" data-add-to-order="${escapeHtml(p.partNumber)}" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded text-xs font-semibold shadow-sm transition">
                  + Add to Order
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
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
