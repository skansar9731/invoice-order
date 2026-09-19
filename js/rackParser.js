/**
 * Rack & Counter String Parser for Maharashtra Automobile
 * Converts raw Product Master rack strings into normalized Rack/Counter IDs, Section Codes, and Sub-sections.
 * 
 * 100% Automatic Reference Layer Parser.
 *
 * Rack Examples:
 *  'R-60 A1'    => rackId: 'R60', rackNum: 60, sections: ['A'], locations: [{ section: 'A', subSection: '1', label: 'A1' }]
 *  'R-60 B1'    => rackId: 'R60', rackNum: 60, sections: ['B'], locations: [{ section: 'B', subSection: '1', label: 'B1' }]
 *  'R-60 C2'    => rackId: 'R60', rackNum: 60, sections: ['C'], locations: [{ section: 'C', subSection: '2', label: 'C2' }]
 *  'R-60 D7'    => rackId: 'R60', rackNum: 60, sections: ['D'], locations: [{ section: 'D', subSection: '7', label: 'D7' }]
 *  'R-15 ABC'   => rackId: 'R15', rackNum: 15, sections: ['A', 'B', 'C'], locations: [{ section: 'A' }, { section: 'B' }, { section: 'C' }]
 *  'R-72 A & B' => rackId: 'R72', rackNum: 72, sections: ['A', 'B'], locations: [{ section: 'A' }, { section: 'B' }]
 *  'R-72 N & P' => rackId: 'R72', rackNum: 72, sections: ['N', 'P'], locations: [{ section: 'N' }, { section: 'P' }]
 *  'R-5'        => rackId: 'R5',  rackNum: 5,  sections: ['_UNASSIGNED_'], hasRecognizableSection: false
 *
 * Counter Examples:
 *  'C-5 A'      => counterId: 'C5', counterNum: 5, sections: ['A'], locations: [{ section: 'A', subSection: null, label: 'A' }]
 *  'C-5 A1'     => counterId: 'C5', counterNum: 5, sections: ['A'], locations: [{ section: 'A', subSection: '1', label: 'A1' }]
 *  'COUNTER 5'  => counterId: 'C5', counterNum: 5, sections: ['_UNASSIGNED_'], hasRecognizableSection: false
 */

export const UNASSIGNED_SECTION_CODE = '_UNASSIGNED_';

/**
 * Checks if a location string represents a front Counter station rather than a floor Rack
 */
export function isCounterLocation(str) {
  if (!str || typeof str !== 'string') return false;
  const clean = str.trim().toUpperCase();
  return /^(?:COUNTER[-_\s]*|C[-_\s]*)(\d+)/i.test(clean);
}

/**
 * Parse Product Rack Location
 */
export function parseProductRack(rackStr) {
  if (!rackStr || typeof rackStr !== 'string') {
    return null;
  }

  const clean = rackStr.trim().toUpperCase();
  if (!clean) return null;

  // If this string explicitly indicates a Counter station (e.g. C-5 A, COUNTER 1), it is not a Rack
  if (isCounterLocation(clean)) {
    return null;
  }

  let rackNum = null;
  let remaining = '';

  // Case 1: Standard prefix (R-, RACK, RACK-, R) followed by number
  // e.g. R-66 E, R-60 A1, R66 E, RACK-60 N & P, R-1 G, R-15 ABC
  const prefixMatch = clean.match(/^(?:RACK[-_\s]*|R[-_\s]*)(\d+)(.*)$/i);
  if (prefixMatch) {
    rackNum = parseInt(prefixMatch[1], 10);
    remaining = (prefixMatch[2] || '').trim();
  } else {
    // Case 2: Pure number at beginning e.g. "1", "3", "12 A", "60 A1"
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

  const sections = [];
  const locations = [];

  if (remaining) {
    // Clean extraneous descriptors and connectors
    let cleanedRemaining = remaining
      .replace(/SECTION|SEC|BAY/gi, ' ')
      .replace(/\bAND\b/gi, ' ')
      .replace(/[&+,/]/g, ' ')
      .trim();

    // Check for range patterns like "A-C" or "A TO C"
    const rangeMatch = cleanedRemaining.match(/^([A-Z])\s*(?:-|TO)\s*([A-Z])$/i);
    // Check for sub-section ranges like "A1-A4" or "A1 TO A4"
    const subRangeMatch = cleanedRemaining.match(/^([A-Z])(\d+)\s*(?:-|TO)\s*\1(\d+)$/i);

    if (rangeMatch) {
      const start = rangeMatch[1].toUpperCase().charCodeAt(0);
      const end = rangeMatch[2].toUpperCase().charCodeAt(0);
      if (start <= end && end - start <= 10) {
        for (let code = start; code <= end; code++) {
          const char = String.fromCharCode(code);
          if (!sections.includes(char)) sections.push(char);
          locations.push({ section: char, subSection: null, label: char });
        }
      }
    } else if (subRangeMatch) {
      const secLetter = subRangeMatch[1].toUpperCase();
      const startSub = parseInt(subRangeMatch[2], 10);
      const endSub = parseInt(subRangeMatch[3], 10);
      if (startSub <= endSub && endSub - startSub <= 20) {
        if (!sections.includes(secLetter)) sections.push(secLetter);
        for (let s = startSub; s <= endSub; s++) {
          locations.push({ section: secLetter, subSection: String(s), label: `${secLetter}${s}` });
        }
      }
    } else {
      // Split tokens by spaces or underscores
      const tokens = cleanedRemaining.split(/[\s_]+/).filter(Boolean);

      for (const token of tokens) {
        // Pattern 1: Section + Sub-section e.g. A1, B1, C2, D7, A-1
        const subSecMatch = token.match(/^([A-Z])[-_]?(\d+)$/);
        if (subSecMatch) {
          const sec = subSecMatch[1];
          const sub = subSecMatch[2];
          if (!sections.includes(sec)) sections.push(sec);
          locations.push({ section: sec, subSection: sub, label: `${sec}${sub}` });
          continue;
        }

        // Pattern 2: Single Section Letter e.g. A, B, C, N, P
        if (/^[A-Z]$/.test(token)) {
          if (!sections.includes(token)) sections.push(token);
          locations.push({ section: token, subSection: null, label: token });
          continue;
        }

        // Pattern 3: Contiguous letters e.g. ABC, DEF, AB
        if (/^[A-Z]{2,6}$/.test(token)) {
          for (const char of token) {
            if (!sections.includes(char)) sections.push(char);
            locations.push({ section: char, subSection: null, label: char });
          }
          continue;
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
    locations: hasRecognizableSection ? locations : [{ section: UNASSIGNED_SECTION_CODE, subSection: null, label: 'Unassigned' }],
    hasRecognizableSection
  };
}

/**
 * Parse Product Counter Location
 * e.g. 'C-5 A', 'C-5 A1', 'C5 A', 'COUNTER 5 A', 'COUNTER-5 ABC', 'C-1 A'
 */
export function parseProductCounter(counterStr) {
  if (!counterStr || typeof counterStr !== 'string') {
    return null;
  }

  const clean = counterStr.trim().toUpperCase();
  if (!clean) return null;

  const match = clean.match(/^(?:COUNTER[-_\s]*|C[-_\s]*)(\d+)(.*)$/i);
  if (!match) return null;

  const counterNum = parseInt(match[1], 10);
  if (isNaN(counterNum) || counterNum <= 0) return null;

  const counterId = `C${counterNum}`;
  const remaining = (match[2] || '').trim();

  const sections = [];
  const locations = [];

  if (remaining) {
    let cleanedRemaining = remaining
      .replace(/SECTION|SEC|BAY/gi, ' ')
      .replace(/\bAND\b/gi, ' ')
      .replace(/[&+,/]/g, ' ')
      .trim();

    const rangeMatch = cleanedRemaining.match(/^([A-Z])\s*(?:-|TO)\s*([A-Z])$/i);
    const subRangeMatch = cleanedRemaining.match(/^([A-Z])(\d+)\s*(?:-|TO)\s*\1(\d+)$/i);

    if (rangeMatch) {
      const start = rangeMatch[1].toUpperCase().charCodeAt(0);
      const end = rangeMatch[2].toUpperCase().charCodeAt(0);
      if (start <= end && end - start <= 26) {
        for (let code = start; code <= end; code++) {
          const char = String.fromCharCode(code);
          if (!sections.includes(char)) sections.push(char);
          locations.push({ section: char, subSection: null, label: char });
        }
      }
    } else if (subRangeMatch) {
      const secLetter = subRangeMatch[1].toUpperCase();
      const startSub = parseInt(subRangeMatch[2], 10);
      const endSub = parseInt(subRangeMatch[3], 10);
      if (startSub <= endSub && endSub - startSub <= 20) {
        if (!sections.includes(secLetter)) sections.push(secLetter);
        for (let s = startSub; s <= endSub; s++) {
          locations.push({ section: secLetter, subSection: String(s), label: `${secLetter}${s}` });
        }
      }
    } else {
      const tokens = cleanedRemaining.split(/[\s_]+/).filter(Boolean);

      for (const token of tokens) {
        const subSecMatch = token.match(/^([A-Z])[-_]?(\d+)$/);
        if (subSecMatch) {
          const sec = subSecMatch[1];
          const sub = subSecMatch[2];
          if (!sections.includes(sec)) sections.push(sec);
          locations.push({ section: sec, subSection: sub, label: `${sec}${sub}` });
          continue;
        }

        if (/^[A-Z]$/.test(token)) {
          if (!sections.includes(token)) sections.push(token);
          locations.push({ section: token, subSection: null, label: token });
          continue;
        }

        if (/^[A-Z]{2,6}$/.test(token)) {
          for (const char of token) {
            if (!sections.includes(char)) sections.push(char);
            locations.push({ section: char, subSection: null, label: char });
          }
          continue;
        }
      }
    }
  }

  const hasRecognizableSection = sections.length > 0;

  return {
    counterId,
    counterNum,
    raw: clean,
    sections: hasRecognizableSection ? sections : [UNASSIGNED_SECTION_CODE],
    locations: hasRecognizableSection ? locations : [{ section: UNASSIGNED_SECTION_CODE, subSection: null, label: 'Unassigned' }],
    hasRecognizableSection
  };
}

/**
 * Distribute total quantity across multiple locations as evenly as possible.
 */
export function distributeQuantityAcrossSections(totalQty, numSections) {
  const n = numSections;
  if (!n || n <= 1) {
    return [Number(totalQty) || 0];
  }

  const raw = Number(totalQty);
  if (isNaN(raw) || raw <= 0) {
    return new Array(n).fill(0);
  }

  const isFloat = raw % 1 !== 0;
  if (isFloat) {
    let remaining = raw;
    const result = [];
    for (let i = 0; i < n; i++) {
      const remSections = n - i;
      if (remSections === 1) {
        result.push(Math.round(remaining * 1000) / 1000);
      } else {
        const share = Math.round((remaining / remSections) * 1000) / 1000;
        result.push(share);
        remaining -= share;
      }
    }
    return result;
  }

  const base = Math.floor(raw / n);
  const remainder = raw % n;
  const result = [];
  for (let i = 0; i < n; i++) {
    result.push(i < remainder ? base + 1 : base);
  }
  return result;
}
