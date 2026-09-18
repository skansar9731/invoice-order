/**
 * Initial Configurations for Rack Map (71 Active Racks) and Counter Map (8 Counters)
 * Maharashtra Automobile — Physical Shop Floor Mapping System
 */

/**
 * Generate alphabet sections from startChar to endChar (inclusive)
 * e.g. ('A', 'G') => [{ code: 'A', displayName: '', subSections: [] }, ...]
 */
export function generateSections(startChar, endChar) {
  const startCode = startChar.toUpperCase().charCodeAt(0);
  const endCode = endChar.toUpperCase().charCodeAt(0);
  const sections = [];

  for (let code = startCode; code <= endCode; code++) {
    sections.push({
      code: String.fromCharCode(code),
      displayName: '',
      archived: false,
      subSections: []
    });
  }
  return sections;
}

/**
 * EXACT 71 Active Racks specification:
 * R1 to R73 excluding R12 and R64
 */
export const INITIAL_RACKS_SPEC = [
  { num: 1, range: ['A', 'G'] },
  { num: 2, range: ['A', 'K'] },
  { num: 3, range: ['A', 'K'] },
  { num: 4, range: ['A', 'K'] },
  { num: 5, range: ['A', 'F'] },
  { num: 6, range: ['A', 'J'] },
  { num: 7, range: ['A', 'J'] },
  { num: 8, range: ['A', 'J'] },
  { num: 9, range: ['A', 'K'] },
  { num: 10, range: ['A', 'Z'] },
  { num: 11, range: ['A', 'X'] },
  // R12 does NOT exist
  { num: 13, range: ['A', 'P'] },
  { num: 14, range: ['A', 'X'] },
  { num: 15, range: ['A', 'D'] },
  { num: 16, range: ['A', 'D'] },
  { num: 17, range: ['A', 'G'] },
  { num: 18, range: ['A', 'F'] },
  { num: 19, range: ['A', 'G'] },
  { num: 20, range: ['A', 'F'] },
  { num: 21, range: ['A', 'E'] },
  { num: 22, range: ['A', 'S'] },
  { num: 23, range: ['A', 'S'] },
  { num: 24, range: ['A', 'Q'] },
  { num: 25, range: ['A', 'Q'] },
  { num: 26, range: ['A', 'Q'] },
  { num: 27, range: ['A', 'N'] },
  { num: 28, range: ['A', 'N'] },
  { num: 29, range: ['A', 'N'] },
  { num: 30, range: ['A', 'K'] },
  { num: 31, range: ['A', 'J'] },
  { num: 32, range: ['A', 'J'] },
  { num: 33, range: ['A', 'J'] },
  { num: 34, range: ['A', 'F'] },
  { num: 35, range: ['A', 'R'] },
  { num: 36, range: ['A', 'R'] },
  { num: 37, range: ['A', 'N'] },
  { num: 38, range: ['A', 'G'] },
  { num: 39, range: ['A', 'X'] },
  { num: 40, range: ['A', 'X'] },
  { num: 41, range: ['A', 'X'] },
  { num: 42, range: ['A', 'X'] },
  { num: 43, range: ['A', 'J'] },
  { num: 44, range: ['A', 'J'] },
  { num: 45, range: ['A', 'J'] },
  { num: 46, range: ['A', 'J'] },
  { num: 47, range: ['A', 'J'] },
  { num: 48, range: ['A', 'J'] },
  { num: 49, range: ['A', 'K'] },
  { num: 50, range: ['A', 'R'] },
  { num: 51, range: ['A', 'R'] },
  { num: 52, range: ['A', 'T'] },
  { num: 53, range: ['A', 'T'] },
  { num: 54, range: ['A', 'R'] },
  { num: 55, range: ['A', 'R'] },
  { num: 56, range: ['A', 'R'] },
  { num: 57, range: ['A', 'R'] },
  { num: 58, range: ['A', 'X'] },
  { num: 59, range: ['A', 'X'] },
  { num: 60, range: ['A', 'T'] },
  { num: 61, range: ['A', 'R'] },
  { num: 62, range: ['A', 'R'] },
  { num: 63, range: ['A', 'R'] },
  // R64 does NOT exist
  { num: 65, range: ['A', 'T'] },
  { num: 66, range: ['A', 'T'] },
  { num: 67, range: ['A', 'T'] },
  { num: 68, range: ['A', 'R'] },
  { num: 69, range: ['A', 'P'] },
  { num: 70, range: ['A', 'R'] },
  { num: 71, range: ['A', 'E'] },
  { num: 72, range: ['A', 'N'] },
  { num: 73, range: ['A', 'J'] }
];

/**
 * EXACT 8 Initial Counters specification
 */
export const INITIAL_COUNTERS_SPEC = [
  { num: 1, range: ['A', 'X'] },
  { num: 2, range: ['A', 'P'] },
  { num: 3, range: ['A', 'P'] },
  { num: 4, range: ['A', 'T'] },
  { num: 5, range: ['A', 'L'] },
  { num: 6, range: ['A', 'X'] },
  { num: 7, range: ['A', 'B'] },
  { num: 8, range: ['A', 'T'] }
];

/**
 * Build initial Rack configuration array for IndexedDB seed
 */
export function buildInitialRackConfigs() {
  return INITIAL_RACKS_SPEC.map(spec => ({
    id: `R${spec.num}`,
    rackNum: spec.num,
    name: `Rack ${spec.num}`,
    sectionStart: spec.range[0],
    sectionEnd: spec.range[1],
    archived: false,
    createdAt: Date.now(),
    sections: generateSections(spec.range[0], spec.range[1])
  }));
}

/**
 * Build initial Counter configuration array for IndexedDB seed
 */
export function buildInitialCounterConfigs() {
  return INITIAL_COUNTERS_SPEC.map(spec => ({
    id: `C${spec.num}`,
    counterNum: spec.num,
    name: `Counter ${spec.num}`,
    sectionStart: spec.range[0],
    sectionEnd: spec.range[1],
    archived: false,
    createdAt: Date.now(),
    sections: generateSections(spec.range[0], spec.range[1])
  }));
}
