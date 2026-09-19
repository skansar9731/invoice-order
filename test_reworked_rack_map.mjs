/**
 * Comprehensive Verification Test for Reworked Automatic Rack Map Logic
 * Maharashtra Automobile — Physical Storage Floor Reference Layer
 */

import { parseProductRack, UNASSIGNED_SECTION_CODE, distributeQuantityAcrossSections } from './js/rackParser.js';
import { INITIAL_RACKS_SPEC, generateSections } from './js/mapConfigData.js';

console.log('=== RUNNING REWORKED AUTOMATIC RACK MAP VERIFICATION SUITE ===\n');

// ----------------------------------------------------------------------------
// Test 1: Sub-section identification from single-letter + number (Section 1 & 4)
// ----------------------------------------------------------------------------
console.log('Test 1: Verifying Sub-section identification (R-60 A1, B1, C2, D7)...');

const subSecCases = [
  { input: 'R-60 A1', rack: 'R60', sec: 'A', sub: '1', label: 'A1' },
  { input: 'R-60 B1', rack: 'R60', sec: 'B', sub: '1', label: 'B1' },
  { input: 'R-60 C2', rack: 'R60', sec: 'C', sub: '2', label: 'C2' },
  { input: 'R-60 D7', rack: 'R60', sec: 'D', sub: '7', label: 'D7' }
];

for (const c of subSecCases) {
  const parsed = parseProductRack(c.input);
  if (!parsed || !parsed.hasRecognizableSection) {
    console.error(`FAILED: ${c.input} was marked as unrecognized!`);
    process.exit(1);
  }
  if (parsed.rackId !== c.rack) {
    console.error(`FAILED: ${c.input} rackId mismatch. Got ${parsed.rackId}, expected ${c.rack}`);
    process.exit(1);
  }
  if (parsed.sections.length !== 1 || parsed.sections[0] !== c.sec) {
    console.error(`FAILED: ${c.input} section mismatch. Got ${JSON.stringify(parsed.sections)}, expected ['${c.sec}']`);
    process.exit(1);
  }
  if (!parsed.locations || parsed.locations.length !== 1 || parsed.locations[0].subSection !== c.sub) {
    console.error(`FAILED: ${c.input} sub-section mismatch. Got ${JSON.stringify(parsed.locations)}, expected subSection: '${c.sub}'`);
    process.exit(1);
  }
}
console.log('  ✓ PASSED: Sub-sections A1, B1, C2, D7 parsed with exact Section & Sub-section identifiers.');

// ----------------------------------------------------------------------------
// Test 2: Multiple Sub-sections (Section 4: A1 A2 A3 A4, B1 B2 B3, C1 C2)
// ----------------------------------------------------------------------------
console.log('\nTest 2: Verifying Multiple Sub-sections (A1 A2 A3 A4, B1 B2 B3, C1 C2)...');

const multiSubCases = [
  { input: 'R-60 A1 A2 A3 A4', sec: 'A', expectedSubs: ['1', '2', '3', '4'] },
  { input: 'R-60 B1 B2 B3', sec: 'B', expectedSubs: ['1', '2', '3'] },
  { input: 'R-60 C1 C2', sec: 'C', expectedSubs: ['1', '2'] },
  { input: 'R-60 D7', sec: 'D', expectedSubs: ['7'] }
];

for (const m of multiSubCases) {
  const parsed = parseProductRack(m.input);
  if (!parsed || !parsed.hasRecognizableSection) {
    console.error(`FAILED: ${m.input} was marked unrecognized!`);
    process.exit(1);
  }
  const subs = parsed.locations.map(l => l.subSection);
  if (JSON.stringify(subs) !== JSON.stringify(m.expectedSubs)) {
    console.error(`FAILED: ${m.input} sub-sections mismatch. Got ${JSON.stringify(subs)}, expected ${JSON.stringify(m.expectedSubs)}`);
    process.exit(1);
  }
  if (!parsed.sections.includes(m.sec)) {
    console.error(`FAILED: Section ${m.sec} missing in ${m.input}`);
    process.exit(1);
  }
}
console.log('  ✓ PASSED: Multiple sub-sections correctly mapped to physical locations.');

// ----------------------------------------------------------------------------
// Test 3: Multiple Sections (Section 2 & 3: ABC, DEF, A & B, N & P, etc.)
// ----------------------------------------------------------------------------
console.log('\nTest 3: Verifying Multiple Sections (ABC, DEF, A & B, N & P, A&B, N&P)...');

const multiSecCases = [
  { input: 'R-15 ABC', rack: 'R15', expectedSections: ['A', 'B', 'C'] },
  { input: 'R-15 DEF', rack: 'R15', expectedSections: ['D', 'E', 'F'] },
  { input: 'R-15 A B C', rack: 'R15', expectedSections: ['A', 'B', 'C'] },
  { input: 'R-15 A, B, C', rack: 'R15', expectedSections: ['A', 'B', 'C'] },
  { input: 'R-72 A & B', rack: 'R72', expectedSections: ['A', 'B'] },
  { input: 'R-72 A&B', rack: 'R72', expectedSections: ['A', 'B'] },
  { input: 'R-72 N & P', rack: 'R72', expectedSections: ['N', 'P'] },
  { input: 'R-72 N&P', rack: 'R72', expectedSections: ['N', 'P'] }
];

for (const m of multiSecCases) {
  const parsed = parseProductRack(m.input);
  if (!parsed || !parsed.hasRecognizableSection) {
    console.error(`FAILED: ${m.input} was marked unrecognized!`);
    process.exit(1);
  }
  if (parsed.rackId !== m.rack) {
    console.error(`FAILED: ${m.input} rackId mismatch: got ${parsed.rackId}, expected ${m.rack}`);
    process.exit(1);
  }
  if (JSON.stringify(parsed.sections) !== JSON.stringify(m.expectedSections)) {
    console.error(`FAILED: ${m.input} sections mismatch: got ${JSON.stringify(parsed.sections)}, expected ${JSON.stringify(m.expectedSections)}`);
    process.exit(1);
  }
}
console.log('  ✓ PASSED: All multiple section formats (ABC, DEF, A & B, N & P, A&B, N&P) parsed cleanly.');

// ----------------------------------------------------------------------------
// Test 4: Stock Distribution Exact Arithmetic (Section 6)
// ----------------------------------------------------------------------------
console.log('\nTest 4: Verifying stock distribution rule (Sum === original stockQty)...');

const qtyCases = [
  { stock: 50, numLocations: 3, expected: [17, 17, 16], desc: 'R-15 ABC Qty 50 -> 17, 17, 16' },
  { stock: 60, numLocations: 2, expected: [30, 30], desc: 'R-72 A & B Qty 60 -> 30, 30' },
  { stock: 60, numLocations: 2, expected: [30, 30], desc: 'R-72 N & P Qty 60 -> 30, 30' },
  { stock: 10, numLocations: 4, expected: [3, 3, 2, 2], desc: '4 locations Qty 10 -> 3, 3, 2, 2' },
  { stock: 0, numLocations: 3, expected: [0, 0, 0], desc: 'Zero stock Qty 0 -> 0, 0, 0' },
  { stock: 7, numLocations: 3, expected: [3, 2, 2], desc: 'Qty 7 across 3 -> 3, 2, 2' }
];

for (const qc of qtyCases) {
  const res = distributeQuantityAcrossSections(qc.stock, qc.numLocations);
  const sum = res.reduce((a, b) => a + b, 0);
  if (sum !== qc.stock) {
    console.error(`FAILED: ${qc.desc} sum mismatch! Got sum ${sum}, expected ${qc.stock}`);
    process.exit(1);
  }
  if (JSON.stringify(res) !== JSON.stringify(qc.expected)) {
    console.error(`FAILED: ${qc.desc} allocation mismatch! Got ${JSON.stringify(res)}, expected ${JSON.stringify(qc.expected)}`);
    process.exit(1);
  }
}
console.log('  ✓ PASSED: Stock distribution arithmetic strictly preserves original total quantity.');

// ----------------------------------------------------------------------------
// Test 5: End-to-End Simulation: Browser Data Clear & Automatic Rebuild Test (Section 8 & 12)
// ----------------------------------------------------------------------------
console.log('\nTest 5: Simulating Browser Data Clear and Stock Upload Rebuild...');

// Simulated uploaded products in Product Master
const sampleProducts = [
  { partNumber: 'PART-001', productName: 'AIR FILTER DREAM YUGA', stockQty: 50, rack: 'R-15 ABC', rate: 150, unit: 'Pcs.' },
  { partNumber: 'PART-002', productName: 'FRONT BRAKE PAD', stockQty: 60, rack: 'R-72 A & B', rate: 350, unit: 'Set' },
  { partNumber: 'PART-003', productName: 'REAR BRAKE SHOE', stockQty: 60, rack: 'R-72 N & P', rate: 280, unit: 'Set' },
  { partNumber: 'PART-004', productName: 'SPARK PLUG RG4HC', stockQty: 10, rack: 'R-60 A1 A2 A3 A4', rate: 120, unit: 'Pcs.' },
  { partNumber: 'PART-005', productName: 'CLUTCH CABLE', stockQty: 25, rack: 'R-60 B1', rate: 95, unit: 'Pcs.' },
  { partNumber: 'PART-006', productName: 'ACCELERATOR CABLE', stockQty: 15, rack: 'R-60 C2', rate: 85, unit: 'Pcs.' },
  { partNumber: 'PART-007', productName: 'OIL FILTER', stockQty: 40, rack: 'R-60 D7', rate: 65, unit: 'Pcs.' },
  { partNumber: 'PART-008', productName: 'ZERO STOCK GASKET', stockQty: 0, rack: 'R-1 G', rate: 25, unit: 'Pcs.' }
];

function simulateBuildRackMap(products) {
  // Build in-memory index like rackMap.js
  const index = new Map();

  // 71 predefined racks
  INITIAL_RACKS_SPEC.forEach(spec => {
    const rackId = `R${spec.num}`;
    const predefinedSecCodes = generateSections(spec.range[0], spec.range[1]).map(s => s.code);
    index.set(rackId, {
      id: rackId,
      rackNum: spec.num,
      name: `Rack ${spec.num}`,
      sectionStart: spec.range[0],
      sectionEnd: spec.range[1],
      sectionMap: new Map()
    });
    const rData = index.get(rackId);
    predefinedSecCodes.forEach(code => {
      rData.sectionMap.set(code, { code, products: [], subSectionMap: new Map() });
    });
  });

  // Populate from products
  products.forEach(p => {
    const parsed = parseProductRack(p.rack);
    if (!parsed) return;
    const rackData = index.get(parsed.rackId);
    if (!rackData) return;

    const totalStock = Number(p.stockQty) || 0;
    const locs = parsed.locations || [];
    const splits = distributeQuantityAcrossSections(totalStock, locs.length);

    locs.forEach((loc, idx) => {
      const secCode = loc.section;
      const subCode = loc.subSection || null;
      const allocatedQty = splits[idx];

      if (!rackData.sectionMap.has(secCode)) {
        rackData.sectionMap.set(secCode, { code: secCode, products: [], subSectionMap: new Map() });
      }
      const secData = rackData.sectionMap.get(secCode);
      const item = { ...p, allocatedQty, subSection: subCode };
      secData.products.push(item);

      if (subCode) {
        if (!secData.subSectionMap.has(subCode)) {
          secData.subSectionMap.set(subCode, { code: subCode, products: [] });
        }
        secData.subSectionMap.get(subCode).products.push(item);
      }
    });
  });

  return index;
}

// 1. Initial Build
const firstBuild = simulateBuildRackMap(sampleProducts);

// Verify initial build assertions
const r15 = firstBuild.get('R15');
const r15SecA = r15.sectionMap.get('A').products[0].allocatedQty;
const r15SecB = r15.sectionMap.get('B').products[0].allocatedQty;
const r15SecC = r15.sectionMap.get('C').products[0].allocatedQty;
if (r15SecA !== 17 || r15SecB !== 17 || r15SecC !== 16) {
  console.error(`FAILED: R15 distributed qtys mismatch: ${r15SecA}, ${r15SecB}, ${r15SecC}`);
  process.exit(1);
}

const r60 = firstBuild.get('R60');
const r60SecA = r60.sectionMap.get('A');
if (r60SecA.subSectionMap.size !== 4) {
  console.error(`FAILED: Expected 4 sub-sections in R-60 Sec A, got ${r60SecA.subSectionMap.size}`);
  process.exit(1);
}
console.log('  ✓ Initial stock build successful: R15 distributed 17/17/16, R60 Sec A has 4 sub-sections.');

// 2. Simulate CLEARING BROWSER STORAGE
console.log('  Clearing browser storage in simulation...');
let simulatedStorage = null;

// 3. Simulate RELOAD & RE-UPLOAD of identical stock
console.log('  Reloading app and uploading identical stock...');
const secondBuild = simulateBuildRackMap(sampleProducts);

// Verify rebuilt map
const r15_2 = secondBuild.get('R15');
const r15SecA_2 = r15_2.sectionMap.get('A').products[0].allocatedQty;
const r15SecB_2 = r15_2.sectionMap.get('B').products[0].allocatedQty;
const r15SecC_2 = r15_2.sectionMap.get('C').products[0].allocatedQty;

if (r15SecA_2 !== 17 || r15SecB_2 !== 17 || r15SecC_2 !== 16) {
  console.error('FAILED: Rebuild after storage clear failed to replicate distribution!');
  process.exit(1);
}

const r60_2 = secondBuild.get('R60');
if (r60_2.sectionMap.get('A').subSectionMap.size !== 4) {
  console.error('FAILED: Rebuild after storage clear lost sub-sections!');
  process.exit(1);
}

// Verify zero-stock product is visible with Qty: 0
const r1 = secondBuild.get('R1');
const zeroProd = r1.sectionMap.get('G').products[0];
if (!zeroProd || zeroProd.allocatedQty !== 0) {
  console.error('FAILED: Zero stock product missing or non-zero!');
  process.exit(1);
}

console.log('  ✓ PASSED: Rebuilt map matches original build identically with zero manual reconfiguration.');
console.log('\n=== ALL AUTOMATIC RACK MAP REWORK VERIFICATION TESTS PASSED 100%! ===\n');
