// Mock browser globals
let toastMessages = [];
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 1);

let eventListeners = {};

const createMockContainer = (id) => {
  const children = [];
  const container = {
    id,
    classList: {
      _classes: new Set(),
      add: (c) => container.classList._classes.add(c),
      remove: (c) => container.classList._classes.delete(c),
      contains: (c) => container.classList._classes.has(c)
    },
    children,
    appendChild: (el) => children.push(el),
    set innerHTML(val) { children.length = 0; container._innerHTML = val; },
    get innerHTML() { return container._innerHTML || ''; },
    querySelectorAll: (sel) => children,
    addEventListener: (evt, cb) => {
      eventListeners[id + ':' + evt] = cb;
    },
    dispatchEvent: (evt) => {
      const cb = eventListeners[id + ':' + evt.type];
      if (cb) cb(evt);
    }
  };
  return container;
};

const domElements = {
  'order-image-input': { value: '', click: () => {} },
  'order-dropzone': { classList: { add: () => {}, remove: () => {} } },
  'btn-browse-order-image': {},
  'btn-add-more-images': {},
  'btn-clear-all-images': {},
  'btn-new-order': {},
  'order-customer-name': { value: 'Ramesh Garage' },
  'order-number-display': { textContent: 'ORD-1234' },
  'image-gallery-container': { classList: { add: () => {}, remove: () => {}, contains: () => false } },
  'gallery-image-count': { textContent: '' },
  'image-thumbnails-grid': { innerHTML: '', querySelectorAll: () => [] },
  'stat-ai-status': { textContent: '', className: '' },
  'ai-processing-overlay': { classList: { add: () => {}, remove: () => {} } },
  'ai-processing-step': { textContent: '' },
  'ai-processing-pages-list': { innerHTML: '' },
  'toast-container': { appendChild: (el) => { toastMessages.push({ msg: el.textContent, type: el.dataset.type }); } },
  'order-table-container': createMockContainer('order-table-container'),
  'order-table-body': createMockContainer('order-table-body'),
  'order-cards-container': createMockContainer('order-cards-container'),
  'stat-total-items': { textContent: '' },
  'stat-matched-count': { textContent: '' },
  'stat-pending-count': { textContent: '' },
  'stat-order-progress': { textContent: '' },
  'summary-total-items': { textContent: '' },
  'summary-matched-items': { textContent: '' },
  'summary-manual-items': { textContent: '' },
  'summary-unmatched-items': { textContent: '' },
  'summary-unmatched-badge': { classList: { add: () => {}, remove: () => {} } },
  'summary-lowstock-items': { textContent: '' },
  'summary-lowstock-badge': { classList: { add: () => {}, remove: () => {} } },
  'order-empty-state': { classList: { add: () => {}, remove: () => {} } },
  'manual-search-results': createMockContainer('manual-search-results'),
  'manual-search-count': { textContent: '' },
  'finder-results-container': createMockContainer('finder-results-container'),
  'finder-results-count': { textContent: '' }
};

globalThis.document = {
  getElementById: (id) => domElements[id] || null,
  querySelectorAll: () => [],
  addEventListener: (evt, cb) => {},
  createElement: (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      classList: { add: () => {}, remove: () => {} },
      dataset: {},
      style: {},
      children: [],
      appendChild: (child) => el.children.push(child),
      remove: () => {},
      set textContent(v) { el._text = v; },
      get textContent() { return el._text || ''; },
      set innerHTML(v) { el._html = v; },
      get innerHTML() { return el._html || ''; }
    };
    return el;
  },
  body: {
    appendChild: () => {}
  }
};

globalThis.window = globalThis;

// Import ui and order manager
const { renderOrderTable, initUIEventListeners, performManualModalSearch } = await import('./js/ui.js');
const { setOrderItems, getCurrentOrder, resetOrder } = await import('./js/orderManager.js');

console.log('=== RUNNING RESPONSIVE MOBILE CARDS VERIFICATION TESTS ===\n');

// 1. Setup Order Items
const sampleItems = [
  {
    id: 'item-1',
    sNo: 1,
    customerText: 'Teming Chain Shine BS6',
    quantity: 3,
    matchedProduct: {
      partNumber: '14401K0ND00',
      productName: 'TEMING CHAINE SHINE BS6',
      rack: 'R-3 K',
      unit: 'Pcs.',
      stockQty: 7,
      rate: 180
    },
    confidence: 95,
    tier: 'HIGH',
    isManual: false,
    sourceImage: 1,
    candidates: [
      { product: { partNumber: '14401K0ND00', productName: 'TEMING CHAINE SHINE BS6' }, confidence: 95 },
      { product: { partNumber: '14401K0ND01', productName: 'TEMING CHAIN ALTERNATIVE' }, confidence: 80 }
    ]
  },
  {
    id: 'item-2',
    sNo: 2,
    customerText: 'Unknown Lever X',
    quantity: 5,
    matchedProduct: null,
    confidence: 0,
    tier: 'NONE',
    isManual: false,
    sourceImage: 2,
    candidates: []
  }
];

setOrderItems(sampleItems);
initUIEventListeners();
renderOrderTable();

// TEST 1: Check both desktop table and mobile cards are generated
console.log('Test 1: Testing dual-view generation (Desktop Table + Mobile Cards)...');
const desktopRows = domElements['order-table-body'].children;
const mobileCards = domElements['order-cards-container'].children;

console.log(`  Desktop table rows: ${desktopRows.length}`);
console.log(`  Mobile cards: ${mobileCards.length}`);

if (desktopRows.length === 2 && mobileCards.length === 2) {
  console.log('  ✓ PASSED: Both desktop table rows and mobile cards populated simultaneously.');
} else {
  console.error('  ✕ FAILED: Elements not populated correctly in dual-view containers!');
  process.exit(1);
}

// TEST 2: Inspect Mobile Card Contents
console.log('\nTest 2: Inspecting mobile card structure & responsive attributes...');
const card1Html = mobileCards[0].innerHTML;
const card2Html = mobileCards[1].innerHTML;

const hasCard1Item = card1Html.includes('TEMING CHAINE SHINE BS6');
const hasCard1Rack = card1Html.includes('R-3 K');
const hasCard1Stock = card1Html.includes('7') && card1Html.includes('Pcs.');
const hasCard1PageBadge = card1Html.includes('#P1');
const hasCard1MatchBadge = card1Html.includes('95% Match');
const hasCard2NoMatch = card2Html.includes('No reliable automatic match found');
const hasCard2ManualBtn = card2Html.includes('Select Manually');

if (hasCard1Item && hasCard1Rack && hasCard1Stock && hasCard1PageBadge && hasCard1MatchBadge && hasCard2NoMatch && hasCard2ManualBtn) {
  console.log('  ✓ PASSED: Mobile cards contain complete responsive layout (Item Details, Rack, Stock, Page Badge, Match Rating, Actions).');
} else {
  console.error('  ✕ FAILED: Mobile card HTML missing crucial metadata!');
  process.exit(1);
}

// TEST 3: Action Dispatching via Unified Table Container (inc-qty)
console.log('\nTest 3: Testing mobile card Quantity increment (+)...');
const mockIncTarget = {
  dataset: { action: 'inc-qty', itemId: 'item-1' },
  parentElement: {
    querySelector: (sel) => ({ value: '3' })
  },
  closest: (sel) => mockIncTarget
};

const clickEvt = { target: mockIncTarget };
const tableContainer = domElements['order-table-container'];
tableContainer.dispatchEvent({ type: 'click', ...clickEvt });

const orderAfterInc = getCurrentOrder();
const updatedItem1 = orderAfterInc.items.find(i => i.id === 'item-1');
if (updatedItem1.quantity === 4) {
  console.log('  ✓ PASSED: Incrementing quantity from mobile card correctly updated order state (3 -> 4).');
} else {
  console.error('  ✕ FAILED: Quantity increment failed, got', updatedItem1.quantity);
  process.exit(1);
}

// TEST 4: Action Dispatching (dec-qty)
console.log('\nTest 4: Testing mobile card Quantity decrement (-)...');
const mockDecTarget = {
  dataset: { action: 'dec-qty', itemId: 'item-1' },
  parentElement: {
    querySelector: (sel) => ({ value: '4' })
  },
  closest: (sel) => mockDecTarget
};
tableContainer.dispatchEvent({ type: 'click', target: mockDecTarget });
const orderAfterDec = getCurrentOrder();
const item1AfterDec = orderAfterDec.items.find(i => i.id === 'item-1');
if (item1AfterDec.quantity === 3) {
  console.log('  ✓ PASSED: Decrementing quantity from mobile card correctly updated order state (4 -> 3).');
} else {
  console.error('  ✕ FAILED: Quantity decrement failed, got', item1AfterDec.quantity);
  process.exit(1);
}

// TEST 5: Manual Candidate Switching from Mobile Card
console.log('\nTest 5: Testing Candidate Selection from Mobile Card...');
const changeEvt = {
  type: 'change',
  target: {
    dataset: { action: 'select-candidate', itemId: 'item-1' },
    value: '14401K0ND01'
  }
};
tableContainer.dispatchEvent(changeEvt);
const orderAfterCand = getCurrentOrder();
const item1AfterCand = orderAfterCand.items.find(i => i.id === 'item-1');

if (item1AfterCand.matchedProduct.partNumber === '14401K0ND01') {
  console.log('  ✓ PASSED: Candidate switcher on mobile card updated matched part number to 14401K0ND01.');
} else {
  console.error('  ✕ FAILED: Candidate switcher failed, got', item1AfterCand.matchedProduct);
  process.exit(1);
}

console.log('\n=== ALL RESPONSIVE MOBILE CARDS TESTS PASSED 100%! ===\n');
