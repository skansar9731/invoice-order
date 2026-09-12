/**
 * Client-Side PDF Generator for Busy Accounting Entry Sheet
 * Uses shared prepareBusyExportRows to render EXACT Product Master data.
 * Columns: Item Details | Qty. | Unit | MRP | Rack
 */

import { prepareBusyExportRows } from './exportDataService.js';

/**
 * Builds the jsPDF instance and document for the Busy Entry Sheet
 * @param {Object} order - Customer order object
 * @returns {Promise<{ doc: Object, filename: string }>}
 */
export async function buildBusyOrderPDFDoc(order) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('jsPDF library is not loaded. Please verify internet connection or scripts.');
  }

  if (!order || !order.items || order.items.length === 0) {
    throw new Error('Cannot generate PDF: The order has no items.');
  }

  const exportRows = await prepareBusyExportRows(order);
  if (exportRows.length === 0) {
    throw new Error('Cannot generate PDF: No valid order rows.');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;

  // Header Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text('MAHARASHTRA AUTOMOBILE', margin, 12);

  // Subheader Order Metadata (Busy Format)
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(50, 50, 50);

  const orderNo = order.orderNo || 'ORDER';
  const customer = order.customerName || 'Counter Cash Customer';
  const createdBy = order.createdBy || '';
  const checkedBy = order.checkedBy || '';
  const dateStr = order.orderDate || new Date().toISOString().split('T')[0];
  const timeStr = order.orderTime || '';
  const metaLine1 = `Customer Order Sheet  |  Order No: ${orderNo}  |  Date: ${dateStr} ${timeStr}`.trim();
  const metaLine2 = `Customer: ${customer}  |  Created By: ${createdBy || '—'}  |  Checked By: ${checkedBy || '—'}`;
  doc.text(metaLine1, margin, 16.5);
  doc.text(metaLine2, margin, 21);

  let totalQty = 0;

  // Prepare Table Rows using shared export rows
  const tableRows = exportRows.map((row) => {
    totalQty += row.qty;

    // Item Details: EXACT full Product Master item name (no truncation, character-for-character)
    const itemDetail = row.exactItemName;

    // Qty. (formatted to 3 decimal places)
    const qtyStr = Number(row.qty).toFixed(3);

    // Unit
    const unitStr = row.unit || '';

    // MRP (formatted with commas if present, blank if missing)
    const mrpStr = row.mrpNum !== null && row.mrpNum !== undefined
      ? Number(row.mrpNum).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '';

    // Rack (from Product Master, blank if missing)
    const rackStr = row.rackNo || '';

    return [itemDetail, qtyStr, unitStr, mrpStr, rackStr];
  });

  // Add Totals Footer Row
  tableRows.push([
    'Totals c/o',
    totalQty.toFixed(3),
    'Pcs.',
    '',
    ''
  ]);

  // Render Table via jspdf-autotable matching exact Busy black-border grid
  doc.autoTable({
    startY: 25,
    margin: { left: margin, right: margin, bottom: 16 },
    head: [['Item Details', 'Qty.', 'Unit', 'MRP', 'Rack']],
    body: tableRows,
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      textColor: [0, 0, 0],
      cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 },
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      overflow: 'linebreak'
    },
    headStyles: {
      fontStyle: 'bold',
      fontSize: 10,
      textColor: [0, 0, 0],
      fillColor: [255, 255, 255],
      lineColor: [0, 0, 0],
      lineWidth: 0.35
    },
    columnStyles: {
      0: { cellWidth: 105, fontStyle: 'normal', overflow: 'linebreak' }, // Item Details (allows full multi-line text wrapping)
      1: { cellWidth: 20, halign: 'right', fontStyle: 'normal' },        // Qty.
      2: { cellWidth: 18, halign: 'left', fontStyle: 'normal' },         // Unit
      3: { cellWidth: 25, halign: 'right', fontStyle: 'normal' },        // MRP
      4: { cellWidth: 22, halign: 'left', fontStyle: 'normal' }          // Rack
    },
    didParseCell: function (data) {
      // Bold the header and the Totals footer row
      if (data.row.index === tableRows.length - 1) {
        data.cell.styles.fontStyle = 'bold';
      }
      // If unmatched, highlight text
      if (data.section === 'body' && data.column.index === 0 && data.cell.raw && String(data.cell.raw).includes('[UNMATCHED]')) {
        data.cell.styles.textColor = [220, 38, 38];
        data.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawPage: function (data) {
      // Top header line border
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.35);
      doc.line(margin, 25, pageWidth - margin, 25);

      // Bottom page number footer
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      const pageStr = `Page ${data.pageNumber} of ${doc.internal.getNumberOfPages()}`;
      doc.text('Maharashtra Automobile  •  Busy Entry Sheet', margin, pageHeight - 7);
      doc.text(pageStr, pageWidth - margin - 15, pageHeight - 7);
    }
  });

  const filename = `${order.orderNo || 'Order'}_Busy_Entry_Sheet.pdf`;
  return { doc, filename };
}

/**
 * Generate Busy Entry Sheet PDF as a Blob without downloading
 * @param {Object} order - Customer order object
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
export async function generateBusyOrderPDFBlob(order) {
  const { doc, filename } = await buildBusyOrderPDFDoc(order);
  const blob = doc.output('blob');
  return { blob, filename };
}

/**
 * Generate Busy Entry Sheet PDF and download directly (backward-compatible)
 * @param {Object} order - Customer order object
 * @returns {Promise<string>} Downloaded filename
 */
export async function generateBusyOrderPDF(order) {
  const { doc, filename } = await buildBusyOrderPDFDoc(order);
  doc.save(filename);
  return filename;
}
