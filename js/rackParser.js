/**
 * Rack String Parser for Maharashtra Automobile
 * Converts raw Product Master rack strings into normalized Rack IDs and Section Codes.
 *
 * Examples:
 *  'R-66 E'     => rackId: 'R66', rackNum: 66, sections: ['E'], hasRecognizableSection: true
 *  'R-60 N & P' => rackId: 'R60', rackNum: 60, sections: ['N', 'P'], hasRecognizableSection: true
 *  'R-1 G'      => rackId: 'R1',  rackNum: 1,  sections: ['G'], hasRecognizableSection: true
 *  'R1 B'       => rackId: 'R1',  rackNum: 1,  sections: ['B'], hasRecognizableSection: true
 *  'R2 C'       => rackId: 'R2',  rackNum: 2,  sections: ['C'], hasRecognizableSection: true
 *  'R-5'        => rackId: 'R5',  rackNum: 5,  sections: ['_UNASSIGNED_'], hasRecognizableSection: false
 *  '1'          => rackId: 'R1',  rackNum: 1,  sections: ['_UNASSIGNED_'], hasRecognizableSection: false
 */

export const UNASSIGNED_SECTION_CODE = '_UNASSIGNED_';

export function parseProductRack(rackStr) {
  if (!rackStr || typeof rackStr !== 'string') {
    return null;
  }

  const clean = rackStr.trim().toUpperCase();
  if (!clean) return null;

  let rackNum = null;
  let remaining = '';

  // Case 1: Standard prefix (R-, RACK, RACK-, R) followed by number
  // e.g. R-66 E, R66 E, RACK-60 N & P, R-1 G
  const prefixMatch = clean.match(/^(?:RACK[-_\s]*|R[-_\s]*)(\d+)(.*)$/i);
  if (prefixMatch) {
    rackNum = parseInt(prefixMatch[1], 10);
    remaining = (prefixMatch[2] || '').trim();
  } else {
    // Case 2: Pure number at beginning e.g. "1", "3", "12 A"
    const numOnlyMatch = clean.match(/^(\d+)(.*)$/);
    if (numOnlyMatch) {
      rackNum = parseInt(numOnlyMatch[1], 10);
      remaining = (numOnlyMatch[2] || '').trim();
    }
  }

  if (rackNum === null || isNaN(rackNum) || rackNum <= 0) {
    return null;
  }

  const rackId = `R${rackNum}`;

  // Parse sections from remaining text
  // Look for single letters or letters separated by &, +, /, and, or, comma
  // e.g. "E" -> ['E'], "N & P" -> ['N', 'P'], "A, B" -> ['A', 'B']
  const sections = [];

  if (remaining) {
    // Remove common extraneous words like "SEC", "SECTION", "BAY"
    const cleanedRemaining = remaining
      .replace(/SECTION|SEC|BAY/gi, ' ')
      .replace(/[-_]/g, ' ')
      .trim();

    // Match individual uppercase letters separated by spaces or punctuation
    const tokens = cleanedRemaining.split(/[\s,&+/]+/).filter(Boolean);
    for (const token of tokens) {
      if (/^[A-Z]$/.test(token)) {
        if (!sections.includes(token)) {
          sections.push(token);
        }
      }
    }
  }

  const hasRecognizableSection = sections.length > 0;

  return {
    rackId,
    rackNum,
    raw: clean,
    sections: hasRecognizableSection ? sections : [UNASSIGNED_SECTION_CODE],
    hasRecognizableSection
  };
}
