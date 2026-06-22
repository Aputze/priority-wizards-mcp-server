/**
 * Test the TOC parser against both Hebrew and English CHM files.
 */
const path = require('path');
const { parseToc, buildWizardList } = require('./wizard-toc-parser');

function test(label, lang, tocPath, dir) {
  console.log(`=== ${label} (${lang}) ===`);
  const tree = parseToc(tocPath);
  const wizards = buildWizardList(tree, dir);
  console.log(`Wizards: ${wizards.length}`);

  wizards.slice(0, 15).forEach(w => {
    const sp = path.basename(w.pages[0].file);
    console.log(`  ${w.title} → ${sp} (${w.pages.length} pages) [${w.category}]`);
    w.pages.slice(1, 4).forEach(p => console.log(`      ↳ ${p.title}`));
  });

  console.log('\n  Search:');
  ['Company', 'Customer', 'Tax', 'Inventory', 'Account', 'Wizard', 'Sales', 'Purchase'].forEach(term => {
    const q = term.toLowerCase();
    const found = wizards.filter(w => w.title.toLowerCase().includes(q));
    if (found.length > 0)
      console.log(`  "${term}": ${found.length} — ${found.slice(0, 3).map(w => w.title).join(', ')}`);
  });
  console.log('');
}

test('wiz1 Hebrew', 'he', 'D:\\priority\\tmp\\chm_extract_wiz1\\WIZ1.hhc', 'D:\\priority\\tmp\\chm_extract_wiz1');
test('wiz3 English', 'en', 'D:\\priority\\tmp\\chm_extract_wiz3\\WIZ3.hhc', 'D:\\priority\\tmp\\chm_extract_wiz3');
