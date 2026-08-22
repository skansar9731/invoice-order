import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const pdfPath = 'C:\\Users\\tyrtrt\\Downloads\\totsl stock list.pdf';
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;

function testParseRowText(rawName, existingAlias) {
  let text = rawName.trim();
  let alias = (existingAlias || '').trim();
  let rate = null;

  // Check if text has a rate marker like " 193/- " followed by alias text
  const rateWithTrailingAlias = text.match(/^(.*?)\s+(\d+(?:\.\d+)?\s*(?:\/[-–—.]*|\/\s*\d+[-–—.]*|\s*\/)?(?:\s+\d+(?:\.\d+)?\s*(?:\/[-–—.]*)?)*)\s+([A-Za-z0-9\-_./].*)$/);
  
  if (rateWithTrailingAlias) {
    text = rateWithTrailingAlias[1].trim();
    const rateStr = rateWithTrailingAlias[2].trim();
    const trailingAlias = rateWithTrailingAlias[3].trim();
    
    const numMatch = rateStr.match(/\d+(?:\.\d+)?/);
    if (numMatch) rate = parseFloat(numMatch[0]);
    if (!alias) alias = trailingAlias;
  } else {
    // Normal rate at end of name
    const rateMatch = text.match(/^(.*?)\s+(\d+(?:\.\d+)?\s*(?:\/[-–—.]*|\/\s*\d+[-–—.]*|\s*\/)?(?:\s+\d+(?:\.\d+)?\s*(?:\/[-–—.]*)?)*)$/);
    if (rateMatch && rateMatch[1].length > 3) {
      text = rateMatch[1].trim();
      const numMatch = rateMatch[2].match(/\d+(?:\.\d+)?/);
      if (numMatch) rate = parseFloat(numMatch[0]);
    }
  }

  // Split Part Number and Product Name
  let partNumber = '';
  let productName = '';

  // Glued check: e.g. "13011krm305spiston Ring Std C B Z" or "14400KWP901TEMING CHAIN ACTIVA"
  const gluedMatch = text.match(/^([0-9][0-9A-Za-z]{3,14}[0-9A-Za-z])([A-Za-z].{3,})$/);
  if (gluedMatch && !text.startsWith('4T') && !text.startsWith('20K') && !text.startsWith('21K') && !text.startsWith('22K') && !text.startsWith('24K') && !text.startsWith('25K') && !text.startsWith('26K') && !text.startsWith('36D')) {
    const secondPart = gluedMatch[2];
    if (/^(piston|teming|timing|clutch|valve|brake|oil|chain|gear|cover|ring|cable|filter|rocker|element)/i.test(secondPart)) {
      partNumber = gluedMatch[1];
      productName = secondPart;
    }
  }

  if (!partNumber) {
    const tokens = text.split(/\s+/);
    if (tokens.length >= 2) {
      const firstToken = tokens[0];
      const isPartNo = /^[A-Z0-9\-_./]+$/i.test(firstToken) && 
        (firstToken.length >= 3 || /^\d+$/.test(firstToken)) &&
        !['TOTAL', 'PAGE', 'GRAND', 'MAHARASHTRA', 'LIST', 'NAME', 'CASH', 'BILL', 'TATA', 'CASTROL', 'MEERO', 'HERO', 'HONDA', 'BAJAJ', 'BOSCH', 'ZODIX', 'STAR', 'MINDA', 'ASK', 'VARROC', 'ENDURANCE', 'ROLON'].includes(firstToken.toUpperCase());

      if (isPartNo) {
        partNumber = firstToken;
        productName = tokens.slice(1).join(' ');
      } else {
        partNumber = text;
        productName = text;
      }
    } else {
      partNumber = text;
      productName = text;
    }
  }

  return { partNumber: partNumber.trim(), productName: productName.trim(), alias, rate };
}

// Test page 7 rows
const page7 = await pdf.getPage(7);
const tc7 = await page7.getTextContent();
const itemsByY = {};
for (const item of tc7.items) {
  if (!item.str || !item.str.trim()) continue;
  const yKey = Math.round(item.transform[5] / 3) * 3;
  if (!itemsByY[yKey]) itemsByY[yKey] = [];
  itemsByY[yKey].push({ x: item.transform[4], text: item.str });
}

for (const y of Object.keys(itemsByY).map(Number).sort((a, b) => b - a)) {
  const row = itemsByY[y].sort((a, b) => a.x - b.x);
  const nameItem = row.find(i => i.x < 205);
  const aliasItem = row.find(i => i.x >= 205 && i.x < 369);
  if (nameItem) {
    const res = testParseRowText(nameItem.text, aliasItem?.text);
    if (res.partNumber.includes('14401K0ND00') || res.partNumber.includes('14400KWP901') || res.partNumber.includes('14401k76t61') || res.partNumber.includes('14401K43901')) {
      console.log('Result:', res);
    }
  }
}
