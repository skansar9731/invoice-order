import fs from 'fs';

console.log('=== VERIFYING RESPONSIVE SCROLL CONTAINERS FOR RACK MAP & COUNTER MAP ===\n');

// 1. Verify css/styles.css
console.log('1. Checking css/styles.css...');
const css = fs.readFileSync('./css/styles.css', 'utf8');

if (!css.includes('.map-scroll-container')) {
  console.error('FAILED: .map-scroll-container not found in css/styles.css');
  process.exit(1);
}
if (!css.includes('.table-scroll-container')) {
  console.error('FAILED: .table-scroll-container not found in css/styles.css');
  process.exit(1);
}
if (!css.includes('scrollbar-width: thin')) {
  console.error('FAILED: modern scrollbar styling not found in css/styles.css');
  process.exit(1);
}
if (!css.includes('-webkit-overflow-scrolling: touch')) {
  console.error('FAILED: touch momentum scrolling not found in css/styles.css');
  process.exit(1);
}
if (!css.includes('@media screen and (max-width: 767.98px)')) {
  console.error('FAILED: mobile media query not found in css/styles.css');
  process.exit(1);
}
console.log('  ✓ PASSED: css/styles.css has full responsive scrolling rules and custom styling.');

// 2. Verify js/rackMap.js
console.log('\n2. Checking js/rackMap.js...');
const rackJs = fs.readFileSync('./js/rackMap.js', 'utf8');

if (!rackJs.includes('<div class="map-scroll-container">\n      <div id="racks-grid-container"')) {
  console.error('FAILED: View 1 (racks grid) in js/rackMap.js is not wrapped in .map-scroll-container');
  process.exit(1);
}
if (!rackJs.includes('<div class="map-scroll-container">\n      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">')) {
  console.error('FAILED: View 2 (sections grid) in js/rackMap.js is not wrapped in .map-scroll-container');
  process.exit(1);
}
if (!rackJs.includes('<div class="table-scroll-container">')) {
  console.error('FAILED: View 3 desktop table in js/rackMap.js is not wrapped in .table-scroll-container');
  process.exit(1);
}
if (!rackJs.includes('<div class="responsive-card-view map-scroll-container p-1 space-y-2.5">')) {
  console.error('FAILED: View 3 mobile cards in js/rackMap.js is not wrapped in .map-scroll-container');
  process.exit(1);
}
console.log('  ✓ PASSED: All 3 views in js/rackMap.js are wrapped in responsive scroll containers.');

// 3. Verify js/counterMap.js
console.log('\n3. Checking js/counterMap.js...');
const counterJs = fs.readFileSync('./js/counterMap.js', 'utf8');

if (!counterJs.includes('<div class="map-scroll-container">\n      <div id="counters-grid-container"')) {
  console.error('FAILED: View 1 (counters grid) in js/counterMap.js is not wrapped in .map-scroll-container');
  process.exit(1);
}
if (!counterJs.includes('<div class="map-scroll-container">\n      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">')) {
  console.error('FAILED: View 2 (sections grid) in js/counterMap.js is not wrapped in .map-scroll-container');
  process.exit(1);
}
if (!counterJs.includes('<div class="table-scroll-container">')) {
  console.error('FAILED: View 3 desktop table in js/counterMap.js is not wrapped in .table-scroll-container');
  process.exit(1);
}
if (!counterJs.includes('<div class="responsive-card-view map-scroll-container p-1 space-y-2.5">')) {
  console.error('FAILED: View 3 mobile cards in js/counterMap.js is not wrapped in .map-scroll-container');
  process.exit(1);
}
console.log('  ✓ PASSED: All 3 views in js/counterMap.js are wrapped in responsive scroll containers.');

console.log('\n=== ALL SCROLL CONTAINER VERIFICATION CHECKS PASSED 100%! ===\n');
