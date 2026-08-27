/**
 * Client-Side Excel Generator for Busy Accounting & Easy Software Entry Sheets
 * Supports:
 * 1. Customer Order Export (Sheet 1: Busy Entry Sheet, Sheet 2: Easy Software Format 5-columns)
 * 2. Complete Stock List / Product Master Export (Exact 5 columns: Item Details, Qty., Unit, MRP, Rack)
 */

import { prepareBusyExportRows } from './exportDataService.js';

/**
 * Format quantity strictly with 3 decimals (e.g. 1.000, 0.000, 15.000, -8.000) or clean string
 */
function formatStockQty(qty) {
  if (qty === null || qty === undefined || qty === '') return '0.000';
  const num = Number(qty);
  if (isNaN(num)) return String(qty);
  return num.toFixed(3);
}

/**
 * Generate Busy & Easy Accounting Excel for Customer Orders
 * Sheet 1: Busy Entry Sheet (10 columns)
 * Sheet 2: Easy Software Format (5 columns matching attached Excel format: Item Details, Qty., Unit, MRP, Rack)
 */
export async function generateBusyOrderExcel(order) {
  if (!order || !order.items || order.items.length === 0) {
    throw new Error('Cannot export Excel: The order has no items.');
  }

  const exportRows = await prepareBusyExportRows(order);
  if (exportRows.length === 0) {
    throw new Error('Cannot export Excel: No valid order rows to export.');
  }

  const orderNo = order.orderNo || 'ORDER';
  const filename = `${orderNo}_Busy_Entry_Sheet.xlsx`;

  // 1. Busy Sheet (10 columns)
  const busyHeaders = [
    'S. No',
    'Customer Handwritten Text',
    'Qty',
    'Item (Matched from Original Stock)',
    'Unit',
    'MRP',
    'Available stock',
    'Rack No',
    'Confidence',
    'Action'
  ];

  const busyRows = exportRows.map(row => [
    row.sNo,
    row.customerText,
    row.qty,
    row.exactItemName,
    row.unit,
    row.mrp,
    row.availableStock,
    row.rackNo,
    row.confidence,
    row.action
  ]);

  // 2. Easy Software Format Sheet (5 columns matching exact user format: Item Details, Qty., Unit, MRP, Rack)
  const easyHeaders = [
    'Item Details',
    'Qty.',
    'Unit',
    'MRP',
    'Rack'
  ];

  const easyRows = exportRows.map(row => [
    row.exactItemName || row.customerText,
    formatStockQty(row.qty),
    row.unit || 'Pcs.',
    row.mrpNum !== null ? row.mrpNum : (row.mrp || ''),
    row.rackNo || ''
  ]);

  // Check if SheetJS (XLSX) is available in window
  if (typeof window !== 'undefined' && window.XLSX) {
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();

    // Sheet 1: Busy Entry Sheet
    const wsBusy = XLSX.utils.aoa_to_sheet([busyHeaders, ...busyRows]);
    wsBusy['!cols'] = [
      { wch: 8 },  // S. No
      { wch: 32 }, // Customer Handwritten Text
      { wch: 8 },  // Qty
      { wch: 46 }, // Item (Matched from Original Stock)
      { wch: 10 }, // Unit
      { wch: 12 }, // MRP
      { wch: 16 }, // Available stock
      { wch: 12 }, // Rack No
      { wch: 14 }, // Confidence
      { wch: 14 }  // Action
    ];
    XLSX.utils.book_append_sheet(wb, wsBusy, 'Busy Entry Sheet');

    // Sheet 2: Easy Software Format (5 columns)
    const wsEasy = XLSX.utils.aoa_to_sheet([easyHeaders, ...easyRows]);
    wsEasy['!cols'] = [
      { wch: 46 }, // Item Details
      { wch: 12 }, // Qty.
      { wch: 10 }, // Unit
      { wch: 12 }, // MRP
      { wch: 14 }  // Rack
    ];
    XLSX.utils.book_append_sheet(wb, wsEasy, 'Easy Software Format');

    // Write file directly to download
    XLSX.writeFile(wb, filename);
    return filename;
  }

  // Fallback: Export clean CSV if XLSX library is not loaded
  const csvFilename = `${orderNo}_Order_Export.csv`;
  const escapeCsv = (str) => {
    if (str === null || str === undefined) return '';
    const s = String(str);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csvLines = [
    easyHeaders.map(escapeCsv).join(','),
    ...easyRows.map(row => row.map(escapeCsv).join(','))
  ];

  if (typeof document !== 'undefined') {
    const blob = new Blob([csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : '';
    const link = document.createElement('a');
    link.href = url;
    link.download = csvFilename;
    if (document.body && document.body.appendChild) {
      document.body.appendChild(link);
      if (link.click) link.click();
      document.body.removeChild(link);
    } else if (link.click) {
      link.click();
    }
    if (url && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(url);
    }
  }

  return csvFilename;
}

/**
 * Export Complete Stock Master List in Exact Attached Excel Format
 * Headings (5 columns):
 * Item Details | Qty. | Unit | MRP | Rack
 * @param {Array} products - List of stock products
 * @param {string} customFilename - Output filename
 */
export function exportStockMasterExcel(products, customFilename = null) {
  if (!products || products.length === 0) {
    throw new Error('Cannot export Excel: No products found in stock list.');
  }

  const filename = customFilename || `Maharashtra_Automobile_Stock_List_${new Date().toISOString().split('T')[0]}.xlsx`;

  const headers = [
    'Item Details',
    'Qty.',
    'Unit',
    'MRP',
    'Rack'
  ];

  const dataRows = products.map(p => {
    // Exact Item Details name string
    let itemDetails = '';
    if (p.itemDetails) {
      itemDetails = p.itemDetails.trim();
    } else {
      const part = (p.partNumber || '').trim();
      const name = (p.productName || '').trim();
      if (part && name && !name.toUpperCase().startsWith(part.toUpperCase())) {
        itemDetails = `${part} ${name}`;
      } else {
        itemDetails = name || part;
      }
    }

    const qty = formatStockQty(p.stockQty);
    const unit = (p.unit && p.unit !== '-' && p.unit !== '—') ? p.unit.trim() : 'Pcs.';
    const mrp = (p.rate !== null && p.rate !== undefined && p.rate !== '') ? Number(p.rate) : (p.mrp ? Number(p.mrp) : '');
    const rack = (p.rack && p.rack !== '-' && p.rack !== '—') ? p.rack.trim() : '';

    return [
      itemDetails,
      qty,
      unit,
      mrp,
      rack
    ];
  });

  if (typeof window !== 'undefined' && window.XLSX) {
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();

    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws['!cols'] = [
      { wch: 48 }, // Item Details
      { wch: 12 }, // Qty.
      { wch: 10 }, // Unit
      { wch: 12 }, // MRP
      { wch: 14 }  // Rack
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Stock List');
    XLSX.writeFile(wb, filename);
    return filename;
  }

  // Fallback CSV
  const csvFilename = filename.replace(/\.xlsx$/i, '.csv');
  const escapeCsv = (str) => {
    if (str === null || str === undefined) return '';
    const s = String(str);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csvLines = [
    headers.map(escapeCsv).join(','),
    ...dataRows.map(row => row.map(escapeCsv).join(','))
  ];

  if (typeof document !== 'undefined') {
    const blob = new Blob([csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : '';
    const link = document.createElement('a');
    link.href = url;
    link.download = csvFilename;
    if (document.body && document.body.appendChild) {
      document.body.appendChild(link);
      if (link.click) link.click();
      document.body.removeChild(link);
    } else if (link.click) {
      link.click();
    }
    if (url && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(url);
    }
  }

  return csvFilename;
}
