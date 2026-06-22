/**
 * WizardTocParser — Parses .hhc files from decompiled CHM wizards.
 */
const fs = require('fs');
const path = require('path');

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

    // Collect full <li> block (up to next <li> or </ul>)
    let block = t;
    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
      const nt = lines[j].trim();
      if (nt.startsWith('<li') || nt.startsWith('</ul>') || nt === '<ul>') break;
      block += '\n' + nt;
      if (nt.includes('</object>')) break;
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

/**
 * Build a flat wizard list.
 * Any node with pages (has Local children) is a wizard.
 */
function buildWizardList(rootNode, baseDir) {
  const wizards = [];
  const seen = new Set();

  function walk(node, categoryPath) {
    const hasPages = node.pages.length > 0;

    if (hasPages && node.name !== '(root)') {
      const allPages = [];
      function collect(n) {
        for (const k of [...(n.children || []), ...(n.pages || [])]) {
          if (k.local) {
            const resolved = path.resolve(baseDir, k.local);
            const key = resolved.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              allPages.push({ title: k.name, file: resolved });
            }
          }
          collect(k);
        }
      }
      collect(node);
      if (allPages.length > 0) {
        wizards.push({
          title: node.name,
          category: categoryPath.filter(Boolean).join(' > '),
          pages: allPages
        });
      }
      return;
    }

    const newPath = [...categoryPath, node.name !== '(root)' ? node.name : undefined];
    for (const kid of [...node.children, ...node.pages]) walk(kid, newPath);
  }

  walk(rootNode, []);
  return wizards;
}

module.exports = { parseToc, buildWizardList };
