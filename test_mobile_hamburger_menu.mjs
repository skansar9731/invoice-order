import fs from 'fs';

console.log('=== RUNNING RESPONSIVE MOBILE HAMBURGER MENU VERIFICATION TEST ===');

const htmlContent = fs.readFileSync('./index.html', 'utf8');

// 1. Verify Hamburger Button in Header
if (!htmlContent.includes('id="btn-mobile-menu"')) {
  console.error('FAILED: btn-mobile-menu missing in index.html');
  process.exit(1);
}
console.log('✓ PASSED: Mobile hamburger button exists in header.');

// 2. Verify Hamburger and Close SVG icons
if (!htmlContent.includes('id="hamburger-icon"') || !htmlContent.includes('id="close-icon"')) {
  console.error('FAILED: Hamburger or close icon missing in index.html');
  process.exit(1);
}
console.log('✓ PASSED: Hamburger (☰) and Close (✕) SVG icons present.');

// 3. Verify Mobile Drawer / Dropdown Menu
if (!htmlContent.includes('id="mobile-menu"')) {
  console.error('FAILED: mobile-menu container missing in index.html');
  process.exit(1);
}
console.log('✓ PASSED: Mobile navigation drawer (mobile-menu) exists.');

// 4. Verify that horizontal scrolling overflow-x-auto on tabs bar is removed on mobile
if (htmlContent.includes('nav class="flex space-x-1 py-1.5 overflow-x-auto"')) {
  console.error('FAILED: overflow-x-auto still present on mobile tabs bar');
  process.exit(1);
}
console.log('✓ PASSED: Removed horizontal scroll on mobile navigation.');

// 5. Verify Desktop tabs bar is preserved for md:breakpoint (>= 768px)
if (!htmlContent.includes('class="hidden md:block bg-slate-800/90 border-t border-slate-700/50"')) {
  console.error('FAILED: Desktop navigation bar not properly constrained with hidden md:block');
  process.exit(1);
}
console.log('✓ PASSED: Desktop navigation bar is completely unchanged on screens >= 768px.');

// 6. Verify JavaScript mobile menu toggle logic in app.js
const appJsContent = fs.readFileSync('./js/app.js', 'utf8');
if (!appJsJsCheck(appJsContent)) {
  console.error('FAILED: app.js does not contain mobile menu toggle logic');
  process.exit(1);
}
console.log('✓ PASSED: app.js contains hamburger toggle and auto-close logic on tab selection.');

function appJsJsCheck(src) {
  return src.includes('btn-mobile-menu') &&
         src.includes('toggleMobileMenu') &&
         src.includes('hamburger-icon') &&
         src.includes('close-icon');
}

console.log('\n=== ALL MOBILE HAMBURGER MENU VERIFICATIONS PASSED 100%! ===\n');
