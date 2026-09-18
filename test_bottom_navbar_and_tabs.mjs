import fs from 'fs';

console.log('=== RUNNING MOBILE BOTTOM NAVBAR & NEW TABS VERIFICATION TEST ===\n');

const html = fs.readFileSync('./index.html', 'utf8');
const css = fs.readFileSync('./css/styles.css', 'utf8');
const appJs = fs.readFileSync('./js/app.js', 'utf8');

// Test 1: Desktop tab bar contains Rack Map and Counter Map after Quick Search
console.log('Test 1: Verifying desktop navigation bar tabs sequence...');
const desktopNavMatch = html.match(/<nav class="flex space-x-1 py-1.5" aria-label="Tabs">([\s\S]*?)<\/nav>/);
if (!desktopNavMatch) {
  console.error('FAILED: Desktop navigation bar not found');
  process.exit(1);
}
const desktopNavContent = desktopNavMatch[1];
const desktopTargets = [...desktopNavContent.matchAll(/data-tab-target="([^"]+)"/g)].map(m => m[1]);
console.log('  Desktop tab targets:', desktopTargets);

const searchIdx = desktopTargets.indexOf('tab-search');
const rackIdx = desktopTargets.indexOf('tab-rack-map');
const counterIdx = desktopTargets.indexOf('tab-counter-map');

if (searchIdx === -1 || rackIdx === -1 || counterIdx === -1) {
  console.error('FAILED: One of tab-search, tab-rack-map, tab-counter-map missing in desktop nav');
  process.exit(1);
}
if (rackIdx !== searchIdx + 1 || counterIdx !== rackIdx + 1) {
  console.error('FAILED: Rack Map and Counter Map must be immediately after Quick Search');
  process.exit(1);
}
console.log('  ✓ PASSED: Desktop tabs correctly sequence Quick Search -> Rack Map -> Counter Map.\n');

// Test 2: Mobile drawer menu contains Rack Map and Counter Map after Quick Search
console.log('Test 2: Verifying mobile drawer menu tabs sequence...');
const mobileMenuMatch = html.match(/<div id="mobile-menu"[\s\S]*?>([\s\S]*?)<!-- Mobile Menu Footer Status -->/);
if (!mobileMenuMatch) {
  console.error('FAILED: Mobile menu drawer not found');
  process.exit(1);
}
const drawerTargets = [...mobileMenuMatch[1].matchAll(/data-tab-target="([^"]+)"/g)].map(m => m[1]);
console.log('  Drawer tab targets:', drawerTargets);
const dSearchIdx = drawerTargets.indexOf('tab-search');
const dRackIdx = drawerTargets.indexOf('tab-rack-map');
const dCounterIdx = drawerTargets.indexOf('tab-counter-map');

if (dSearchIdx === -1 || dRackIdx === -1 || dCounterIdx === -1) {
  console.error('FAILED: One of tab-search, tab-rack-map, tab-counter-map missing in drawer nav');
  process.exit(1);
}
if (dRackIdx !== dSearchIdx + 1 || dCounterIdx !== dRackIdx + 1) {
  console.error('FAILED: Drawer menu must sequence Quick Search -> Rack Map -> Counter Map');
  process.exit(1);
}
console.log('  ✓ PASSED: Mobile drawer correctly sequences Quick Search -> Rack Map -> Counter Map.\n');

// Test 3: Mobile Bottom Navbar existence and items in exact requested sequence
console.log('Test 3: Verifying mobile bottom navigation bar structure & sequence...');
if (!html.includes('id="mobile-bottom-nav"')) {
  console.error('FAILED: #mobile-bottom-nav missing in index.html');
  process.exit(1);
}
const bottomNavMatch = html.match(/<nav id="mobile-bottom-nav"[\s\S]*?>([\s\S]*?)<\/nav>/);
if (!bottomNavMatch) {
  console.error('FAILED: Unable to parse #mobile-bottom-nav');
  process.exit(1);
}
const bottomNavContent = bottomNavMatch[1];
const bottomTargets = [...bottomNavContent.matchAll(/data-tab-target="([^"]+)"/g)].map(m => m[1]);
console.log('  Bottom navbar targets:', bottomTargets);

const expectedBottomTargets = [
  'tab-order',        // 1. Image to Order
  'tab-stock',        // 2. Upload Stock
  'tab-rack-map',     // 3. Rack Map
  'tab-counter-map',  // 4. Counter Map
  'tab-search'        // 5. Quick Search
];

if (JSON.stringify(bottomTargets) !== JSON.stringify(expectedBottomTargets)) {
  console.error(`FAILED: Bottom nav targets ${JSON.stringify(bottomTargets)} do not match expected sequence ${JSON.stringify(expectedBottomTargets)}`);
  process.exit(1);
}
console.log('  ✓ PASSED: Mobile bottom nav has exactly the 5 options in the required order:\n    1. Image to Order\n    2. Upload Stock\n    3. Rack Map\n    4. Counter Map\n    5. Quick Search\n');

// Test 4: Tab Content Sections
console.log('Test 4: Verifying tab content sections in index.html...');
if (!html.includes('id="tab-rack-map"') || !html.includes('id="tab-counter-map"')) {
  console.error('FAILED: Missing #tab-rack-map or #tab-counter-map sections in index.html');
  process.exit(1);
}
console.log('  ✓ PASSED: Both #tab-rack-map and #tab-counter-map content sections are present.\n');

// Test 5: Mobile Layout & Safe-Area responsiveness
console.log('Test 5: Verifying mobile responsiveness and safe area insets...');
if (!html.includes('pb-24') || !html.includes('bottom-20 md:bottom-5')) {
  console.error('FAILED: Content bottom padding or toast positioning not adapted for mobile navbar');
  process.exit(1);
}
if (!css.includes('env(safe-area-inset-bottom)')) {
  console.error('FAILED: styles.css missing env(safe-area-inset-bottom) support');
  process.exit(1);
}
console.log('  ✓ PASSED: iOS safe area insets and mobile scroll clearance configured.\n');

// Test 6: App.js navigation synchronization & controller logic
console.log('Test 6: Verifying app.js tab synchronization and controller handlers...');
if (!appJs.includes('initOrRefreshRackMap') || !appJs.includes('initOrRefreshCounterMap')) {
  console.error('FAILED: app.js missing Rack Map or Counter Map controllers');
  process.exit(1);
}
if (!appJs.includes('isBottomNav')) {
  console.error('FAILED: app.js missing bottom nav active state synchronization');
  process.exit(1);
}
console.log('  ✓ PASSED: app.js contains full synchronization and interactive controllers.\n');

console.log('=== ALL MOBILE BOTTOM NAVBAR & TABS VERIFICATION TESTS PASSED 100%! ===\n');
