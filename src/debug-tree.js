/**
 * Debug the TOC tree structure — fixed to read multi-line <li> blocks.
 */
const fs = require('fs');

function parseToc(hhcPath) {
  const content = fs.readFileSync(hhcPath, 'utf-8');
  const lines = content.split('\n');
  const root = { name: '(root)', local: null, children: [], pages: [] };
  const stack = [{ node: root, depth: -1 }];
  let depth = -1;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '<ul>') { depth++; continue; }
    if (t === '</ul>') {
      depth--;
      while (stack.length > 0 && stack[stack.length - 1].depth > depth) stack.pop();
      continue;
    }
    if (!t.startsWith('<li')) continue;

    // Collect all lines until </li> or next <li> or </ul>
    let block = t;
    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
      const nt = lines[j].trim();
      if (nt.startsWith('<li') || nt.startsWith('</ul>') || nt === '<ul>') break;
      if (nt.includes('</object>')) { block += '\n' + nt; break; }
      block += '\n' + nt;
    }
    
    const nameM = block.match(/Name"\s+value="([^"]*)"/);
    const localM = block.match(/Local"\s+value="([^"]*)"/);
    const name = nameM ? nameM[1] : '?';
    const local = localM ? localM[1] : null;
    
    const node = { name, local, children: [], pages: [] };
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1].node : root;
    if (local) parent.pages.push(node); else parent.children.push(node);
    stack.push({ node, depth });
  }
  return root;
}

const tree = parseToc('D:\\priority\\tmp\\chm_extract_wiz3\\WIZ3.hhc');

console.log('Root children:', tree.children.length, 'pages:', tree.pages.length);
for (const c of tree.children) {
  const name = c.name || '(unnamed)';
  console.log('  ' + name + ' (children: ' + c.children.length + ', pages: ' + c.pages.length + ')');
}

const gs = tree.children.find(c => c.name === 'Getting Started');
if (gs) {
  console.log('\nGetting Started children:');
  gs.children.slice(0, 15).forEach(c => console.log('  ' + c.name + ' (children: ' + c.children.length + ', pages: ' + c.pages.length + ')'));
  
  const cw = gs.children.find(c => c.name === 'Companies Wizard');
  if (cw) {
    console.log('\nCompanies Wizard — pages:', cw.pages.length);
    cw.pages.forEach(p => console.log('  📄 ' + p.name + ' → ' + p.local));
  }
}

// Count all wizards: any node at depth >= 0 with direct pages
let wizardCount = 0;
function walk(node) {
  if (node.pages.length > 0 && node.name !== '(root)') wizardCount++;
  for (const c of node.children) walk(c);
  for (const p of node.pages) walk(p);
}
walk(tree);
console.log('\nTotal potential wizards:', wizardCount);
