/**
 * Shared Export Data Service for Busy Accounting PDF & Excel Exports
 * Resolves each matched order item strictly against the ORIGINAL Product Master record
 */

import { getProduct } from './db.js';

/**
 * Prepares normalized export rows using the ORIGINAL Product Master as the sole source of truth.
 * @param {Object} order - The active order object
 * @returns {Promise<Array>} Normalized export rows
 */
export async function prepareBusyExportRows(order) {
  if (!order || !order.items || order.items.length === 0) {
    return [];
  }

  const exportRows = [];

  for (let idx = 0; idx < order.items.length; idx++) {
    const item = order.items[idx];
    const sNo = idx + 1;
    const customerText = (item.customerText || '').trim();
    const parsedQty = parseFloat(item.quantity);
    const qty = (!isNaN(parsedQty) && parsedQty > 0)
      ? (Number.isInteger(parsedQty) ? parsedQty : Number(parsedQty.toFixed(3)))
      : 1;

    // Resolve matched product against IndexedDB Product Master using its stable id or partNumber
    let matchedProd = item.matchedProduct || null;
    const customRate = (item.rate !== null && item.rate !== undefined && item.rate !== '')
      ? Number(item.rate)
      : (item.matchedProduct && item.matchedProduct.rate !== null && item.matchedProduct.rate !== undefined && item.matchedProduct.rate !== '' ? Number(item.matchedProduct.rate) : null);

    if (matchedProd && (matchedProd.id || matchedProd.partNumber)) {
      try {
        const dbProd = await getProduct(matchedProd.id || matchedProd.partNumber);
        if (dbProd) {
          matchedProd = { ...dbProd };
          if (customRate !== null && !isNaN(customRate)) {
            matchedProd.rate = customRate;
          }
        }
      } catch (err) {
        // Fallback to in-memory matched product object
      }
    }

    let exactItemName = '';
    let unit = '';
    let mrp = '';
    let mrpNum = null;
    let availableStock = '';
    let stockNum = null;
    let rackNo = '';
    let group = '';
    let confidence = '0%';
    let action = 'Unmatched';

    if (matchedProd) {
      // 1. EXACT FULL Item Details from ORIGINAL Product Master (e.g. "21K220S BOR KIT 2012 P PRO 2855/-")
      if (matchedProd.itemDetails && matchedProd.itemDetails.trim()) {
        exactItemName = matchedProd.itemDetails.trim();
      } else {
        const part = (matchedProd.partNumber || '').trim();
        const name = (matchedProd.productName || '').trim();
        if (part && name) {
          if (name.toUpperCase().startsWith(part.toUpperCase())) {
            exactItemName = name;
          } else {
            exactItemName = `${part} ${name}`.trim();
          }
        } else {
          exactItemName = part || name || '';
        }
      }

      // 2. Unit: from Product Master, blank if missing
      const rawUnit = matchedProd.unit !== null && matchedProd.unit !== undefined ? String(matchedProd.unit).trim() : '';
      unit = (rawUnit === '-' || rawUnit === '—') ? '' : rawUnit;

      // 3. MRP: from overridden item rate or Product Master rate/mrp field, blank if missing
      const effectiveRate = (customRate !== null && !isNaN(customRate))
        ? customRate
        : ((matchedProd.rate !== null && matchedProd.rate !== undefined && matchedProd.rate !== '') ? Number(matchedProd.rate) : null);

      if (effectiveRate !== null && !isNaN(effectiveRate)) {
        mrpNum = effectiveRate;
        mrp = effectiveRate;
      }

      // 4. Available stock: actual 0 must remain 0, blank if missing
      if (matchedProd.stockQty !== null && matchedProd.stockQty !== undefined && matchedProd.stockQty !== '') {
        const numStock = Number(matchedProd.stockQty);
        if (!isNaN(numStock)) {
          stockNum = numStock;
          availableStock = numStock;
        }
      }

      // 5. Rack No: from Product Master, blank if missing
      const rawRack = matchedProd.rack !== null && matchedProd.rack !== undefined ? String(matchedProd.rack).trim() : '';
      rackNo = (rawRack === '-' || rawRack === '—') ? '' : rawRack;

      // 6. Group: from Product Master, blank if missing
      const rawGroup = matchedProd.parentGroup || matchedProd.group || item.matchedProduct?.parentGroup || item.matchedProduct?.group || '';
      group = (rawGroup === '-' || rawGroup === '—') ? '' : String(rawGroup).trim();

      // 7. Confidence
      if (item.isManual) {
        confidence = 'Manual';
      } else if (item.confidence > 0) {
        confidence = `${item.confidence}%`;
      } else {
        confidence = '100%';
      }

      // 8. Action / Status
      if (item.isManual) {
        action = 'Manual';
      } else if (stockNum !== null && stockNum < qty) {
        action = 'Low Stock';
      } else {
        action = 'Matched';
      }
    } else {
      exactItemName = customerText ? `[UNMATCHED] ${customerText}` : '[UNMATCHED]';
      action = 'Unmatched';
      confidence = '0%';
    }

    exportRows.push({
      sNo,
      customerText,
      qty,
      exactItemName,
      unit,
      mrp,
      mrpNum,
      availableStock,
      stockNum,
      rackNo,
      group,
      confidence,
      action,
      rawItem: item,
      rawProduct: matchedProd
    });
  }

  // Sort export rows copy by Group continuously, preserving original product order within each group
  const sortedRows = exportRows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const groupA = (a.row.group || '').trim();
      const groupB = (b.row.group || '').trim();

      // If both items have identical group (case-insensitive), preserve original product order
      if (groupA.toUpperCase() === groupB.toUpperCase()) {
        return a.index - b.index;
      }

      // Items with group come before items with empty group
      if (groupA && !groupB) return -1;
      if (!groupA && groupB) return 1;

      // Sort alphabetically by group
      const cmp = groupA.localeCompare(groupB, undefined, { sensitivity: 'base', numeric: true });
      if (cmp !== 0) return cmp;

      return a.index - b.index;
    })
    .map(({ row }, newIdx) => ({
      ...row,
      sNo: newIdx + 1
    }));

  return sortedRows;
}
