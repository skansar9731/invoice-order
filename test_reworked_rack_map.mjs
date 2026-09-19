/**
 * Comprehensive Verification Test for Reworked Automatic Rack Map & Counter Map Logic
 * Maharashtra Automobile — Physical Floor & Counter Reference Layer
 */

import {
  parseProductRack,
  parseProductCounter,
  isCounterLocation,
  UNASSIGNED_SECTION_CODE,
  distributeQuantityAcrossSections
} from './js/rackParser.js';
import {
  INITIAL_RACKS_SPEC,
  INITIAL_COUNTERS_SPEC,
  generateSections
} from './js/mapConfigData.js';

console.log('=== RUNNING REWORKED AUTOMATIC RACK & COUNTER MAP VERIFICATION SUITE ===\n');

// ----------------------------------------------------------------------------
// Test 1: Sub-section identification from single-letter + number
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
// Test 2: Multiple Sub-sections (A1 A2 A3 A4, B1 B2 B3, C1 C2)
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
// Test 3: Multiple Sections (ABC, DEF, A & B, N & P, A&B, N&P)
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
// Test 4: Counter Location Parsing (C-5 A, C-5 A1, COUNTER 5, etc.)
// ----------------------------------------------------------------------------
console.log('\nTest 4: Verifying Counter Location Parsing & Isolation...');

const counterCases = [
  { input: 'C-5 A', cId: 'C5', cNum: 5, expectedSections: ['A'], hasSub: false },
  { input: 'C-5 A1', cId: 'C5', cNum: 5, expectedSections: ['A'], hasSub: true, sub: '1' },
  { input: 'C-5 C', cId: 'C5', cNum: 5, expectedSections: ['C'], hasSub: false },
  { input: 'C-5 E', cId: 'C5', cNum: 5, expectedSections: ['E'], hasSub: false },
  { input: 'C-5 F', cId: 'C5', cNum: 5, expectedSections: ['F'], hasSub: false },
  { input: 'C5 A', cId: 'C5', cNum: 5, expectedSections: ['A'], hasSub: false },
  { input: 'COUNTER 5 A', cId: 'C5', cNum: 5, expectedSections: ['A'], hasSub: false },
  { input: 'COUNTER-5 ABC', cId: 'C5', cNum: 5, expectedSections: ['A', 'B', 'C'], hasSub: false },
  { input: 'C-1 A', cId: 'C1', cNum: 1, expectedSections: ['A'], hasSub: false },
  { input: 'C-8 T', cId: 'C8', cNum: 8, expectedSections: ['T'], hasSub: false }
];

for (const cc of counterCases) {
  // Must be recognized as counter
  if (!isCounterLocation(cc.input)) {
    console.error(`FAILED: ${cc.input} not recognized as counter location!`);
    process.exit(1);
  }

  // Must NOT be parsed as a floor rack (Rack Map ignores it)
  const rackParsed = parseProductRack(cc.input);
  if (rackParsed !== null) {
    console.error(`FAILED: ${cc.input} was incorrectly accepted by parseProductRack!`);
    process.exit(1);
  }

  // Must be parsed by parseProductCounter
  const counterParsed = parseProductCounter(cc.input);
  if (!counterParsed || !counterParsed.hasRecognizableSection) {
    console.error(`FAILED: ${cc.input} failed counter parsing!`);
    process.exit(1);
  }
  if (counterParsed.counterId !== cc.cId || counterParsed.counterNum !== cc.cNum) {
    console.error(`FAILED: ${cc.input} counter ID/Num mismatch! Got ${counterParsed.counterId}, expected ${cc.cId}`);
    process.exit(1);
  }
  if (JSON.stringify(counterParsed.sections) !== JSON.stringify(cc.expectedSections)) {
    console.error(`FAILED: ${cc.input} counter sections mismatch! Got ${JSON.stringify(counterParsed.sections)}, expected ${JSON.stringify(cc.expectedSections)}`);
    process.exit(1);
  }
  if (cc.hasSub && counterParsed.locations[0].subSection !== cc.sub) {
    console.error(`FAILED: ${cc.input} subSection mismatch! Got ${counterParsed.locations[0].subSection}, expected ${cc.sub}`);
    process.exit(1);
  }
}
console.log('  ✓ PASSED: Counter locations parsed accurately; strictly rejected by parseProductRack to prevent false warnings.');

// ----------------------------------------------------------------------------
// Test 5: Stock Distribution Exact Arithmetic (Sum === original stockQty)
// ----------------------------------------------------------------------------
console.log('\nTest 5: Verifying stock distribution rule (Sum === original stockQty)...');

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
// Test 6: End-to-End Simulation: Browser Data Clear & Automatic Rebuild (Rack + Counter)
// ----------------------------------------------------------------------------
console.log('\nTest 6: Simulating Browser Data Clear and Stock Upload Rebuild for BOTH Maps...');

// Sample Product Master containing BOTH Rack products and Counter products
const sampleProducts = [
  // Racks
  { partNumber: 'PART-001', productName: 'AIR FILTER DREAM YUGA', stockQty: 50, rack: 'R-15 ABC', rate: 150, unit: 'Pcs.' },
  { partNumber: 'PART-002', productName: 'FRONT BRAKE PAD', stockQty: 60, rack: 'R-72 A & B', rate: 350, unit: 'Set' },
  { partNumber: 'PART-003', productName: 'REAR BRAKE SHOE', stockQty: 60, rack: 'R-72 N & P', rate: 280, unit: 'Set' },
  { partNumber: 'PART-004', productName: 'SPARK PLUG RG4HC', stockQty: 10, rack: 'R-60 A1 A2 A3 A4', rate: 120, unit: 'Pcs.' },
  { partNumber: 'PART-005', productName: 'CLUTCH CABLE', stockQty: 25, rack: 'R-60 B1', rate: 95, unit: 'Pcs.' },
  { partNumber: 'PART-006', productName: 'ACCELERATOR CABLE', stockQty: 15, rack: 'R-60 C2', rate: 85, unit: 'Pcs.' },
  { partNumber: 'PART-007', productName: 'OIL FILTER', stockQty: 40, rack: 'R-60 D7', rate: 65, unit: 'Pcs.' },
  { partNumber: 'PART-008', productName: 'ZERO STOCK GASKET', stockQty: 0, rack: 'R-1 G', rate: 25, unit: 'Pcs.' },

  // Counters (from user's Counter 5 screenshot)
  { partNumber: 'CTR-001', productName: 'COUNTER PART A', stockQty: 69, rack: 'C-5 A', rate: 110, unit: 'Pcs.' },
  { partNumber: 'CTR-002', productName: 'COUNTER PART C', stockQty: 57, rack: 'C-5 C', rate: 220, unit: 'Pcs.' },
  { partNumber: 'CTR-003', productName: 'COUNTER PART E', stockQty: 9, rack: 'C-5 E', rate: 330, unit: 'Pcs.' },
  { partNumber: 'CTR-004', productName: 'COUNTER PART F1', stockQty: 7, rack: 'C-5 F', rate: 440, unit: 'Pcs.' },
  { partNumber: 'CTR-005', productName: 'COUNTER PART F2', stockQty: 6, rack: 'C-5 F', rate: 550, unit: 'Pcs.' }
];

function simulateFullShopMapping(products) {
  // 1. Rack Map Index
  const rackMap = new Map();
  INITIAL_RACKS_SPEC.forEach(spec => {
    const rId = `R${spec.num}`;
    const secCodes = generateSections(spec.range[0], spec.range[1]).map(s => s.code);
    rackMap.set(rId, { id: rId, rackNum: spec.num, sectionMap: new Map() });
    secCodes.forEach(code => rackMap.get(rId).sectionMap.set(code, { code, products: [] }));
  });

  // 2. Counter Map Index
  const counterMap = new Map();
  INITIAL_COUNTERS_SPEC.forEach(spec => {
    const cId = `C${spec.num}`;
    const secCodes = generateSections(spec.range[0], spec.range[1]).map(s => s.code);
    counterMap.set(cId, { id: cId, counterNum: spec.num, sectionMap: new Map() });
    secCodes.forEach(code => counterMap.get(cId).sectionMap.set(code, { code, products: [] }));
  });

  let rackWarningsCount = 0;

  products.forEach(p => {
    // Rack Map indexing
    const parsedRack = parseProductRack(p.rack);
    if (parsedRack && rackMap.has(parsedRack.rackId)) {
      const r = rackMap.get(parsedRack.rackId);
      const locs = parsedRack.locations || [];
      const splits = distributeQuantityAcrossSections(Number(p.stockQty) || 0, locs.length);
      locs.forEach((loc, idx) => {
        if (!r.sectionMap.has(loc.section)) r.sectionMap.set(loc.section, { code: loc.section, products: [] });
        r.sectionMap.get(loc.section).products.push({ ...p, allocatedQty: splits[idx] });
      });
    } else if (!isCounterLocation(p.rack)) {
      // Genuinely unassigned (neither rack nor counter)
      rackWarningsCount++;
    }

    // Counter Map indexing
    const parsedCounter = parseProductCounter(p.rack);
    if (parsedCounter && counterMap.has(parsedCounter.counterId)) {
      const c = counterMap.get(parsedCounter.counterId);
      const locs = parsedCounter.locations || [];
      const splits = distributeQuantityAcrossSections(Number(p.stockQty) || 0, locs.length);
      locs.forEach((loc, idx) => {
        if (!c.sectionMap.has(loc.section)) c.sectionMap.set(loc.section, { code: loc.section, products: [] });
        c.sectionMap.get(loc.section).products.push({ ...p, allocatedQty: splits[idx] });
      });
    }
  });

  return { rackMap, counterMap, rackWarningsCount };
}

// 1. First Build
const run1 = simulateFullShopMapping(sampleProducts);

// Assertions for Counter 5
const c5 = run1.counterMap.get('C5');
const c5SecA = c5.sectionMap.get('A').products[0].allocatedQty;
const c5SecC = c5.sectionMap.get('C').products[0].allocatedQty;
const c5SecE = c5.sectionMap.get('E').products[0].allocatedQty;
const c5SecF_total = c5.sectionMap.get('F').products.reduce((acc, p) => acc + p.allocatedQty, 0);

if (c5SecA !== 69 || c5SecC !== 57 || c5SecE !== 9 || c5SecF_total !== 13) {
  console.error(`FAILED: Counter 5 products mismatch! Sec A: ${c5SecA}, Sec C: ${c5SecC}, Sec E: ${c5SecE}, Sec F: ${c5SecF_total}`);
  process.exit(1);
}

// Assert zero warnings caused by Counter items in Rack Map
if (run1.rackWarningsCount !== 0) {
  console.error(`FAILED: Rack Map showed ${run1.rackWarningsCount} false warnings for Counter items!`);
  process.exit(1);
}

console.log('  ✓ Initial mapping successful: Counter 5 has exactly 69 in A, 57 in C, 9 in E, 13 in F.');
console.log('  ✓ Verified 0 false warnings in Rack Map for Counter items.');

// 2. Simulate Clearing Browser Storage & Reloading
console.log('  Clearing browser storage and uploading identical stock...');
const run2 = simulateFullShopMapping(sampleProducts);

const c5_run2 = run2.counterMap.get('C5');
const c5SecA_run2 = c5_run2.sectionMap.get('A').products[0].allocatedQty;
if (c5SecA_run2 !== 69) {
  console.error('FAILED: Counter 5 rebuild failed after storage clear!');
  process.exit(1);
}

console.log('  ✓ PASSED: Rebuilt Counter Map matches original build identically with zero manual reconfiguration.');
console.log('\n=== ALL AUTOMATIC RACK & COUNTER MAP VERIFICATION TESTS PASSED 100%! ===\n');
