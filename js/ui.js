/**
 * UI Components, Modals, Toast Notifications, and Table Renderers
 */

import {
  searchLocalProducts,
  searchExactPartNumber,
  extractPartNumberFromScannedText,
  isQRPayload,
  debounce
} from './productSearch.js';
import {
  getCurrentOrder,
  updateItemQuantity,
  updateItemProduct,
  updateItemCustomerText,
  removeOrderItem,
  rematchItem,
  getOrderSummary,
  addOrderItem,
  addOrUpdateOrderProduct,
  findExistingOrderItemByProduct,
  findExistingOrderItemsByProduct,
  getItemNumericRate,
  addNewOrderProduct
} from './orderManager.js';
import { generateBusyOrderPDF, generateBusyOrderPDFBlob } from './pdfGenerator.js';
import { generateBusyOrderExcel, generateBusyOrderExcelBlob } from './excelGenerator.js';
import { uploadOrUpdateDriveFile, openDriveFile } from './googleDriveService.js';
import { getShopStats } from './db.js';

let activeManualSelectItemId = null;

/**
 * Helper to format Item Details (Part Number + Product Name in one unified display)
 */
export function formatItemDetails(p) {
  if (!p) return '';
  if (p.itemDetails && p.itemDetails.trim()) {
    return `<span class="font-medium text-slate-900">${escapeHtml(p.itemDetails.trim())}</span>`;
  }
  const part = (p.partNumber || '').trim();
  const name = (p.productName || '').trim();
  if (!part && !name) return '—';
  if (!part) return escapeHtml(name);
  if (!name || part.toUpperCase() === name.toUpperCase()) {
    return `<span class="font-mono font-bold text-slate-900">${escapeHtml(part)}</span>`;
  }
  if (name.toUpperCase().startsWith(part.toUpperCase())) {
    return `<span class="font-medium text-slate-900">${escapeHtml(name)}</span>`;
  }
  return `<span class="font-mono font-bold text-slate-900 mr-1.5">${escapeHtml(part)}</span><span class="font-medium text-slate-800">${escapeHtml(name)}</span>`;
}

/**
 * Toast Notification System
 * Appears top-right on desktop, top-center on mobile.
 * Features auto-dismiss, manual dismiss, and distinct icons/colors.
 */
export function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'fixed top-4 right-4 left-4 sm:left-auto sm:right-5 sm:w-96 z-[9999] flex flex-col gap-2.5 pointer-events-none';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');

  const configs = {
    success: {
      card: 'bg-slate-900/95 text-white border-emerald-500/50 shadow-emerald-950/25',
      badge: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
      icon: '✓'
    },
    error: {
      card: 'bg-slate-900/95 text-white border-rose-500/50 shadow-rose-950/25',
      badge: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
      icon: '✕'
    },
    warning: {
      card: 'bg-slate-900/95 text-white border-amber-500/50 shadow-amber-950/25',
      badge: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
      icon: '⚠'
    },
    info: {
      card: 'bg-slate-900/95 text-white border-sky-500/50 shadow-sky-950/25',
      badge: 'bg-sky-500/20 text-sky-400 border border-sky-500/30',
      icon: 'ℹ'
    }
  };

  const cfg = configs[type] || configs.info;

  toast.className = `pointer-events-auto flex items-start gap-3 p-3 sm:p-3.5 rounded-xl border backdrop-blur-md shadow-xl text-xs sm:text-sm font-medium transform transition-all duration-300 -translate-y-2 opacity-0 ${cfg.card}`;

  let contentHtml = '';
  if (typeof message === 'object' && message !== null) {
    const mainTitle = message.title || message.message || '';
    const qtyVal = message.qty !== undefined && message.qty !== null ? message.qty : null;
    const rateVal = message.rate !== undefined && message.rate !== null ? message.rate : null;

    if (qtyVal !== null || rateVal !== null) {
      contentHtml = `
        <div class="flex-1 min-w-0 leading-snug pt-0.5">
          <div class="font-semibold text-white text-xs sm:text-sm leading-snug">${escapeHtml(String(mainTitle))}</div>
          <div class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs font-bold text-emerald-400 font-mono tracking-wide">
            ${qtyVal !== null ? `<span>QTY: ${escapeHtml(String(qtyVal))}</span>` : ''}
            ${rateVal !== null ? `<span>RATE: ${escapeHtml(String(rateVal))}</span>` : ''}
          </div>
        </div>
      `;
    } else {
      contentHtml = `<span class="flex-1 leading-snug break-words pt-0.5">${escapeHtml(String(mainTitle))}</span>`;
    }
  } else {
    const strMsg = String(message || '');
    if (strMsg.includes('\n')) {
      const lines = strMsg.split('\n').filter(Boolean);
      contentHtml = `
        <div class="flex-1 min-w-0 leading-snug pt-0.5">
          <div class="font-semibold text-white text-xs sm:text-sm leading-snug">${escapeHtml(lines[0] || '')}</div>
          ${lines.slice(1).map(l => `<div class="mt-1 text-xs font-bold text-emerald-400 font-mono tracking-wide">${escapeHtml(l)}</div>`).join('')}
        </div>
      `;
    } else {
      contentHtml = `<span class="flex-1 leading-snug break-words pt-0.5">${escapeHtml(strMsg)}</span>`;
    }
  }

  toast.innerHTML = `
    <span class="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs ${cfg.badge}">
      ${cfg.icon}
    </span>
    ${contentHtml}
    <button type="button" class="toast-close-btn flex-shrink-0 text-slate-400 hover:text-white transition p-1 -mr-1 -mt-1 rounded-md text-xs font-bold leading-none" aria-label="Dismiss notification">
      ✕
    </button>
  `;

  let dismissTimeout = null;
  const dismiss = () => {
    if (dismissTimeout) clearTimeout(dismissTimeout);
    toast.classList.add('opacity-0', '-translate-y-2');
    setTimeout(() => {
      try { toast.remove(); } catch (_) {}
    }, 250);
  };

  const closeBtn = toast.querySelector('.toast-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });
  }

  container.appendChild(toast);

  // Trigger entrance animation
  requestAnimationFrame(() => {
    toast.classList.remove('-translate-y-2', 'opacity-0');
  });

  if (duration && duration > 0) {
    dismissTimeout = setTimeout(dismiss, duration);
  }

  return { dismiss };
}

/**
 * Show an Accessible Confirmation Modal
 * Replaces native confirm() with an in-app dialog
 * @param {Object} options
 * @param {string} options.title - Modal title
 * @param {string} options.message - Confirmation prompt message
 * @param {string} [options.confirmText='Confirm'] - Confirm button label
 * @param {string} [options.cancelText='Cancel'] - Cancel button label
 * @param {'primary'|'danger'|'warning'|'info'} [options.type='primary'] - Modal visual style
 * @param {string} [options.icon] - Optional custom icon
 * @returns {Promise<boolean>} Resolves true if confirmed, false if cancelled
 */
export function showConfirmModal({
  title = 'Confirmation',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'primary',
  icon = null
} = {}) {
  return new Promise((resolve) => {
    const defaultIcons = {
      danger: '🗑',
      warning: '⚠',
      info: 'ℹ',
      primary: '✓'
    };
    const modalIcon = icon || defaultIcons[type] || '❓';

    const btnStyles = {
      danger: 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-900/20 ring-rose-500',
      warning: 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-900/20 ring-amber-500',
      info: 'bg-sky-600 hover:bg-sky-700 text-white shadow-sky-900/20 ring-sky-500',
      primary: 'bg-slate-900 hover:bg-slate-800 text-white shadow-slate-900/20 ring-slate-900'
    };

    const iconBadgeStyles = {
      danger: 'bg-rose-100 text-rose-700 border-rose-200',
      warning: 'bg-amber-100 text-amber-800 border-amber-200',
      info: 'bg-sky-100 text-sky-700 border-sky-200',
      primary: 'bg-slate-100 text-slate-800 border-slate-200'
    };

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[10000] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200 opacity-0';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    // Split multiline message into readable paragraphs
    const formattedMessage = message
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => `<p class="leading-relaxed">${escapeHtml(line)}</p>`)
      .join('<div class="h-2"></div>');

    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden transform transition-all duration-200 scale-95 opacity-0">
        <!-- Header -->
        <div class="p-5 border-b border-slate-100 bg-slate-50 flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold border shadow-xs ${iconBadgeStyles[type] || iconBadgeStyles.primary}">
              ${modalIcon}
            </div>
            <div>
              <h3 class="text-base font-extrabold text-slate-900 leading-tight">${escapeHtml(title)}</h3>
            </div>
          </div>
          <button type="button" class="modal-close-x text-slate-400 hover:text-slate-700 text-lg font-bold p-1 leading-none rounded-lg transition" aria-label="Close dialog">
            ✕
          </button>
        </div>

        <!-- Body Message -->
        <div class="p-5 text-sm text-slate-600 space-y-1">
          ${formattedMessage}
        </div>

        <!-- Footer Actions -->
        <div class="p-4 bg-slate-50 border-t border-slate-100 flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5">
          <button type="button" class="btn-cancel w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 active:bg-slate-200 font-bold text-xs sm:text-sm transition-all focus:outline-none focus:ring-2 focus:ring-slate-400">
            ${escapeHtml(cancelText)}
          </button>
          <button type="button" class="btn-confirm w-full sm:w-auto px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm shadow-md transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-1 ${btnStyles[type] || btnStyles.primary}">
            ${escapeHtml(confirmText)}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const dialogCard = overlay.firstElementChild;
    const btnConfirm = overlay.querySelector('.btn-confirm');
    const btnCancel = overlay.querySelector('.btn-cancel');
    const btnCloseX = overlay.querySelector('.modal-close-x');

    let isClosed = false;
    const finish = (result) => {
      if (isClosed) return;
      isClosed = true;
      document.removeEventListener('keydown', handleKeyDown);
      overlay.classList.add('opacity-0');
      if (dialogCard) {
        dialogCard.classList.add('scale-95', 'opacity-0');
      }
      setTimeout(() => {
        try { overlay.remove(); } catch (_) {}
      }, 200);
      resolve(result);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };

    btnConfirm.addEventListener('click', () => finish(true));
    btnCancel.addEventListener('click', () => finish(false));
    btnCloseX.addEventListener('click', () => finish(false));

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        finish(false);
      }
    });

    document.addEventListener('keydown', handleKeyDown);

    // Entrance animation & focus
    requestAnimationFrame(() => {
      overlay.classList.remove('opacity-0');
      if (dialogCard) {
        dialogCard.classList.remove('scale-95', 'opacity-0');
      }
      if (type === 'danger') {
        btnCancel.focus();
      } else {
        btnConfirm.focus();
      }
    });
  });
}

/**
 * Show an Accessible Prompt / Input Modal
 * Supports single field (returns string | null) or multiple fields (returns object | null)
 * @param {Object} options
 * @param {string} options.title - Modal title
 * @param {string} [options.message] - Optional instructions or label
 * @param {string} [options.label] - Field label for single input
 * @param {string} [options.value=''] - Initial value for single input
 * @param {string} [options.placeholder=''] - Placeholder for single input
 * @param {string} [options.inputType='text'] - Type for single input (text, number, etc.)
 * @param {Array<Object>} [options.fields] - Array of field objects { id, label, value, placeholder, type, required, min, max }
 * @param {string} [options.confirmText='Save'] - Confirm button label
 * @param {string} [options.cancelText='Cancel'] - Cancel button label
 * @param {string} [options.icon='✏'] - Icon for the modal
 * @returns {Promise<string | object | null>} Returns string or fields object on submit, or null on cancel
 */
export function showPromptModal({
  title = 'Input Required',
  message = '',
  label = '',
  value = '',
  placeholder = '',
  inputType = 'text',
  fields = null,
  confirmText = 'Save',
  cancelText = 'Cancel',
  icon = '✏'
} = {}) {
  return new Promise((resolve) => {
    const isMultiField = Array.isArray(fields) && fields.length > 0;

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[10000] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200 opacity-0';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    // Build form inputs HTML
    let inputsHtml = '';
    if (isMultiField) {
      inputsHtml = fields.map((f, idx) => {
        const inputAttrs = `
          id="prompt-field-${idx}"
          data-field-id="${escapeHtml(f.id)}"
          type="${f.type || 'text'}"
          ${f.inputmode ? `inputmode="${escapeHtml(f.inputmode)}"` : ''}
          value="${escapeHtml(String(f.value ?? ''))}"
          placeholder="${escapeHtml(f.placeholder || '')}"
          ${f.required ? 'required' : ''}
          ${f.min !== undefined ? `min="${f.min}"` : ''}
          ${f.max !== undefined ? `max="${f.max}"` : ''}
          ${f.step !== undefined ? `step="${f.step}"` : ''}
        `;

        if (f.prefix) {
          return `
            <div class="space-y-1">
              <label for="prompt-field-${idx}" class="block text-xs font-bold text-slate-700">
                ${escapeHtml(f.label || f.id)} ${f.required ? '<span class="text-rose-500">*</span>' : ''}
              </label>
              <div class="relative flex rounded-xl shadow-xs">
                <span class="inline-flex items-center px-3.5 rounded-l-xl border border-r-0 border-slate-300 bg-slate-100 text-slate-700 font-bold text-xs sm:text-sm select-none">${escapeHtml(f.prefix)}</span>
                <input
                  ${inputAttrs}
                  class="prompt-input-el w-full text-xs sm:text-sm px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-r-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none transition-all font-medium"
                />
              </div>
            </div>
          `;
        }

        return `
          <div class="space-y-1">
            <label for="prompt-field-${idx}" class="block text-xs font-bold text-slate-700">
              ${escapeHtml(f.label || f.id)} ${f.required ? '<span class="text-rose-500">*</span>' : ''}
            </label>
            <input
              ${inputAttrs}
              class="prompt-input-el w-full text-xs sm:text-sm px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none transition-all font-medium"
            />
          </div>
        `;
      }).join('');
    } else {
      inputsHtml = `
        <div class="space-y-1">
          ${label ? `<label for="prompt-single-input" class="block text-xs font-bold text-slate-700">${escapeHtml(label)}</label>` : ''}
          <input
            id="prompt-single-input"
            type="${inputType || 'text'}"
            value="${escapeHtml(String(value ?? ''))}"
            placeholder="${escapeHtml(placeholder || '')}"
            class="prompt-input-el w-full text-xs sm:text-sm px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none transition-all"
          />
        </div>
      `;
    }

    const messageHtml = message ? `
      <div class="text-xs sm:text-sm text-slate-500 mb-3">
        ${escapeHtml(message)}
      </div>
    ` : '';

    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden transform transition-all duration-200 scale-95 opacity-0">
        <!-- Header -->
        <div class="p-5 border-b border-slate-100 bg-slate-50 flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold border border-slate-200 bg-white text-slate-800 shadow-xs">
              ${icon}
            </div>
            <div>
              <h3 class="text-base font-extrabold text-slate-900 leading-tight">${escapeHtml(title)}</h3>
            </div>
          </div>
          <button type="button" class="modal-close-x text-slate-400 hover:text-slate-700 text-lg font-bold p-1 leading-none rounded-lg transition" aria-label="Close dialog">
            ✕
          </button>
        </div>

        <!-- Form Body -->
        <form class="prompt-form p-5 space-y-3">
          ${messageHtml}
          ${inputsHtml}
          <div id="prompt-error-msg" class="hidden text-xs font-semibold text-rose-600"></div>
        </form>

        <!-- Footer Actions -->
        <div class="p-4 bg-slate-50 border-t border-slate-100 flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5">
          <button type="button" class="btn-cancel w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 active:bg-slate-200 font-bold text-xs sm:text-sm transition-all focus:outline-none focus:ring-2 focus:ring-slate-400">
            ${escapeHtml(cancelText)}
          </button>
          <button type="button" class="btn-submit w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs sm:text-sm shadow-md transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-1">
            ${escapeHtml(confirmText)}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const dialogCard = overlay.firstElementChild;
    const form = overlay.querySelector('.prompt-form');
    const btnSubmit = overlay.querySelector('.btn-submit');
    const btnCancel = overlay.querySelector('.btn-cancel');
    const btnCloseX = overlay.querySelector('.modal-close-x');
    const errorEl = overlay.querySelector('#prompt-error-msg');
    const inputEls = Array.from(overlay.querySelectorAll('.prompt-input-el'));

    let isClosed = false;
    const finish = (result) => {
      if (isClosed) return;
      isClosed = true;
      document.removeEventListener('keydown', handleKeyDown);
      overlay.classList.add('opacity-0');
      if (dialogCard) {
        dialogCard.classList.add('scale-95', 'opacity-0');
      }
      setTimeout(() => {
        try { overlay.remove(); } catch (_) {}
      }, 200);
      resolve(result);
    };

    const handleSubmit = () => {
      if (isMultiField) {
        const res = {};
        for (const input of inputEls) {
          const fieldId = input.dataset.fieldId;
          const fieldDef = fields.find(f => f.id === fieldId);
          const val = input.value.trim();
          if (fieldDef && fieldDef.required && !val) {
            if (errorEl) {
              errorEl.textContent = `Please enter ${fieldDef.label || fieldDef.id}.`;
              errorEl.classList.remove('hidden');
            }
            input.focus();
            return;
          }
          res[fieldId] = input.value;
        }
        finish(res);
      } else {
        const val = inputEls[0] ? inputEls[0].value : '';
        finish(val);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Enter' && e.target.classList.contains('prompt-input-el')) {
        e.preventDefault();
        handleSubmit();
      }
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSubmit();
    });
    btnSubmit.addEventListener('click', handleSubmit);
    btnCancel.addEventListener('click', () => finish(null));
    btnCloseX.addEventListener('click', () => finish(null));

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        finish(null);
      }
    });

    document.addEventListener('keydown', handleKeyDown);

    // Entrance animation & focus
    requestAnimationFrame(() => {
      overlay.classList.remove('opacity-0');
      if (dialogCard) {
        dialogCard.classList.remove('scale-95', 'opacity-0');
      }
      if (inputEls[0]) {
        inputEls[0].focus();
        if (typeof inputEls[0].select === 'function') {
          inputEls[0].select();
        }
      }
    });
  });
}

/**
 * Show an Accessible Alert Modal (user acknowledgment)
 * Replaces native alert() when explicit user dismissal is required
 * @param {Object} options
 * @param {string} options.title - Modal title
 * @param {string} options.message - Alert message
 * @param {string} [options.buttonText='OK'] - Dismiss button label
 * @param {'info'|'warning'|'error'|'success'} [options.type='info'] - Modal type
 * @param {string} [options.icon] - Optional icon
 * @returns {Promise<void>} Resolves when dismissed
 */
export function showAlertModal({
  title = 'Notice',
  message = '',
  buttonText = 'OK',
  type = 'info',
  icon = null
} = {}) {
  return new Promise((resolve) => {
    const defaultIcons = {
      error: '✕',
      warning: '⚠',
      info: 'ℹ',
      success: '✓'
    };
    const modalIcon = icon || defaultIcons[type] || 'ℹ';

    const btnStyles = {
      error: 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-900/20',
      warning: 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-900/20',
      info: 'bg-slate-900 hover:bg-slate-800 text-white shadow-slate-900/20',
      success: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-900/20'
    };

    const iconBadgeStyles = {
      error: 'bg-rose-100 text-rose-700 border-rose-200',
      warning: 'bg-amber-100 text-amber-800 border-amber-200',
      info: 'bg-sky-100 text-sky-700 border-sky-200',
      success: 'bg-emerald-100 text-emerald-800 border-emerald-200'
    };

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[10000] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200 opacity-0';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');

    const formattedMessage = message
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => `<p class="leading-relaxed">${escapeHtml(line)}</p>`)
      .join('<div class="h-2"></div>');

    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden transform transition-all duration-200 scale-95 opacity-0">
        <!-- Header -->
        <div class="p-5 border-b border-slate-100 bg-slate-50 flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold border shadow-xs ${iconBadgeStyles[type] || iconBadgeStyles.info}">
              ${modalIcon}
            </div>
            <div>
              <h3 class="text-base font-extrabold text-slate-900 leading-tight">${escapeHtml(title)}</h3>
            </div>
          </div>
          <button type="button" class="modal-close-x text-slate-400 hover:text-slate-700 text-lg font-bold p-1 leading-none rounded-lg transition" aria-label="Close dialog">
            ✕
          </button>
        </div>

        <!-- Body Message -->
        <div class="p-5 text-sm text-slate-600 space-y-1">
          ${formattedMessage}
        </div>

        <!-- Footer Actions -->
        <div class="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end">
          <button type="button" class="btn-dismiss w-full sm:w-auto px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm shadow-md transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-1 ${btnStyles[type] || btnStyles.info}">
            ${escapeHtml(buttonText)}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const dialogCard = overlay.firstElementChild;
    const btnDismiss = overlay.querySelector('.btn-dismiss');
    const btnCloseX = overlay.querySelector('.modal-close-x');

    let isClosed = false;
    const finish = () => {
      if (isClosed) return;
      isClosed = true;
      document.removeEventListener('keydown', handleKeyDown);
      overlay.classList.add('opacity-0');
      if (dialogCard) {
        dialogCard.classList.add('scale-95', 'opacity-0');
      }
      setTimeout(() => {
        try { overlay.remove(); } catch (_) {}
      }, 200);
      resolve();
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        finish();
      }
    };

    btnDismiss.addEventListener('click', finish);
    btnCloseX.addEventListener('click', finish);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        finish();
      }
    });

    document.addEventListener('keydown', handleKeyDown);

    requestAnimationFrame(() => {
      overlay.classList.remove('opacity-0');
      if (dialogCard) {
        dialogCard.classList.remove('scale-95', 'opacity-0');
      }
      btnDismiss.focus();
    });
  });
}

/**
 * Confirmation modal when adding a duplicate product with a different rate/MRP
 * @param {Object} options
 * @param {number|string|null} options.existingRate
 * @param {number|string|null} options.newRate
 * @param {string} [options.partNumber]
 * @returns {Promise<boolean>} Resolves true if Continue, false if Cancel
 */
export function showDifferentRateConfirmModal({ existingRate, newRate, partNumber = '' }) {
  return new Promise((resolve) => {
    const existingRateStr = (existingRate !== null && existingRate !== undefined && existingRate !== '')
      ? `₹${Number(existingRate).toLocaleString('en-IN')}`
      : '—';
    const newRateStr = (newRate !== null && newRate !== undefined && newRate !== '')
      ? `₹${Number(newRate).toLocaleString('en-IN')}`
      : '—';

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[10020] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200 opacity-0';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden transform transition-all duration-200 scale-95 opacity-0">
        <!-- Header -->
        <div class="p-5 border-b border-slate-100 bg-slate-50 flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold border border-amber-300 bg-amber-50 text-amber-600 shadow-xs">
              ⚠
            </div>
            <div>
              <h3 class="text-base font-extrabold text-slate-900 leading-tight">Product already added.</h3>
              <p class="text-xs text-slate-500 mt-0.5">Different MRP detected for this item</p>
            </div>
          </div>
          <button type="button" class="modal-close-x text-slate-400 hover:text-slate-700 text-lg font-bold p-1 leading-none rounded-lg transition" aria-label="Close dialog">
            ✕
          </button>
        </div>

        <!-- Body Message -->
        <div class="p-5 space-y-3.5">
          <p class="text-xs sm:text-sm text-slate-700 leading-relaxed font-medium">
            Do you want to add this product with a different MRP?
          </p>

          <div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
            ${partNumber ? `
              <div class="flex items-center justify-between text-xs pb-2 border-b border-slate-200">
                <span class="text-slate-500 font-bold uppercase tracking-tight text-[11px]">Part Number</span>
                <span class="font-mono font-black text-slate-800">${escapeHtml(partNumber)}</span>
              </div>
            ` : ''}
            <div class="flex items-center justify-between py-0.5 text-xs sm:text-sm">
              <span class="text-slate-600 font-bold">Existing Rate:</span>
              <span class="font-mono font-extrabold text-slate-800">${escapeHtml(existingRateStr)}</span>
            </div>
            <div class="flex items-center justify-between py-0.5 text-xs sm:text-sm">
              <span class="text-slate-600 font-bold">New Rate:</span>
              <span class="font-mono font-extrabold text-emerald-600 text-sm sm:text-base">${escapeHtml(newRateStr)}</span>
            </div>
          </div>
        </div>

        <!-- Footer Actions: [Cancel] [Continue] -->
        <div class="p-4 bg-slate-50 border-t border-slate-100 flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5">
          <button type="button" class="btn-cancel w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 active:bg-slate-200 font-bold text-xs sm:text-sm transition-all focus:outline-none focus:ring-2 focus:ring-slate-400">
            Cancel
          </button>
          <button type="button" class="btn-continue w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs sm:text-sm shadow-md transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-1 flex items-center justify-center gap-1.5">
            <span>Continue</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const dialogCard = overlay.firstElementChild;
    const btnContinue = overlay.querySelector('.btn-continue');
    const btnCancel = overlay.querySelector('.btn-cancel');
    const btnCloseX = overlay.querySelector('.modal-close-x');

    let isClosed = false;
    const finish = (result) => {
      if (isClosed) return;
      isClosed = true;
      document.removeEventListener('keydown', handleKeyDown);
      overlay.classList.add('opacity-0');
      if (dialogCard) {
        dialogCard.classList.add('scale-95', 'opacity-0');
      }
      setTimeout(() => {
        try { overlay.remove(); } catch (_) {}
      }, 200);
      resolve(result);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    btnContinue.addEventListener('click', () => finish(true));
    btnCancel.addEventListener('click', () => finish(false));
    btnCloseX.addEventListener('click', () => finish(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });

    requestAnimationFrame(() => {
      overlay.classList.remove('opacity-0');
      if (dialogCard) {
        dialogCard.classList.remove('scale-95', 'opacity-0');
      }
      btnContinue.focus();
    });
  });
}

/**
 * Small pre-confirmation modal displayed when the user attempts to add a product
 * that already exists in the current order (matched strictly by unique Part Number or ID).
 *
 * Title: Product Already in Order
 * Message: "This product is already added to your order. Would you like to update its quantity and rate?"
 * Buttons: [No, Keep Current]    [Yes, Update]
 *
 * @param {Object} product - Product record
 * @returns {Promise<boolean>} Resolves true if "Yes, Update", false if "No, Keep Current" or closed
 */
export function showProductAlreadyInOrderModal(product) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[10020] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200 opacity-0';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden transform transition-all duration-200 scale-95 opacity-0">
        <!-- Header -->
        <div class="p-5 border-b border-slate-100 bg-slate-50 flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold border border-slate-200 bg-white text-slate-800 shadow-xs">
              ℹ️
            </div>
            <div>
              <h3 class="text-base font-extrabold text-slate-900 leading-tight">Product Already in Order</h3>
            </div>
          </div>
          <button type="button" class="modal-close-x text-slate-400 hover:text-slate-700 text-lg font-bold p-1 leading-none rounded-lg transition" aria-label="Close dialog">
            ✕
          </button>
        </div>

        <!-- Body Message (Clean, simple, no Quantity or Rate fields) -->
        <div class="p-5">
          <p class="text-xs sm:text-sm text-slate-700 leading-relaxed font-medium">
            This product is already added to your order. Would you like to update its quantity and rate?
          </p>
        </div>

        <!-- Footer Actions: [No, Keep Current] [Yes, Update] -->
        <div class="p-4 bg-slate-50 border-t border-slate-100 flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5">
          <button type="button" class="btn-cancel w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 active:bg-slate-200 font-bold text-xs sm:text-sm transition-all focus:outline-none focus:ring-2 focus:ring-slate-400">
            No, Keep Current
          </button>
          <button type="button" class="btn-confirm w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs sm:text-sm shadow-md transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-1 flex items-center justify-center gap-1.5">
            <span>Yes, Update</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const dialogCard = overlay.firstElementChild;
    const btnConfirm = overlay.querySelector('.btn-confirm');
    const btnCancel = overlay.querySelector('.btn-cancel');
    const btnCloseX = overlay.querySelector('.modal-close-x');

    let isClosed = false;
    const finish = (result) => {
      if (isClosed) return;
      isClosed = true;
      document.removeEventListener('keydown', handleKeyDown);
      overlay.classList.add('opacity-0');
      if (dialogCard) {
        dialogCard.classList.add('scale-95', 'opacity-0');
      }
      setTimeout(() => {
        try { overlay.remove(); } catch (_) {}
        resolve(result);
      }, 200);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    btnConfirm.addEventListener('click', () => finish(true));
    btnCancel.addEventListener('click', () => finish(false));
    btnCloseX.addEventListener('click', () => finish(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });

    requestAnimationFrame(() => {
      overlay.classList.remove('opacity-0');
      if (dialogCard) {
        dialogCard.classList.remove('scale-95', 'opacity-0');
      }
      setTimeout(() => {
        if (btnConfirm) btnConfirm.focus();
      }, 50);
    });
  });
}

/**
 * Add to Order Modal
 * Displays ONLY:
 * - Part Number / Product information
 * - Quantity: [editable, single field]
 * - Rate: [editable, single field, pre-filled from product's existing rate/mrp]
 * - [Cancel] [Add to Order]
 *
 * Strictly NO duplicate MRP or Rate anywhere else in the modal.
 * No Old Rate, Old MRP, Current Rate, or New Rate fields.
 * If the selected product already exists in current order, updates the existing entry.
 *
 * @param {Object} product - Product master record
 * @returns {Promise<Object|null>}
 */
export async function showAddToOrderModal(product) {
  if (!product) return null;

  // STEP 1 — DUPLICATE PRODUCT CONFIRMATION
  // Determine whether the product already exists in the order using the existing unique Product ID / Part Number.
  // Do NOT compare product description text.
  const existingMatches = findExistingOrderItemsByProduct(product);
  if (existingMatches && existingMatches.length > 0) {
    const shouldUpdate = await showProductAlreadyInOrderModal(product);
    if (!shouldUpdate) {
      // IF USER CLICKS "NO, KEEP CURRENT":
      // Close the confirmation modal.
      // Do NOT open the Add to Order quantity/rate modal.
      // Do NOT change quantity.
      // Do NOT change rate.
      // Do NOT add a duplicate product.
      // Return the user to the existing Order screen/state.
      // No success toast should be shown.
      return null;
    }
  }

  // IF USER CLICKS "YES, UPDATE" OR IT IS A NEW PRODUCT:
  // Open the EXISTING Add to Order modal exactly as it currently appears.
  return new Promise((resolve) => {
    const existingItem = findExistingOrderItemByProduct(product);

    // Quantity: single editable field, prefilled with 1.000 or existing entry quantity
    let initialQtyStr = '1.000';
    if (existingItem && existingItem.quantity !== undefined && existingItem.quantity !== null) {
      const numQ = Number(existingItem.quantity);
      initialQtyStr = !isNaN(numQ) ? numQ.toFixed(3) : String(existingItem.quantity);
    }

    // Rate: single editable field, prefilled from selected product's existing data (or existing entry)
    let initialRateStr = '';
    const existingRateVal = existingItem
      ? (existingItem.rate ?? existingItem.matchedProduct?.rate ?? product.rate ?? product.mrp ?? '')
      : (product.rate ?? product.mrp ?? '');

    if (existingRateVal !== null && existingRateVal !== undefined && existingRateVal !== '') {
      const numR = Number(existingRateVal);
      initialRateStr = !isNaN(numR) ? String(numR) : String(existingRateVal);
    }

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[10000] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-200 opacity-0';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    overlay.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden transform transition-all duration-200 scale-95 opacity-0">
        <!-- Header -->
        <div class="p-5 border-b border-slate-100 bg-slate-50 flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold border border-slate-200 bg-white text-slate-900 shadow-xs">
              ➕
            </div>
            <div>
              <h3 class="text-base font-extrabold text-slate-900 leading-tight">Add to Order</h3>
              <p class="text-xs text-slate-500 mt-0.5">${existingItem ? 'Product already in order — update quantity & rate' : 'Enter quantity and rate for this item'}</p>
            </div>
          </div>
          <button type="button" class="modal-close-x text-slate-400 hover:text-slate-700 text-lg font-bold p-1 leading-none rounded-lg transition" aria-label="Close dialog">
            ✕
          </button>
        </div>

        <!-- Form Body -->
        <form class="add-to-order-form p-5 space-y-4">
          <!-- Part Number / Product information (No duplicate MRP or Old/New Rate fields) -->
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
            <div class="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
              <span class="text-[11px] font-extrabold uppercase tracking-tight text-slate-500">Part Number</span>
              <span class="font-mono font-black text-slate-900 text-xs sm:text-sm px-2 py-0.5 bg-white rounded border border-slate-200">${escapeHtml(product.partNumber || '—')}</span>
            </div>
            <div>
              <span class="text-[11px] font-extrabold uppercase tracking-tight text-slate-500 block mb-0.5">Product Description</span>
              <div class="font-bold text-slate-800 text-xs sm:text-sm leading-snug">${escapeHtml(product.productName || product.itemDetails || '—')}</div>
            </div>
            ${(product.rack || product.unit) ? `
              <div class="flex items-center justify-between gap-2 pt-1 border-t border-slate-200 text-xs">
                ${product.rack ? `<span class="text-slate-500 font-medium">Rack: <b class="text-slate-800">${escapeHtml(product.rack)}</b></span>` : '<span></span>'}
                ${product.unit ? `<span class="text-slate-500 font-medium">Unit: <b class="text-slate-800">${escapeHtml(product.unit)}</b></span>` : '<span></span>'}
              </div>
            ` : ''}
          </div>

          <!-- Quantity: ONLY ONE Field -->
          <div class="space-y-1">
            <label for="add-to-order-qty" class="block text-xs font-bold text-slate-700">
              Quantity <span class="text-rose-500">*</span>
            </label>
            <input
              id="add-to-order-qty"
              type="text"
              inputmode="decimal"
              value="${escapeHtml(initialQtyStr)}"
              placeholder="1.000"
              required
              class="add-to-order-input w-full text-xs sm:text-sm px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-bold focus:bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none transition-all"
            />
          </div>

          <!-- Rate: ONLY ONE Field -->
          <div class="space-y-1">
            <label for="add-to-order-rate" class="block text-xs font-bold text-slate-700">
              Rate <span class="text-rose-500">*</span>
            </label>
            <div class="relative flex rounded-xl shadow-xs">
              <span class="inline-flex items-center px-3.5 rounded-l-xl border border-r-0 border-slate-300 bg-slate-100 text-slate-700 font-bold text-xs sm:text-sm select-none">₹</span>
              <input
                id="add-to-order-rate"
                type="text"
                inputmode="decimal"
                value="${escapeHtml(initialRateStr)}"
                placeholder="0.00"
                required
                class="add-to-order-input w-full text-xs sm:text-sm px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-r-xl text-slate-900 font-bold focus:bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none transition-all"
              />
            </div>
          </div>

          <div id="add-to-order-error" class="hidden text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-2.5"></div>
        </form>

        <!-- Footer Actions: [Cancel] [Add to Order] -->
        <div class="p-4 bg-slate-50 border-t border-slate-100 flex flex-col-reverse sm:flex-row items-center justify-end gap-2.5">
          <button type="button" class="btn-cancel w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 active:bg-slate-200 font-bold text-xs sm:text-sm transition-all focus:outline-none focus:ring-2 focus:ring-slate-400">
            Cancel
          </button>
          <button type="button" class="btn-submit w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs sm:text-sm shadow-md transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-1 flex items-center justify-center gap-1.5">
            <span>Add to Order</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const dialogCard = overlay.firstElementChild;
    const form = overlay.querySelector('.add-to-order-form');
    const qtyInput = overlay.querySelector('#add-to-order-qty');
    const rateInput = overlay.querySelector('#add-to-order-rate');
    const btnSubmit = overlay.querySelector('.btn-submit');
    const btnCancel = overlay.querySelector('.btn-cancel');
    const btnCloseX = overlay.querySelector('.modal-close-x');
    const errorEl = overlay.querySelector('#add-to-order-error');

    let isClosed = false;
    const finish = (result) => {
      if (isClosed) return;
      isClosed = true;
      document.removeEventListener('keydown', handleKeyDown);
      overlay.classList.add('opacity-0');
      if (dialogCard) {
        dialogCard.classList.add('scale-95', 'opacity-0');
      }
      setTimeout(() => {
        try { overlay.remove(); } catch (_) {}
      }, 200);
      resolve(result);
    };

    const handleSubmit = async () => {
      // Validate Quantity
      const rawQty = qtyInput.value.replace(/[^0-9.]/g, '').trim();
      const numQty = parseFloat(rawQty);
      if (!rawQty || isNaN(numQty) || numQty <= 0) {
        if (errorEl) {
          errorEl.textContent = 'Please enter a valid quantity greater than 0.';
          errorEl.classList.remove('hidden');
        }
        qtyInput.focus();
        qtyInput.select();
        return;
      }

      // Validate Rate
      const rawRate = rateInput.value.replace(/[^0-9.]/g, '').trim();
      let finalRate = null;
      if (rawRate !== '') {
        const numRate = parseFloat(rawRate);
        if (isNaN(numRate) || numRate < 0) {
          if (errorEl) {
            errorEl.textContent = 'Please enter a valid non-negative rate.';
            errorEl.classList.remove('hidden');
          }
          rateInput.focus();
          rateInput.select();
          return;
        }
        finalRate = numRate;
      } else {
        // Fallback to product's rate/mrp if available
        finalRate = (product.rate !== null && product.rate !== undefined && product.rate !== '')
          ? Number(product.rate)
          : (product.mrp ? Number(product.mrp) : null);
      }

      // Check whether SAME PRODUCT / SAME PART NUMBER already exists in current order
      const matchingItems = findExistingOrderItemsByProduct(product);
      let targetItem = null;

      if (matchingItems.length > 0) {
        // CASE 2 & 3: Compare existing order item's numeric Rate/MRP with the NEW Rate
        const sameRateItem = matchingItems.find(item => {
          const itemRate = getItemNumericRate(item);
          if (itemRate === null && finalRate === null) return true;
          if (itemRate !== null && finalRate !== null) {
            return Math.abs(itemRate - finalRate) < 0.0001;
          }
          return false;
        });

        if (sameRateItem) {
          // CASE 3 — SAME PRODUCT + SAME RATE:
          // DO NOT show the "different MRP" confirmation. Update entry in-place.
          const result = addOrUpdateOrderProduct(product, numQty, finalRate);
          targetItem = result ? result.item : sameRateItem;
        } else {
          // CASE 2 — SAME PRODUCT + DIFFERENT RATE:
          // Show confirmation modal BEFORE adding it.
          const existingRate = getItemNumericRate(matchingItems[matchingItems.length - 1]);

          const confirmed = await showDifferentRateConfirmModal({
            existingRate,
            newRate: finalRate,
            partNumber: product.partNumber || ''
          });

          if (!confirmed) {
            // IF USER CLICKS "CANCEL":
            // Do NOT add the product.
            // Close confirmation modal and return to Add to Order flow without changing existing order.
            return;
          }

          // IF USER CLICKS "CONTINUE":
          // Allow product to be added with the new rate. Keep existing entry and add new entry with different rate.
          targetItem = addNewOrderProduct(product, numQty, finalRate);
        }
      } else {
        // CASE 1 — Product is NOT already in the order:
        // Continue with the existing behavior normally.
        targetItem = addNewOrderProduct(product, numQty, finalRate);
      }

      renderOrderTable();

      const savedItem = targetItem;
      const prodLabel = product.productName || product.itemDetails || product.partNumber || 'Product';
      const savedQty = savedItem ? savedItem.quantity : numQty;
      const savedRate = savedItem ? (savedItem.rate ?? savedItem.matchedProduct?.rate ?? finalRate) : finalRate;

      const formattedQty = (Number.isInteger(savedQty) ? savedQty : Number(savedQty.toFixed(3)));
      const formattedRate = (savedRate !== null && savedRate !== undefined && savedRate !== '')
        ? `₹${Number(savedRate).toLocaleString('en-IN')}`
        : '—';

      showToast({
        title: `Added "${prodLabel}" to order`,
        qty: formattedQty,
        rate: formattedRate
      }, 'success');

      finish(savedItem);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSubmit();
    });
    btnSubmit.addEventListener('click', handleSubmit);
    btnCancel.addEventListener('click', () => finish(null));
    btnCloseX.addEventListener('click', () => finish(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });

    requestAnimationFrame(() => {
      overlay.classList.remove('opacity-0');
      if (dialogCard) {
        dialogCard.classList.remove('scale-95', 'opacity-0');
      }
      setTimeout(() => {
        qtyInput.focus();
        qtyInput.select();
      }, 50);
    });
  });
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

  // Update PDF / Excel export button states
  updateExportButtonState();

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

    // 1. DESKTOP VIEW: Table Row (Single Unified Item Details Column)
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
        <td class="px-3 py-3 min-w-[260px]">
          ${item.matchedProduct ? `
            <div class="font-bold text-slate-900 text-sm leading-snug">${formatItemDetails(item.matchedProduct)}</div>
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
            <div class="text-xs font-medium ${isLowStock ? 'text-amber-600 font-bold' : 'text-slate-700'}">
              ${stockQty !== null && stockQty !== undefined ? stockQty : '—'}
            </div>
            ${isLowStock ? `<div class="text-[10px] text-amber-600 font-semibold">(Stock &lt; Ord)</div>` : ''}
          ` : `<span class="text-slate-400 text-xs">—</span>`}
        </td>
        <td class="px-3 py-3 text-center text-xs text-slate-600">
          ${item.matchedProduct && item.matchedProduct.unit ? escapeHtml(item.matchedProduct.unit) : '<span class="text-slate-400 text-xs">—</span>'}
        </td>
        <td class="px-3 py-3 text-center text-xs font-bold text-slate-900">
          ${(() => {
            const r = (item.rate !== null && item.rate !== undefined && item.rate !== '')
              ? item.rate
              : (item.matchedProduct && item.matchedProduct.rate !== null && item.matchedProduct.rate !== undefined && item.matchedProduct.rate !== '' ? item.matchedProduct.rate : null);
            return (r !== null && r !== undefined && r !== '') ? `₹${Number(r).toLocaleString('en-IN')}` : '<span class="text-slate-400 text-xs">—</span>';
          })()}
        </td>
        <td class="px-3 py-3 text-center">
          ${item.matchedProduct && item.matchedProduct.rack ? `
            <span class="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs font-semibold">${escapeHtml(item.matchedProduct.rack)}</span>
          ` : `<span class="text-slate-400 text-xs">—</span>`}
        </td>
        <td class="px-3 py-3 text-center">
          ${item.matchedProduct && (item.matchedProduct.parentGroup || item.matchedProduct.group) ? `
            <span class="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs font-semibold">${escapeHtml(item.matchedProduct.parentGroup || item.matchedProduct.group)}</span>
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

    // 2. MOBILE VIEW: Responsive Card (Exact Labeled Format with Unified Item Details)
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

        <!-- Item Details (Matched from Original Stock) -->
        <div class="border-b border-slate-200 pb-2">
          <div class="font-extrabold text-slate-900 text-xs mb-1 uppercase tracking-tight">Item Details (Matched from Original Stock)</div>
          ${item.matchedProduct ? `
            <div class="font-bold text-slate-900 text-sm leading-snug">${formatItemDetails(item.matchedProduct)}</div>
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
          <!-- Stock Qty -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Stock Qty</span>
            <div class="text-right">
              <span class="font-bold ${isLowStock ? 'text-amber-600 font-extrabold' : 'text-slate-800'}">
                ${stockQty !== null && stockQty !== undefined ? stockQty : '—'}
              </span>
              ${isLowStock ? `<span class="block text-[10px] text-amber-600 font-bold">(Stock &lt; Ord)</span>` : ''}
            </div>
          </div>

          <!-- Unit -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Unit</span>
            <span class="font-bold text-slate-700">${escapeHtml(item.matchedProduct.unit || '—')}</span>
          </div>

          <!-- MRP -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">MRP</span>
            <span class="font-extrabold text-slate-900">${(() => {
              const r = (item.rate !== null && item.rate !== undefined && item.rate !== '')
                ? item.rate
                : (item.matchedProduct && item.matchedProduct.rate !== null && item.matchedProduct.rate !== undefined && item.matchedProduct.rate !== '' ? item.matchedProduct.rate : null);
              return (r !== null && r !== undefined && r !== '') ? `₹${Number(r).toLocaleString('en-IN')}` : '—';
            })()}</span>
          </div>

          <!-- Rack Location -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Rack Location</span>
            <span class="font-bold text-slate-800 px-2 py-0.5 bg-slate-100 rounded border border-slate-200">${escapeHtml(item.matchedProduct.rack || '—')}</span>
          </div>

          <!-- Group -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Group</span>
            <span class="font-bold text-slate-800 px-2 py-0.5 bg-slate-100 rounded border border-slate-200">${escapeHtml(item.matchedProduct.parentGroup || item.matchedProduct.group || '—')}</span>
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
export async function performManualModalSearch(query, isExactScanner = false) {
  const resultsContainer = document.getElementById('manual-search-results');
  const countBadge = document.getElementById('manual-search-count');
  if (!resultsContainer) return;

  resultsContainer.innerHTML = `
    <div class="py-12 text-center text-slate-400 text-sm">
      <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-slate-700 mb-2"></div>
      <div>Searching local product master...</div>
    </div>
  `;

  const searchResult = isExactScanner
    ? await searchExactPartNumber(query)
    : await searchLocalProducts(query, 50);

  if (countBadge) {
    if (isExactScanner) {
      countBadge.textContent = `${searchResult.total} exact match${searchResult.total === 1 ? '' : 'es'}`;
    } else {
      countBadge.textContent = `${searchResult.total} matches found`;
    }
  }

  if (searchResult.items.length === 0) {
    resultsContainer.innerHTML = `
      <div class="py-12 text-center text-slate-500">
        <div class="text-3xl mb-2">📦</div>
        <div class="font-bold text-slate-800 text-base">${isExactScanner ? 'No exact part number found.' : 'No matching products found in local master'}</div>
        <div class="text-xs text-slate-400 mt-1">${isExactScanner ? `No product with Part Number "${escapeHtml(query)}" in master` : 'Try searching with partial words, part number, or rack number'}</div>
      </div>
    `;
    return;
  }

  resultsContainer.innerHTML = `
    <!-- Mobile Cards View (< 768px) -->
    <div class="responsive-card-view space-y-3 p-3 bg-slate-100/70">
      ${searchResult.items.map(product => `
        <div data-select-part="${escapeHtml(product.partNumber)}" class="bg-white rounded-xl border-2 border-slate-800 p-4 shadow-md space-y-2.5 hover:bg-sky-50/50 transition cursor-pointer">
          <!-- Item Details -->
          <div class="border-b border-slate-200 pb-2">
            <div class="font-extrabold text-slate-900 text-xs mb-1 uppercase tracking-tight">Item Details</div>
            <div class="font-bold text-slate-900 text-sm leading-snug">${formatItemDetails(product)}</div>
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
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Rack</span>
            <span class="font-bold text-slate-800 px-2 py-0.5 bg-slate-100 rounded border border-slate-200">${escapeHtml(product.rack || '—')}</span>
          </div>

          <!-- Group -->
          <div class="flex items-center justify-between border-b border-slate-200 pb-2 text-xs">
            <span class="font-extrabold text-slate-900 uppercase tracking-tight">Group</span>
            <span class="font-bold text-slate-800 px-2 py-0.5 bg-slate-100 rounded border border-slate-200">${escapeHtml(product.parentGroup || product.group || '—')}</span>
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
            <th class="px-3 py-2.5 min-w-[280px]">Item Details</th>
            <th class="px-3 py-2.5 text-center">Stock</th>
            <th class="px-3 py-2.5 text-center">Unit</th>
            <th class="px-3 py-2.5 text-center">MRP</th>
            <th class="px-3 py-2.5 text-center">Rack</th>
            <th class="px-3 py-2.5 text-center">Group</th>
            <th class="px-3 py-2.5 text-center">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 text-slate-700">
          ${searchResult.items.map(product => `
            <tr data-select-part="${escapeHtml(product.partNumber)}" class="hover:bg-sky-50/80 transition-colors cursor-pointer group">
              <td class="px-3 py-2.5 min-w-[280px]">${formatItemDetails(product)}</td>
              <td class="px-3 py-2.5 text-center font-bold ${product.stockQty !== null && product.stockQty > 0 ? 'text-emerald-600' : 'text-slate-600'}">${product.stockQty !== null && product.stockQty !== undefined ? product.stockQty : '—'}</td>
              <td class="px-3 py-2.5 text-center text-slate-500">${escapeHtml(product.unit || '—')}</td>
              <td class="px-3 py-2.5 text-center font-bold text-slate-900">${product.rate !== null && product.rate !== undefined && product.rate !== '' ? `₹${Number(product.rate).toLocaleString('en-IN')}` : '—'}</td>
              <td class="px-3 py-2.5 text-center"><span class="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-medium">${escapeHtml(product.rack || '—')}</span></td>
              <td class="px-3 py-2.5 text-center"><span class="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-medium">${escapeHtml(product.parentGroup || product.group || '—')}</span></td>
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
        const confirmed = await showConfirmModal({
          title: 'Remove Item from Order?',
          message: 'Are you sure you want to remove this item from the order list?',
          confirmText: 'Remove Item',
          cancelText: 'Cancel',
          type: 'danger',
          icon: '🗑'
        });
        if (confirmed) {
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
          const newText = await showPromptModal({
            title: 'Edit Customer Wording',
            message: 'Modify handwritten/customer wording to re-match against the product master:',
            label: 'Customer Item Description',
            value: item.customerText || '',
            placeholder: 'e.g. BRAKE PAD FRONT TATA ACE',
            confirmText: 'Update & Match',
            cancelText: 'Cancel',
            icon: '✏'
          });
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

  // Manual Select Modal Search Input (Supports typing & handheld QR scanner)
  const manualSearchInput = document.getElementById('manual-search-input');
  if (manualSearchInput) {
    let lastKeyTime = 0;
    let rapidKeyCount = 0;
    let isScannerTyping = false;
    let scannerTimer = null;
    let manualDebounceTimer = null;

    async function processModalScannerInput(rawVal) {
      clearTimeout(scannerTimer);
      clearTimeout(manualDebounceTimer);
      isScannerTyping = false;
      rapidKeyCount = 0;

      const extraction = await extractPartNumberFromScannedText(rawVal);
      const extractedPartNo = (extraction.partNumber || rawVal).trim();
      manualSearchInput.value = extractedPartNo;
      performManualModalSearch(extractedPartNo, true);
    }

    manualSearchInput.addEventListener('keydown', (e) => {
      const now = Date.now();
      const delta = now - lastKeyTime;
      lastKeyTime = now;

      if (delta < 50) {
        rapidKeyCount++;
        if (rapidKeyCount >= 3) {
          isScannerTyping = true;
        }
      } else {
        rapidKeyCount = 0;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(scannerTimer);
        clearTimeout(manualDebounceTimer);

        const val = manualSearchInput.value;
        if (isQRPayload(val) || isScannerTyping) {
          processModalScannerInput(val);
        } else {
          performManualModalSearch(val, false);
        }
      }
    });

    manualSearchInput.addEventListener('input', (e) => {
      const val = e.target.value;
      clearTimeout(scannerTimer);
      clearTimeout(manualDebounceTimer);

      if (isQRPayload(val)) {
        scannerTimer = setTimeout(() => {
          processModalScannerInput(manualSearchInput.value);
        }, 60);
        return;
      }

      if (isScannerTyping) {
        scannerTimer = setTimeout(() => {
          processModalScannerInput(manualSearchInput.value);
        }, 70);
        return;
      }

      manualDebounceTimer = setTimeout(() => {
        performManualModalSearch(val, false);
      }, 150);
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
      closeDriveExportSuccessModal();
    }
  });

  // Success Modal Event Listeners
  const btnDriveOpen = document.getElementById('btn-drive-open');
  if (btnDriveOpen) {
    btnDriveOpen.addEventListener('click', () => {
      if (lastExportResult && lastExportResult.webViewLink) {
        const opened = window.open(lastExportResult.webViewLink, '_blank');
        if (!opened) {
          window.location.href = lastExportResult.webViewLink;
        }
      }
    });
  }

  const btnDriveSavePc = document.getElementById('btn-drive-save-pc');
  if (btnDriveSavePc) {
    btnDriveSavePc.addEventListener('click', () => {
      if (lastExportResult && lastExportResult.blob) {
        downloadBlobFallback(lastExportResult.blob, lastExportResult.filename);
        showToast(`Saved "${lastExportResult.filename}" to this PC`, 'success', 3000);
      }
    });
  }

  const btnDriveClose = document.getElementById('btn-drive-close');
  if (btnDriveClose) {
    btnDriveClose.addEventListener('click', closeDriveExportSuccessModal);
  }

  const btnDriveCloseX = document.getElementById('btn-drive-modal-close-x');
  if (btnDriveCloseX) {
    btnDriveCloseX.addEventListener('click', closeDriveExportSuccessModal);
  }

  const driveSuccessModal = document.getElementById('drive-export-success-modal');
  if (driveSuccessModal) {
    driveSuccessModal.addEventListener('click', (e) => {
      if (e.target === driveSuccessModal) {
        closeDriveExportSuccessModal();
      }
    });
  }

  // Generate PDF Button
  const btnGeneratePDF = document.getElementById('btn-generate-pdf');
  if (btnGeneratePDF) {
    btnGeneratePDF.addEventListener('click', () => {
      handleGeneratePDFClick();
    });
  }

  // Generate Excel Button
  const btnGenerateExcel = document.getElementById('btn-generate-excel');
  if (btnGenerateExcel) {
    btnGenerateExcel.addEventListener('click', () => {
      handleGenerateExcelClick();
    });
  }

  // Initial export buttons state check
  updateExportButtonState();
}

/**
 * Update PDF and Excel export button states according to order items count
 * Disabled when order.items.length === 0, enabled when order.items.length >= 1
 */
export function updateExportButtonState() {
  const order = getCurrentOrder();
  const hasItems = order && Array.isArray(order.items) && order.items.length > 0;

  const btnPdf = document.getElementById('btn-generate-pdf');
  const btnExcel = document.getElementById('btn-generate-excel');

  [btnPdf, btnExcel].forEach(btn => {
    if (!btn) return;
    btn.disabled = !hasItems;
    if (!hasItems) {
      btn.classList.add('opacity-40', 'cursor-not-allowed', 'pointer-events-none');
      btn.classList.remove('active:scale-95', 'hover:shadow-lg');
      btn.setAttribute('aria-disabled', 'true');
    } else {
      btn.classList.remove('opacity-40', 'cursor-not-allowed', 'pointer-events-none');
      btn.classList.add('active:scale-95');
      btn.removeAttribute('aria-disabled');
    }
  });
}

// In-memory reference to the last exported file and blob
let lastExportResult = null;

export function getLastExportResult() {
  return lastExportResult;
}

export function showDriveExportSuccessModal(result) {
  lastExportResult = result;

  const modal = document.getElementById('drive-export-success-modal');
  const filenameEl = document.getElementById('drive-success-filename');
  const folderEl = document.getElementById('drive-success-folder');
  const iconEl = document.getElementById('drive-success-icon');
  const updateBadge = document.getElementById('drive-success-update-badge');

  if (filenameEl) filenameEl.textContent = result.filename;
  if (folderEl) folderEl.textContent = result.monthFolderName || 'SEPTEMBER 2026';
  if (iconEl) iconEl.textContent = result.type === 'excel' ? '📊' : '📄';
  if (updateBadge) {
    if (result.isUpdate) updateBadge.classList.remove('hidden');
    else updateBadge.classList.add('hidden');
  }

  if (modal) {
    modal.classList.remove('hidden');
  }
}

export function closeDriveExportSuccessModal() {
  const modal = document.getElementById('drive-export-success-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function downloadBlobFallback(blob, filename) {
  if (typeof window === 'undefined' || !blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Handle PDF generation and Google Drive upload with deduplication and success modal
 */
export async function handleGeneratePDFClick() {
  const order = getCurrentOrder();
  if (!order || !order.items || order.items.length === 0) {
    showToast('Cannot generate PDF: The order has no items.', 'warning');
    return;
  }

  const summary = getOrderSummary();
  if (summary.hasUnmatched) {
    const proceed = await showConfirmModal({
      title: 'Export PDF with Unmatched Items?',
      message: `There are ${summary.unmatched} unmatched item(s) in this order.\n\nThese items will be marked as [ UNMATCHED ] on the Busy entry sheet.\n\nDo you still want to generate and upload the PDF now?`,
      confirmText: 'Generate PDF',
      cancelText: 'Review Items First',
      type: 'warning',
      icon: '⚠'
    });
    if (!proceed) return;
  }

  showToast('Generating PDF entry sheet...', 'info', 2000);

  let generated = null;
  try {
    generated = await generateBusyOrderPDFBlob(order);
    // Keep generated blob in memory so user can retry or save
    lastExportResult = {
      blob: generated.blob,
      filename: generated.filename,
      type: 'pdf'
    };
  } catch (err) {
    console.error('PDF Generation error:', err);
    showToast(`Failed to generate PDF: ${err.message}`, 'error', 4500);
    return;
  }

  showToast('Uploading to Google Drive (MH SALES ORDER)...', 'info', 3000);

  try {
    const uploadResult = await uploadOrUpdateDriveFile({
      filename: generated.filename,
      mimeType: 'application/pdf',
      blob: generated.blob,
      orderDate: order.orderDate
    });

    // Successfully uploaded to Drive: show success modal
    showDriveExportSuccessModal({
      blob: generated.blob,
      filename: generated.filename,
      webViewLink: uploadResult.webViewLink,
      monthFolderName: uploadResult.monthFolderName,
      isUpdate: uploadResult.isUpdate,
      type: 'pdf'
    });
  } catch (err) {
    console.error('Drive upload error:', err);

    let errorMsg = err?.message || 'Google Drive upload failed. Please try again.';
    if (errorMsg.includes('403') || errorMsg.toLowerCase().includes('permission')) {
      errorMsg = 'Google Drive access to the MH SALES ORDER folder is required. Please authorize/select the existing folder.';
    }

    showToast(errorMsg, 'error', 5500);
    // Do NOT download automatically
    // Do NOT show the success dialog
    // Generated Blob remains in memory (lastExportResult) so user can retry
  }
}

/**
 * Handle Excel generation and Google Drive upload with deduplication and success modal
 */
export async function handleGenerateExcelClick() {
  const order = getCurrentOrder();
  if (!order || !order.items || order.items.length === 0) {
    showToast('Cannot export Excel: The order has no items.', 'warning');
    return;
  }

  const summary = getOrderSummary();
  if (summary.hasUnmatched) {
    const proceed = await showConfirmModal({
      title: 'Export Excel with Unmatched Items?',
      message: `There are ${summary.unmatched} unmatched item(s) in this order.\n\nThese items will be marked as [ UNMATCHED ] on the Busy entry spreadsheet.\n\nDo you still want to export and upload the Excel file now?`,
      confirmText: 'Export Excel',
      cancelText: 'Review Items First',
      type: 'warning',
      icon: '⚠'
    });
    if (!proceed) return;
  }

  showToast('Generating Excel entry sheet...', 'info', 2000);

  let generated = null;
  try {
    generated = await generateBusyOrderExcelBlob(order);
    // Keep generated blob in memory so user can retry or save
    lastExportResult = {
      blob: generated.blob,
      filename: generated.filename,
      type: 'excel'
    };
  } catch (err) {
    console.error('Excel Generation error:', err);
    showToast(`Failed to generate Excel: ${err.message}`, 'error', 4500);
    return;
  }

  showToast('Uploading to Google Drive (MH SALES ORDER)...', 'info', 3000);

  try {
    const uploadResult = await uploadOrUpdateDriveFile({
      filename: generated.filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      blob: generated.blob,
      orderDate: order.orderDate
    });

    // Successfully uploaded to Drive: show success modal
    showDriveExportSuccessModal({
      blob: generated.blob,
      filename: generated.filename,
      webViewLink: uploadResult.webViewLink,
      monthFolderName: uploadResult.monthFolderName,
      isUpdate: uploadResult.isUpdate,
      type: 'excel'
    });
  } catch (err) {
    console.error('Drive upload error:', err);

    let errorMsg = err?.message || 'Google Drive upload failed. Please try again.';
    if (errorMsg.includes('403') || errorMsg.toLowerCase().includes('permission')) {
      errorMsg = 'Google Drive access to the MH SALES ORDER folder is required. Please authorize/select the existing folder.';
    }

    showToast(errorMsg, 'error', 5500);
    // Do NOT download automatically
    // Do NOT show the success dialog
    // Generated Blob remains in memory (lastExportResult) so user can retry
  }
}

/**
 * Update Dashboard Product Stats
 */
export async function refreshDashboardStats() {
  try {
    const stats = await getShopStats();
    const countEl = document.getElementById('stat-product-count');
    const countMobileEl = document.getElementById('stat-product-count-mobile');
    const importMetaEl = document.getElementById('stat-import-meta');

    if (countEl) {
      countEl.textContent = stats.totalProducts.toLocaleString();
    }
    if (countMobileEl) {
      countMobileEl.textContent = stats.totalProducts.toLocaleString();
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
