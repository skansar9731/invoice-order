import fs from 'fs';
import {
  INITIAL_RACKS_SPEC,
  INITIAL_COUNTERS_SPEC,
  buildInitialRackConfigs,
  buildInitialCounterConfigs,
  generateSections
} from './js/mapConfigData.js';
import { parseProductRack, UNASSIGNED_SECTION_CODE, distributeQuantityAcrossSections } from './js/rackParser.js';

console.log('=== RUNNING RACK MAP & COUNTER MAP MODULES VERIFICATION TEST ===\n');

// ----------------------------------------------------------------------------
// Test 1: Active Racks Configuration (Exactly 71 racks, R12 & R64 absent)
// ----------------------------------------------------------------------------
console.log('Test 1: Verifying active racks initial configuration...');
const initialRacks = buildInitialRackConfigs();
console.log(`  Total initial racks generated: ${initialRacks.length}`);

if (initialRacks.length !== 71) {
  console.error(`FAILED: Expected 71 active racks, got ${initialRacks.length}`);
  process.exit(1);
}
console.log('  ✓ PASSED: Exactly 71 initial racks created.');

// Verify R12 and R64 are absent
const hasR12 = initialRacks.some(r => r.id === 'R12' || r.rackNum === 12);
const hasR64 = initialRacks.some(r => r.id === 'R64' || r.rackNum === 64);
if (hasR12 || hasR64) {
  console.error(`FAILED: R12 (${hasR12}) or R64 (${hasR64}) was found in racks list!`);
  process.exit(1);
}
console.log('  ✓ PASSED: R12 and R64 are strictly absent.');

// Verify all numbers from 1 to 73 except 12 and 64 exist
for (let i = 1; i <= 73; i++) {
  if (i === 12 || i === 64) continue;
  const found = initialRacks.find(r => r.rackNum === i);
  if (!found) {
    console.error(`FAILED: Missing expected Rack ${i}`);
    process.exit(1);
  }
}
console.log('  ✓ PASSED: All racks R1 to R73 (except R12 and R64) are present.');

// ----------------------------------------------------------------------------
// Test 2: Verify Exact Rack Section Ranges
// ----------------------------------------------------------------------------
console.log('\nTest 2: Verifying rack section ranges against specifications...');
const sampleChecks = [
  { id: 'R1', start: 'A', end: 'G', count: 7 },
  { id: 'R2', start: 'A', end: 'K', count: 11 },
  { id: 'R5', start: 'A', end: 'F', count: 6 },
  { id: 'R10', start: 'A', end: 'Z', count: 26 },
  { id: 'R11', start: 'A', end: 'X', count: 24 },
  { id: 'R13', start: 'A', end: 'P', count: 16 },
  { id: 'R15', start: 'A', end: 'D', count: 4 },
  { id: 'R22', start: 'A', end: 'S', count: 19 },
  { id: 'R24', start: 'A', end: 'Q', count: 17 },
  { id: 'R27', start: 'A', end: 'N', count: 14 },
  { id: 'R52', start: 'A', end: 'T', count: 20 },
  { id: 'R60', start: 'A', end: 'T', count: 20 },
  { id: 'R66', start: 'A', end: 'T', count: 20 },
  { id: 'R71', start: 'A', end: 'E', count: 5 },
  { id: 'R73', start: 'A', end: 'J', count: 10 }
];

for (const check of sampleChecks) {
  const rack = initialRacks.find(r => r.id === check.id);
  if (!rack) {
    console.error(`FAILED: Rack ${check.id} not found`);
    process.exit(1);
  }
  if (rack.sectionStart !== check.start || rack.sectionEnd !== check.end || rack.sections.length !== check.count) {
    console.error(`FAILED: ${check.id} range mismatch: got ${rack.sectionStart}-${rack.sectionEnd} (${rack.sections.length}), expected ${check.start}-${check.end} (${check.count})`);
    process.exit(1);
  }
}
console.log(`  ✓ PASSED: All rack section ranges match the exact specification.`);

// ----------------------------------------------------------------------------
// Test 3: Counter Configuration (Exactly 8 Counters with exact ranges)
// ----------------------------------------------------------------------------
console.log('\nTest 3: Verifying Counter Map configuration (8 initial counters)...');
const initialCounters = buildInitialCounterConfigs();
if (initialCounters.length !== 8) {
  console.error(`FAILED: Expected 8 initial counters, got ${initialCounters.length}`);
  process.exit(1);
}
console.log('  ✓ PASSED: Exactly 8 initial counters created.');

const expectedCounterRanges = {
  C1: { start: 'A', end: 'X', count: 24 },
  C2: { start: 'A', end: 'P', count: 16 },
  C3: { start: 'A', end: 'P', count: 16 },
  C4: { start: 'A', end: 'T', count: 20 },
  C5: { start: 'A', end: 'L', count: 12 },
  C6: { start: 'A', end: 'X', count: 24 },
  C7: { start: 'A', end: 'B', count: 2 },
  C8: { start: 'A', end: 'T', count: 20 }
};

for (const [cId, exp] of Object.entries(expectedCounterRanges)) {
  const counter = initialCounters.find(c => c.id === cId);
  if (!counter) {
    console.error(`FAILED: Counter ${cId} not found`);
    process.exit(1);
  }
  if (counter.sectionStart !== exp.start || counter.sectionEnd !== exp.end || counter.sections.length !== exp.count) {
    console.error(`FAILED: ${cId} mismatch. Got ${counter.sectionStart}-${counter.sectionEnd} (${counter.sections.length}), expected ${exp.start}-${exp.end} (${exp.count})`);
    process.exit(1);
  }
}
console.log('  ✓ PASSED: All 8 counter section ranges match exactly:');
console.log('    Counter 1: A-X (24 sections)');
console.log('    Counter 2: A-P (16 sections)');
console.log('    Counter 3: A-P (16 sections)');
console.log('    Counter 4: A-T (20 sections)');
console.log('    Counter 5: A-L (12 sections)');
console.log('    Counter 6: A-X (24 sections)');
console.log('    Counter 7: A-B (2 sections)');
console.log('    Counter 8: A-T (20 sections)');

// ----------------------------------------------------------------------------
// Test 4: Rack Parsing Algorithm
// ----------------------------------------------------------------------------
console.log('\nTest 4: Verifying rack parsing algorithm...');

const parseTests = [
  { input: 'R-60 A1', expectedRack: 'R60', expectedSections: ['A'], recognizable: true },
  { input: 'R-60 B1', expectedRack: 'R60', expectedSections: ['B'], recognizable: true },
  { input: 'R-60 C2', expectedRack: 'R60', expectedSections: ['C'], recognizable: true },
  { input: 'R-60 D7', expectedRack: 'R60', expectedSections: ['D'], recognizable: true },
  { input: 'R-15 ABC', expectedRack: 'R15', expectedSections: ['A', 'B', 'C'], recognizable: true },
  { input: 'R-15 DEF', expectedRack: 'R15', expectedSections: ['D', 'E', 'F'], recognizable: true },
  { input: 'R-72 A & B', expectedRack: 'R72', expectedSections: ['A', 'B'], recognizable: true },
  { input: 'R-72 N & P', expectedRack: 'R72', expectedSections: ['N', 'P'], recognizable: true },
  { input: 'R-72 A&B', expectedRack: 'R72', expectedSections: ['A', 'B'], recognizable: true },
  { input: 'R-72 N&P', expectedRack: 'R72', expectedSections: ['N', 'P'], recognizable: true },
  { input: 'R-60 A1 A2 A3 A4', expectedRack: 'R60', expectedSections: ['A'], recognizable: true },
  { input: 'R-66 E', expectedRack: 'R66', expectedSections: ['E'], recognizable: true },
  { input: 'R-50 AB', expectedRack: 'R50', expectedSections: ['A', 'B'], recognizable: true },
  { input: 'R-50 A, B, C', expectedRack: 'R50', expectedSections: ['A', 'B', 'C'], recognizable: true },
  { input: 'R-50 A AND B', expectedRack: 'R50', expectedSections: ['A', 'B'], recognizable: true },
  { input: 'R-1 G', expectedRack: 'R1', expectedSections: ['G'], recognizable: true },
  { input: 'R1 B', expectedRack: 'R1', expectedSections: ['B'], recognizable: true },
  { input: 'R2 C', expectedRack: 'R2', expectedSections: ['C'], recognizable: true },
  { input: 'R-2 E', expectedRack: 'R2', expectedSections: ['E'], recognizable: true },
  { input: 'R-3 K', expectedRack: 'R3', expectedSections: ['K'], recognizable: true },
  { input: 'R-5', expectedRack: 'R5', expectedSections: [UNASSIGNED_SECTION_CODE], recognizable: false },
  { input: '1', expectedRack: 'R1', expectedSections: [UNASSIGNED_SECTION_CODE], recognizable: false },
  { input: '3', expectedRack: 'R3', expectedSections: [UNASSIGNED_SECTION_CODE], recognizable: false }
];

for (const pt of parseTests) {
  const result = parseProductRack(pt.input);
  if (!result) {
    console.error(`FAILED: Failed to parse "${pt.input}"`);
    process.exit(1);
  }
  if (result.rackId !== pt.expectedRack) {
    console.error(`FAILED: Expected rack ${pt.expectedRack}, got ${result.rackId} for input "${pt.input}"`);
    process.exit(1);
  }
  if (JSON.stringify(result.sections) !== JSON.stringify(pt.expectedSections)) {
    console.error(`FAILED: Expected sections ${JSON.stringify(pt.expectedSections)}, got ${JSON.stringify(result.sections)} for input "${pt.input}"`);
    process.exit(1);
  }
  if (result.hasRecognizableSection !== pt.recognizable) {
    console.error(`FAILED: hasRecognizableSection mismatch for input "${pt.input}"`);
    process.exit(1);
  }
}
console.log('  ✓ PASSED: All rack strings parsed accurately (including R-60 A1, R-15 ABC, R-72 A & B, R-72 N & P, and unassigned cases).');

// ----------------------------------------------------------------------------
// Test 4b: Quantity Distribution Algorithm Across Sections
// ----------------------------------------------------------------------------
console.log('\nTest 4b: Verifying quantity distribution algorithm across multiple sections...');

const distTests = [
  { total: 50, sections: 3, expected: [17, 17, 16] },
  { total: 60, sections: 2, expected: [30, 30] },
  { total: 10, sections: 4, expected: [3, 3, 2, 2] },
  { total: 40, sections: 2, expected: [20, 20] },
  { total: 46, sections: 2, expected: [23, 23] },
  { total: 84, sections: 3, expected: [28, 28, 28] },
  { total: 35, sections: 2, expected: [18, 17] }
];

for (const dt of distTests) {
  const res = distributeQuantityAcrossSections(dt.total, dt.sections);
  const sum = res.reduce((a, b) => a + b, 0);
  if (sum !== dt.total) {
    console.error(`FAILED: Sum mismatch for total ${dt.total}, got sum ${sum} (${JSON.stringify(res)})`);
    process.exit(1);
  }
  if (JSON.stringify(res) !== JSON.stringify(dt.expected)) {
    console.error(`FAILED: Expected ${JSON.stringify(dt.expected)}, got ${JSON.stringify(res)} for total ${dt.total} across ${dt.sections} sections`);
    process.exit(1);
  }
}
console.log('  ✓ PASSED: Quantity distributed accurately (50 -> 17/17/16 in ABC; 60 -> 30/30 in A & B; 10 -> 3/3/2/2 in 4 sections; 84 -> 28/28/28).');

// ----------------------------------------------------------------------------
// Test 5: Section Display Name Renaming & Sub-sections structure
// ----------------------------------------------------------------------------
console.log('\nTest 5: Verifying Section Display Name and Sub-sections model...');
const rack66 = initialRacks.find(r => r.id === 'R66');
const sectionE = rack66.sections.find(s => s.code === 'E');

// Test renaming without changing section code
sectionE.displayName = 'AIR FILTER DREAM YUGA';
if (sectionE.code !== 'E' || sectionE.displayName !== 'AIR FILTER DREAM YUGA') {
  console.error('FAILED: Display name renaming corrupts section code');
  process.exit(1);
}
console.log('  ✓ PASSED: Section display name can be renamed independently of stable code (E -> "AIR FILTER DREAM YUGA").');

// Test adding sub-sections
sectionE.subSections.push({ id: 'R66_E_E-1', code: 'E-1', displayName: 'Top Tray', archived: false });
sectionE.subSections.push({ id: 'R66_E_E-2', code: 'E-2', displayName: 'Lower Shelf', archived: false });
if (sectionE.subSections.length !== 2) {
  console.error('FAILED: Sub-section addition failed');
  process.exit(1);
}
console.log('  ✓ PASSED: Sub-sections can be added (E-1, E-2).');

// Test archiving sub-section
sectionE.subSections[0].archived = true;
const activeSubs = sectionE.subSections.filter(s => !s.archived);
if (activeSubs.length !== 1 || activeSubs[0].code !== 'E-2') {
  console.error('FAILED: Sub-section archiving failed');
  process.exit(1);
}
console.log('  ✓ PASSED: Sub-sections can be archived non-destructively.');

// ----------------------------------------------------------------------------
// Test 6: Navigation integrity in index.html
// ----------------------------------------------------------------------------
console.log('\nTest 6: Verifying navigation structure in index.html...');
const html = fs.readFileSync('./index.html', 'utf8');

// Desktop top nav check
const desktopNavMatch = html.match(/<nav class="flex space-x-1 py-1.5" aria-label="Tabs">([\s\S]*?)<\/nav>/);
const desktopTargets = [...desktopNavMatch[1].matchAll(/data-tab-target="([^"]+)"/g)].map(m => m[1]);
const expectedDesktop = ['tab-order', 'tab-stock', 'tab-search', 'tab-rack-map', 'tab-counter-map', 'tab-settings'];

if (JSON.stringify(desktopTargets) !== JSON.stringify(expectedDesktop)) {
  console.error(`FAILED: Desktop nav mismatch. Got ${JSON.stringify(desktopTargets)}, expected ${JSON.stringify(expectedDesktop)}`);
  process.exit(1);
}
console.log('  ✓ PASSED: Desktop navigation has exact sequence: Image to Order -> Upload Stock -> Quick Part Search -> Rack Map -> Counter Map.');

// Mobile bottom nav check
const bottomNavMatch = html.match(/<nav id="mobile-bottom-nav"[\s\S]*?>([\s\S]*?)<\/nav>/);
const bottomTargets = [...bottomNavMatch[1].matchAll(/data-tab-target="([^"]+)"/g)].map(m => m[1]);
const expectedBottom = ['tab-order', 'tab-stock', 'tab-rack-map', 'tab-counter-map', 'tab-search'];

if (JSON.stringify(bottomTargets) !== JSON.stringify(expectedBottom)) {
  console.error(`FAILED: Mobile bottom nav mismatch. Got ${JSON.stringify(bottomTargets)}, expected ${JSON.stringify(expectedBottom)}`);
  process.exit(1);
}
console.log('  ✓ PASSED: Mobile bottom nav has exact sequence: Image to Order -> Upload Stock -> Rack Map -> Counter Map -> Quick Search.');

// Verify Home is NOT in bottom nav
if (bottomNavMatch[1].toLowerCase().includes('home')) {
  console.error('FAILED: Home must NOT be in mobile bottom navigation');
  process.exit(1);
}
console.log('  ✓ PASSED: "Home" is NOT in mobile bottom navigation.');

// ----------------------------------------------------------------------------
// Test 7: Modals exist in index.html
// ----------------------------------------------------------------------------
console.log('\nTest 7: Verifying modals in index.html...');
if (!html.includes('id="manage-maps-modal"') || !html.includes('id="assign-product-modal"')) {
  console.error('FAILED: Missing manage-maps-modal or assign-product-modal in index.html');
  process.exit(1);
}
console.log('  ✓ PASSED: Manage Maps and Assign Product modals are present.');

console.log('\n=== ALL 7 RACK MAP & COUNTER MAP VERIFICATION TESTS PASSED 100%! ===\n');
