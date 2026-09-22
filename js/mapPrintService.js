/**
 * Map Print & Occupancy Shared Service
 * Maharashtra Automobile — Physical Storage Floor & Counter Mapping
 *
 * Provides dynamic occupancy calculations (Filled/Empty sections and sub-sections)
 * and generates high-fidelity, single-job printable reports for all active racks and counters.
 */

import { UNASSIGNED_SECTION_CODE } from './rackParser.js';

/**
 * Safely parse numeric stock
 */
export function getNumericStock(val) {
  if (val === null || val === undefined || val === '') return 0;
  const num = Number(val);
  return isNaN(num) ? 0 : num;
}

/**
 * HTML Escape helper
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Calculate Section Occupancy (FILLED vs EMPTY) for a Rack or Counter
 *
 * Logic:
 * A section is FILLED when:
 * - At least one current Product Master product is mapped to that section
 * AND
 * - Current stockQty > 0
 *
 * A section is EMPTY when:
 * - No current product is mapped to that section
 * OR
 * - All products mapped to that section have stockQty = 0
 *
 * Rules:
 * - Filled + Empty MUST equal total configured sections.
 * - A section must never appear in both lists.
 * - A section must never be missing from both lists.
 * - Everything is calculated dynamically from current data.
 *
 * @param {Map} sectionMap - Map of secCode -> SectionData
 * @returns {Object} { totalSections, filledCount, emptyCount, filledSections, emptySections, filledText, emptyText }
 */
export function calculateSectionOccupancy(sectionMap) {
  if (!sectionMap) {
    return {
      totalSections: 0,
      filledCount: 0,
      emptyCount: 0,
      filledSections: [],
      emptySections: [],
      filledText: '',
      emptyText: ''
    };
  }

  const filled = [];
  const empty = [];

  // Sort standard section codes alphabetically, excluding unassigned
  const entries = Array.from(sectionMap.entries())
    .filter(([code]) => code !== UNASSIGNED_SECTION_CODE && code !== 'Unassigned')
    .sort((a, b) => a[0].localeCompare(b[0]));

  for (const [code, secData] of entries) {
    const products = secData.products || [];
    const hasStock = products.some(p => {
      const q = getNumericStock(p.allocatedQty !== undefined ? p.allocatedQty : p.stockQty);
      return q > 0;
    });

    if (hasStock) {
      filled.push(code);
    } else {
      empty.push(code);
    }
  }

  return {
    totalSections: entries.length,
    filledCount: filled.length,
    emptyCount: empty.length,
    filledSections: filled,
    emptySections: empty,
    filledText: filled.join(' '),
    emptyText: empty.join(' ')
  };
}

/**
 * Calculate Sub-section Occupancy for a Section containing sub-sections (e.g. A1, A2, A3)
 *
 * @param {Object} secData - SectionData object with subSectionMap
 * @returns {Object|null} { totalSubSections, filledCount, emptyCount, filledSubs, emptySubs, filledText, emptyText }
 */
export function calculateSubSectionOccupancy(secData) {
  if (!secData || !secData.subSectionMap || secData.subSectionMap.size === 0) {
    return null;
  }

  const subMap = secData.subSectionMap;
  const detectedKeys = Array.from(subMap.keys());
  const isAllNumeric = detectedKeys.every(k => /^\d+$/.test(k));

  let allSubCodes = [];

  if (isAllNumeric) {
    const numbers = detectedKeys.map(k => parseInt(k, 10));
    const maxNum = Math.max(...numbers);
    // If reasonable shelf range 1..maxNum (e.g. maxNum <= 30)
    if (maxNum >= 1 && maxNum <= 30) {
      for (let i = 1; i <= maxNum; i++) {
        allSubCodes.push(String(i));
      }
    } else {
      allSubCodes = detectedKeys.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    }
  } else {
    allSubCodes = detectedKeys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  const filled = [];
  const empty = [];

  for (const subCode of allSubCodes) {
    const subInfo = subMap.get(subCode);
    const prods = subInfo ? (subInfo.products || []) : [];
    const hasStock = prods.some(p => {
      const q = getNumericStock(p.allocatedQty !== undefined ? p.allocatedQty : p.stockQty);
      return q > 0;
    });

    if (hasStock) {
      filled.push(subCode);
    } else {
      empty.push(subCode);
    }
  }

  return {
    totalSubSections: allSubCodes.length,
    filledCount: filled.length,
    emptyCount: empty.length,
    filledSubs: filled,
    emptySubs: empty,
    filledText: filled.join(', '),
    emptyText: empty.join(', ')
  };
}

/**
 * Format timestamp for report headers
 */
function getReportTimestamp() {
  const now = new Date();
  return now.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Print Complete Rack Map Overview Report (All 71 Active Racks)
 * Renders all active Rack Cards in a clean, multi-column A4 grid that paginates naturally.
 *
 * @param {Map} rackIndex - Map of rackId -> RackData
 */
export function printRackOverviewReport(rackIndex) {
  if (!rackIndex || rackIndex.size === 0) return;

  const timestamp = getReportTimestamp();
  const rackList = Array.from(rackIndex.values()).sort((a, b) => a.rackNum - b.rackNum);

  let totalProducts = 0;
  let totalQuantity = 0;

  rackList.forEach(rack => {
    totalProducts += (rack.allProducts || []).length;
    (rack.allProducts || []).forEach(p => {
      totalQuantity += getNumericStock(p.stockQty);
    });
  });

  const cardsHtml = rackList.map(rack => {
    const prodCount = (rack.allProducts || []).length;
    let qtySum = 0;
    (rack.allProducts || []).forEach(p => {
      qtySum += getNumericStock(p.stockQty);
    });
    const occupancy = calculateSectionOccupancy(rack.sectionMap);

    return `
      <div class="print-overview-card">
        <div>
          <div class="print-card-header-row">
            <span class="print-card-title">${escapeHtml(rack.name || rack.id)}</span>
            <span class="print-card-range">${escapeHtml(rack.sectionStart)}-${escapeHtml(rack.sectionEnd)}</span>
          </div>
          <div class="print-card-sec-count">${occupancy.totalSections} sections</div>

          <div class="print-card-occupancy">
            <div class="print-occ-row print-occ-filled">
              <span class="print-occ-badge filled">Filled: ${occupancy.filledCount}</span>
              <span class="print-occ-text">${escapeHtml(occupancy.filledText || '—')}</span>
            </div>
            <div class="print-occ-row print-occ-empty">
              <span class="print-occ-badge empty">Empty: ${occupancy.emptyCount}</span>
              <span class="print-occ-text">${escapeHtml(occupancy.emptyText || '—')}</span>
            </div>
          </div>
        </div>

        <div class="print-card-footer">
          <span class="print-card-items"><b>${prodCount}</b> items</span>
          <span class="print-card-qty ${qtySum > 0 ? 'has-qty' : 'no-qty'}">Qty: <b>${qtySum}</b></span>
        </div>
      </div>
    `;
  }).join('');

  const reportHtml = `
    <div class="print-report">
      <!-- Report Header -->
      <div class="print-header">
        <div class="print-brand-title">MH AUTO</div>
        <div class="print-report-title">SHOP RACK MAP</div>
        <div class="print-meta-line">
          <span>Generated: <b>${escapeHtml(timestamp)}</b></span>
          <span>&bull;</span>
          <span>Active Racks: <b>${rackList.length}</b></span>
          <span>&bull;</span>
          <span>Total Products: <b>${totalProducts.toLocaleString()}</b></span>
          <span>&bull;</span>
          <span>Total Qty: <b>${totalQuantity.toLocaleString()}</b></span>
        </div>
      </div>

      <!-- Complete Rack Overview Card Grid -->
      <div class="print-overview-grid">
        ${cardsHtml}
      </div>
    </div>
  `;

  executePrintJob(reportHtml);
}

/**
 * Print Complete Counter Map Overview Report (All 8 Active Counters)
 * Renders all 8 Counter Cards in a clean, multi-column A4 grid that paginates naturally.
 *
 * @param {Map} counterIndex - Map of counterId -> CounterData
 */
export function printCounterOverviewReport(counterIndex) {
  if (!counterIndex || counterIndex.size === 0) return;

  const timestamp = getReportTimestamp();
  const counterList = Array.from(counterIndex.values()).sort((a, b) => a.counterNum - b.counterNum);

  let totalProducts = 0;
  let totalQuantity = 0;

  counterList.forEach(counter => {
    totalProducts += (counter.allProducts || []).length;
    (counter.allProducts || []).forEach(p => {
      totalQuantity += getNumericStock(p.stockQty);
    });
  });

  const cardsHtml = counterList.map(counter => {
    const prodCount = (counter.allProducts || []).length;
    let qtySum = 0;
    (counter.allProducts || []).forEach(p => {
      qtySum += getNumericStock(p.stockQty);
    });
    const occupancy = calculateSectionOccupancy(counter.sectionMap);

    return `
      <div class="print-overview-card">
        <div>
          <div class="print-card-header-row">
            <span class="print-card-title">${escapeHtml(counter.name || counter.id)}</span>
            <span class="print-card-range">${escapeHtml(counter.sectionStart)}-${escapeHtml(counter.sectionEnd)}</span>
          </div>
          <div class="print-card-sec-count">${occupancy.totalSections} sections</div>

          <div class="print-card-occupancy">
            <div class="print-occ-row print-occ-filled">
              <span class="print-occ-badge filled">Filled: ${occupancy.filledCount}</span>
              <span class="print-occ-text">${escapeHtml(occupancy.filledText || '—')}</span>
            </div>
            <div class="print-occ-row print-occ-empty">
              <span class="print-occ-badge empty">Empty: ${occupancy.emptyCount}</span>
              <span class="print-occ-text">${escapeHtml(occupancy.emptyText || '—')}</span>
            </div>
          </div>
        </div>

        <div class="print-card-footer">
          <span class="print-card-items"><b>${prodCount}</b> items</span>
          <span class="print-card-qty ${qtySum > 0 ? 'has-qty' : 'no-qty'}">Qty: <b>${qtySum}</b></span>
        </div>
      </div>
    `;
  }).join('');

  const reportHtml = `
    <div class="print-report">
      <!-- Report Header -->
      <div class="print-header">
        <div class="print-brand-title">MH AUTO</div>
        <div class="print-report-title">SHOP COUNTER MAP</div>
        <div class="print-meta-line">
          <span>Generated: <b>${escapeHtml(timestamp)}</b></span>
          <span>&bull;</span>
          <span>Active Counters: <b>${counterList.length}</b></span>
          <span>&bull;</span>
          <span>Total Products: <b>${totalProducts.toLocaleString()}</b></span>
          <span>&bull;</span>
          <span>Total Qty: <b>${totalQuantity.toLocaleString()}</b></span>
        </div>
      </div>

      <!-- Complete Counter Overview Card Grid -->
      <div class="print-overview-grid">
        ${cardsHtml}
      </div>
    </div>
  `;

  executePrintJob(reportHtml);
}

/**
 * Print Single Rack dedicated report
 * Prints ONLY the currently selected/open rack.
 *
 * @param {Object} rack - RackData object for the selected rack
 */
export function printSingleRackReport(rack) {
  if (!rack) return;

  const timestamp = getReportTimestamp();
  const occupancy = calculateSectionOccupancy(rack.sectionMap);
  const rackProds = rack.allProducts || [];
  let rackQty = 0;
  rackProds.forEach(p => {
    rackQty += getNumericStock(p.stockQty);
  });

  const sortedSections = Array.from(rack.sectionMap.values())
    .filter(s => s.code !== UNASSIGNED_SECTION_CODE && s.code !== 'Unassigned')
    .sort((a, b) => a.code.localeCompare(b.code));

  const unassignedProds = rack.unassignedSectionProducts || [];

  const reportHtml = `
    <div class="print-report">
      <!-- Report Header -->
      <div class="print-header">
        <div class="print-brand-title">MH AUTO</div>
        <div class="print-report-title">SHOP RACK MAP — ${escapeHtml(rack.name || rack.id).toUpperCase()}</div>
        <div class="print-meta-line">
          <span>Generated: <b>${escapeHtml(timestamp)}</b></span>
          <span>&bull;</span>
          <span>Rack: <b>${escapeHtml(rack.name || rack.id)}</b></span>
          <span>&bull;</span>
          <span>Sections: <b>${escapeHtml(rack.sectionStart)}-${escapeHtml(rack.sectionEnd)}</b></span>
          <span>&bull;</span>
          <span>Total Products: <b>${rackProds.length}</b></span>
          <span>&bull;</span>
          <span>Total Qty: <b>${rackQty}</b></span>
        </div>
      </div>

      <!-- Single Rack Block -->
      <div class="print-content">
        <div class="print-rack-block">
          <!-- Rack Summary Header -->
          <div class="print-rack-header">
            <div class="print-rack-title-row">
              <span class="print-rack-name">${escapeHtml(rack.name || rack.id).toUpperCase()}</span>
              <span class="print-rack-range">Sections: ${escapeHtml(rack.sectionStart)}-${escapeHtml(rack.sectionEnd)}</span>
            </div>
            <div class="print-rack-stats-grid">
              <div><b>Total Sections:</b> ${occupancy.totalSections}</div>
              <div><b>Filled (${occupancy.filledCount}):</b> ${escapeHtml(occupancy.filledText || 'None')}</div>
              <div><b>Empty (${occupancy.emptyCount}):</b> ${escapeHtml(occupancy.emptyText || 'None')}</div>
              <div><b>Products:</b> ${rackProds.length} &bull; <b>Total Qty:</b> ${rackQty}</div>
            </div>
          </div>

          <!-- Rack Sections -->
          <div class="print-sections-container">
            ${sortedSections.map(sec => {
              const prods = sec.products || [];
              const subOcc = calculateSubSectionOccupancy(sec);

              if (prods.length === 0) {
                return `
                  <div class="print-section-block print-section-empty">
                    <div class="print-section-title">SECTION ${escapeHtml(sec.code)}</div>
                    <div class="print-empty-label">EMPTY</div>
                  </div>
                `;
              }

              return `
                <div class="print-section-block">
                  <div class="print-section-title">
                    <span>SECTION ${escapeHtml(sec.code)}</span>
                    <span class="print-section-badge">
                      ${prods.length} item${prods.length === 1 ? '' : 's'}
                      ${subOcc ? ` &bull; Subs Filled: ${subOcc.filledCount} (${escapeHtml(subOcc.filledText)}), Empty: ${subOcc.emptyCount} (${escapeHtml(subOcc.emptyText)})` : ''}
                    </span>
                  </div>

                  <table class="print-table">
                    <thead>
                      <tr>
                        <th style="width: 35px;">#</th>
                        <th style="width: 240px;">Item Details</th>
                        <th style="width: 130px;">Part Number</th>
                        <th style="width: 55px; text-align: center;">Qty</th>
                        <th style="width: 45px; text-align: center;">Unit</th>
                        <th style="width: 65px; text-align: right;">MRP</th>
                        <th style="width: 90px;">Group</th>
                        <th style="width: 90px; text-align: center;">Rack Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${prods.map((p, idx) => {
                        const q = getNumericStock(p.allocatedQty !== undefined ? p.allocatedQty : p.stockQty);
                        const rateVal = p.rate ? Number(p.rate).toFixed(2) : (p.mrp ? Number(p.mrp).toFixed(2) : '0.00');
                        return `
                          <tr>
                            <td style="text-align: center;">${idx + 1}</td>
                            <td>
                              <b>${escapeHtml(p.productName || p.itemDetails || '-')}</b>
                              ${p.subSection ? ` <span class="print-sub-tag">[Sub ${escapeHtml(p.subSection)}]</span>` : ''}
                            </td>
                            <td class="print-mono">${escapeHtml(p.partNumber || '-')}</td>
                            <td style="text-align: center; font-weight: bold;">${q}</td>
                            <td style="text-align: center;">${escapeHtml(p.unit || 'Pcs.')}</td>
                            <td style="text-align: right;">₹${rateVal}</td>
                            <td>${escapeHtml(p.group || p.parentGroup || '-')}</td>
                            <td style="text-align: center;" class="print-mono">${escapeHtml(p.rack || '-')}</td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              `;
            }).join('')}

            ${unassignedProds.length > 0 ? `
              <div class="print-section-block">
                <div class="print-section-title">
                  <span>UNASSIGNED SECTION</span>
                  <span class="print-section-badge">${unassignedProds.length} item(s)</span>
                </div>
                <table class="print-table">
                  <thead>
                    <tr>
                      <th style="width: 35px;">#</th>
                      <th style="width: 240px;">Item Details</th>
                      <th style="width: 130px;">Part Number</th>
                      <th style="width: 55px; text-align: center;">Qty</th>
                      <th style="width: 45px; text-align: center;">Unit</th>
                      <th style="width: 65px; text-align: right;">MRP</th>
                      <th style="width: 90px;">Group</th>
                      <th style="width: 90px; text-align: center;">Rack Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${unassignedProds.map((p, idx) => {
                      const q = getNumericStock(p.allocatedQty !== undefined ? p.allocatedQty : p.stockQty);
                      const rateVal = p.rate ? Number(p.rate).toFixed(2) : (p.mrp ? Number(p.mrp).toFixed(2) : '0.00');
                      return `
                        <tr>
                          <td style="text-align: center;">${idx + 1}</td>
                          <td><b>${escapeHtml(p.productName || p.itemDetails || '-')}</b></td>
                          <td class="print-mono">${escapeHtml(p.partNumber || '-')}</td>
                          <td style="text-align: center; font-weight: bold;">${q}</td>
                          <td style="text-align: center;">${escapeHtml(p.unit || 'Pcs.')}</td>
                          <td style="text-align: right;">₹${rateVal}</td>
                          <td>${escapeHtml(p.group || p.parentGroup || '-')}</td>
                          <td style="text-align: center;" class="print-mono">${escapeHtml(p.rack || '-')}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    </div>
  `;

  executePrintJob(reportHtml);
}

/**
 * Print Single Counter dedicated report
 * Prints ONLY the currently selected/open counter.
 *
 * @param {Object} counter - CounterData object for the selected counter
 */
export function printSingleCounterReport(counter) {
  if (!counter) return;

  const timestamp = getReportTimestamp();
  const occupancy = calculateSectionOccupancy(counter.sectionMap);
  const counterProds = counter.allProducts || [];
  let counterQty = 0;
  counterProds.forEach(p => {
    counterQty += getNumericStock(p.stockQty);
  });

  const sortedSections = Array.from(counter.sectionMap.values())
    .filter(s => s.code !== UNASSIGNED_SECTION_CODE && s.code !== 'Unassigned')
    .sort((a, b) => a.code.localeCompare(b.code));

  const reportHtml = `
    <div class="print-report">
      <!-- Report Header -->
      <div class="print-header">
        <div class="print-brand-title">MH AUTO</div>
        <div class="print-report-title">SHOP COUNTER MAP — ${escapeHtml(counter.name || counter.id).toUpperCase()}</div>
        <div class="print-meta-line">
          <span>Generated: <b>${escapeHtml(timestamp)}</b></span>
          <span>&bull;</span>
          <span>Counter: <b>${escapeHtml(counter.name || counter.id)}</b></span>
          <span>&bull;</span>
          <span>Sections: <b>${escapeHtml(counter.sectionStart)}-${escapeHtml(counter.sectionEnd)}</b></span>
          <span>&bull;</span>
          <span>Total Products: <b>${counterProds.length}</b></span>
          <span>&bull;</span>
          <span>Total Qty: <b>${counterQty}</b></span>
        </div>
      </div>

      <!-- Single Counter Block -->
      <div class="print-content">
        <div class="print-counter-block">
          <!-- Counter Summary Header -->
          <div class="print-counter-header">
            <div class="print-rack-title-row">
              <span class="print-rack-name">${escapeHtml(counter.name || counter.id).toUpperCase()}</span>
              <span class="print-rack-range">Sections: ${escapeHtml(counter.sectionStart)}-${escapeHtml(counter.sectionEnd)}</span>
            </div>
            <div class="print-rack-stats-grid">
              <div><b>Total Sections:</b> ${occupancy.totalSections}</div>
              <div><b>Filled (${occupancy.filledCount}):</b> ${escapeHtml(occupancy.filledText || 'None')}</div>
              <div><b>Empty (${occupancy.emptyCount}):</b> ${escapeHtml(occupancy.emptyText || 'None')}</div>
              <div><b>Products:</b> ${counterProds.length} &bull; <b>Total Qty:</b> ${counterQty}</div>
            </div>
          </div>

          <!-- Counter Sections -->
          <div class="print-sections-container">
            ${sortedSections.map(sec => {
              const prods = sec.products || [];
              const subOcc = calculateSubSectionOccupancy(sec);

              if (prods.length === 0) {
                return `
                  <div class="print-section-block print-section-empty">
                    <div class="print-section-title">SECTION ${escapeHtml(sec.code)}</div>
                    <div class="print-empty-label">EMPTY</div>
                  </div>
                `;
              }

              return `
                <div class="print-section-block">
                  <div class="print-section-title">
                    <span>SECTION ${escapeHtml(sec.code)}</span>
                    <span class="print-section-badge">
                      ${prods.length} item${prods.length === 1 ? '' : 's'}
                      ${subOcc ? ` &bull; Subs Filled: ${subOcc.filledCount} (${escapeHtml(subOcc.filledText)}), Empty: ${subOcc.emptyCount} (${escapeHtml(subOcc.emptyText)})` : ''}
                    </span>
                  </div>

                  <table class="print-table">
                    <thead>
                      <tr>
                        <th style="width: 35px;">#</th>
                        <th style="width: 240px;">Item Details</th>
                        <th style="width: 130px;">Part Number</th>
                        <th style="width: 55px; text-align: center;">Qty</th>
                        <th style="width: 45px; text-align: center;">Unit</th>
                        <th style="width: 65px; text-align: right;">MRP</th>
                        <th style="width: 90px;">Group</th>
                        <th style="width: 90px; text-align: center;">Counter Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${prods.map((p, idx) => {
                        const q = getNumericStock(p.allocatedQty !== undefined ? p.allocatedQty : p.stockQty);
                        const rateVal = p.rate ? Number(p.rate).toFixed(2) : (p.mrp ? Number(p.mrp).toFixed(2) : '0.00');
                        return `
                          <tr>
                            <td style="text-align: center;">${idx + 1}</td>
                            <td>
                              <b>${escapeHtml(p.productName || p.itemDetails || '-')}</b>
                              ${p.subSection ? ` <span class="print-sub-tag">[Sub ${escapeHtml(p.subSection)}]</span>` : ''}
                            </td>
                            <td class="print-mono">${escapeHtml(p.partNumber || '-')}</td>
                            <td style="text-align: center; font-weight: bold;">${q}</td>
                            <td style="text-align: center;">${escapeHtml(p.unit || 'Pcs.')}</td>
                            <td style="text-align: right;">₹${rateVal}</td>
                            <td>${escapeHtml(p.group || p.parentGroup || '-')}</td>
                            <td style="text-align: center;" class="print-mono">${escapeHtml(p.rack || '-')}</td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  executePrintJob(reportHtml);
}

/**
 * Injects report HTML and invokes window.print()
 */
function executePrintJob(html) {
  let printContainer = document.getElementById('print-report-container');
  if (!printContainer) {
    printContainer = document.createElement('div');
    printContainer.id = 'print-report-container';
    printContainer.className = 'print-report-container';
    document.body.appendChild(printContainer);
  }

  printContainer.innerHTML = html;
  printContainer.classList.remove('hidden');

  // Let DOM update before triggering print
  setTimeout(() => {
    window.print();
  }, 100);
}
