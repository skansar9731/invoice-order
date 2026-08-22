/**
 * Client-Side PDF Generator for Busy Accounting Entry Sheet
 * Uses jsPDF and jspdf-autotable to produce clean, crisp printable sheets
 */

export function generateBusyOrderPDF(order) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('jsPDF library is not loaded. Please verify internet connection or scripts.');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  // Header Banner
  doc.setFillColor(30, 41, 59); // Slate 800
  doc.rect(margin, 12, pageWidth - (margin * 2), 22, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text('MAHARASHTRA AUTOMOBILE', pageWidth / 2, 21, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225); // Slate 300
  doc.text('AI CUSTOMER ORDER  ->  BUSY ACCOUNTING ENTRY SHEET', pageWidth / 2, 29, { align: 'center' });

  // Order Details Box
  const metaY = 40;
  doc.setFillColor(248, 250, 252); // Slate 50
  doc.setDrawColor(226, 232, 240); // Slate 200
  doc.roundedRect(margin, metaY, pageWidth - (margin * 2), 24, 2, 2, 'FD');

  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105); // Slate 600

  // Left column
  doc.setFont('helvetica', 'bold');
  doc.text('Order No:', margin + 4, metaY + 7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(order.orderNo || '-', margin + 26, metaY + 7);

  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'bold');
  doc.text('Customer:', margin + 4, metaY + 14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(order.customerName || 'Counter Cash Customer', margin + 26, metaY + 14);

  // Right column
  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'bold');
  doc.text('Date / Time:', pageWidth - margin - 65, metaY + 7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  const dateStr = `${order.orderDate || new Date().toISOString().split('T')[0]}  ${order.orderTime || ''}`;
  doc.text(dateStr, pageWidth - margin - 40, metaY + 7);

  // Summary counts
  const totalItems = order.items.length;
  const matchedCount = order.items.filter(i => i.matchedProduct && !i.isManual).length;
  const manualCount = order.items.filter(i => i.isManual).length;
  const unmatchedCount = order.items.filter(i => !i.matchedProduct).length;

  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'bold');
  doc.text('Summary:', pageWidth - margin - 65, metaY + 14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(`Total: ${totalItems} | Auto: ${matchedCount} | Manual: ${manualCount} ${unmatchedCount > 0 ? `| Unmatched: ${unmatchedCount}` : ''}`, pageWidth - margin - 46, metaY + 14);

  // Prepare Table Data
  const tableRows = order.items.map((item, index) => {
    const sNo = String(index + 1);
    const customerItem = item.customerText || '—';
    const prodName = item.matchedProduct?.productName || '[ UNMATCHED / PENDING ]';
    const partNo = item.matchedProduct?.partNumber || '—';
    const qty = String(item.quantity || 1);
    const rack = (item.matchedProduct && item.matchedProduct.rack) ? item.matchedProduct.rack : '—';
    const unit = (item.matchedProduct && item.matchedProduct.unit) ? item.matchedProduct.unit : '—';
    const stock = (item.matchedProduct && item.matchedProduct.stockQty !== null && item.matchedProduct.stockQty !== undefined)
      ? String(item.matchedProduct.stockQty)
      : '—';
    
    let matchDisplay = 'UNMATCHED';
    if (item.isManual) {
      matchDisplay = 'Manual';
    } else if (item.matchedProduct && item.confidence > 0) {
      matchDisplay = `AI / Auto Match (${item.confidence}%)`;
    }

    return [sNo, customerItem, prodName, partNo, qty, rack, unit, stock, matchDisplay];
  });

  // Render Table via autotable
  doc.autoTable({
    startY: metaY + 28,
    margin: { left: margin, right: margin, bottom: 20 },
    head: [['S.No', 'Customer Item', 'Exact Product Name', 'Part Number', 'Qty', 'Rack', 'Unit', 'Stock', 'Match']],
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [51, 65, 85], // Slate 700
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
      halign: 'left'
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [30, 41, 59],
      cellPadding: 3
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' }, // S.No
      1: { cellWidth: 32 },                  // Customer Item
      2: { cellWidth: 48, fontStyle: 'bold' },// Exact Product Name
      3: { cellWidth: 30, fontStyle: 'bold' },// Part Number
      4: { cellWidth: 12, halign: 'center', fontStyle: 'bold' }, // Qty
      5: { cellWidth: 16, halign: 'center' }, // Rack
      6: { cellWidth: 14, halign: 'center' }, // Unit
      7: { cellWidth: 12, halign: 'center' }, // Stock
      8: { cellWidth: 16, halign: 'center' }  // Match %
    },
    didParseCell: function(data) {
      if (data.section === 'body') {
        const itemIndex = data.row.index;
        const currentItem = order.items[itemIndex];

        // Highlight unmatched items with light red background
        if (!currentItem || !currentItem.matchedProduct) {
          data.cell.styles.fillColor = [254, 226, 226]; // Red 100
          data.cell.styles.textColor = [185, 28, 28];
        }
        // Highlight low stock (ordered > available) in Qty/Stock cells
        else if (currentItem.matchedProduct.stockQty < currentItem.quantity && (data.column.index === 4 || data.column.index === 7)) {
          data.cell.styles.textColor = [194, 65, 12]; // Amber 700
        }
        // Manual match styling
        if (data.column.index === 8 && data.cell.raw === 'Manual') {
          data.cell.styles.textColor = [3, 105, 161]; // Sky 700
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
    didDrawPage: function(data) {
      // Footer
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184); // Slate 400
      const pageStr = `Page ${data.pageNumber} of ${doc.internal.getNumberOfPages()}`;
      doc.text('Maharashtra Automobile * Busy 21/18 Entry Companion Sheet * System Generated', margin, pageHeight - 8);
      doc.text(pageStr, pageWidth - margin - 15, pageHeight - 8);
    }
  });

  // Save / Return blob URL
  const filename = `${order.orderNo || 'Order'}_Busy_Entry_Sheet.pdf`;
  doc.save(filename);
  return filename;
}
