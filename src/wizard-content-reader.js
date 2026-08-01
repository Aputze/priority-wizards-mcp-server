/**
 * WizardContentReader — Reads wizard HTML content and converts to Markdown.
 */
const fs = require('fs');
const path = require('path');

// Static content cache — wizard HTML files never change at runtime
const pageCache = new Map();

// ─── HTML → Markdown helpers ─────────────────────────────────────

function tableToMarkdown(tableHtml) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const text = cellMatch[1]
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
      cells.push(text);
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) return '';
  const maxCols = Math.max(...rows.map(r => r.length));
  const pad = (row) => row.concat(Array(Math.max(0, maxCols - row.length)).fill(''));
  const lines = [];
  lines.push('| ' + pad(rows[0]).join(' | ') + ' |');
  lines.push('|' + Array(maxCols).fill(' --- ').join('|') + '|');
  for (let i = 1; i < rows.length; i++) {
    lines.push('| ' + pad(rows[i]).join(' | ') + ' |');
  }
  return lines.join('\n');
}

function listToMarkdown(listHtml, ordered) {
  const items = [];
  const itemRe = /<li[^>]*>([\s\S]*?)(?=<\/li>|<li|<\/[ou]l)/gi;
  let m;
  while ((m = itemRe.exec(listHtml)) !== null) {
    const text = m[1]
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) items.push(text);
  }
  return items.map((item, i) => (ordered ? `${i + 1}. ` : '- ') + item).join('\n');
}

// ─── Page reading ────────────────────────────────────────────────

/**
 * Read a wizard page HTML file and convert to Markdown-structured text.
 * Converts headings, tables, and lists to Markdown for better AI consumption.
 */
function readPage(filePath) {
  if (pageCache.has(filePath)) return pageCache.get(filePath);
  if (!fs.existsSync(filePath)) return null;
  const html = fs.readFileSync(filePath, 'utf-8');

  const titleM = html.match(/<title>([^<]*)<\/title>/i);
  const title = titleM ? titleM[1].trim() : path.basename(filePath, '.htm');

  const bodyM = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyM) return { title, content: '', raw: html };

  let text = bodyM[1];

  // Remove noise
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<object[\s\S]*?<\/object>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Headings → Markdown
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => '\n# ' + c.replace(/<[^>]*>/g, '').trim() + '\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => '\n## ' + c.replace(/<[^>]*>/g, '').trim() + '\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => '\n### ' + c.replace(/<[^>]*>/g, '').trim() + '\n');
  text = text.replace(/<h[456][^>]*>([\s\S]*?)<\/h[456]>/gi, (_, c) => '\n#### ' + c.replace(/<[^>]*>/g, '').trim() + '\n');

  // Tables → Markdown
  text = text.replace(/<table[\s\S]*?<\/table>/gi, (match) => '\n\n' + tableToMarkdown(match) + '\n\n');

  // Ordered and unordered lists → Markdown
  text = text.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => '\n\n' + listToMarkdown(inner, true) + '\n\n');
  text = text.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => '\n\n' + listToMarkdown(inner, false) + '\n\n');

  // Bold / italic
  text = text.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, c) => '**' + c.replace(/<[^>]*>/g, '').trim() + '**');
  text = text.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, c) => '*' + c.replace(/<[^>]*>/g, '').trim() + '*');

  const PARA = '\x01';
  const BR = '\x02';

  text = text.replace(/<\/p>/gi, PARA);
  text = text.replace(/<\/div>/gi, PARA);
  text = text.replace(/<br\s*\/?>/gi, BR);

  // Strip remaining HTML tags
  text = text.replace(/<[^>]*>/g, ' ');

  // Decode entities
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');

  // Collapse horizontal whitespace (preserve newlines from Markdown conversion)
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(new RegExp(` *${PARA} *`, 'g'), '\n\n');
  text = text.replace(new RegExp(` *${BR} *`, 'g'), '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  const result = { title, content: text, raw: html };
  pageCache.set(filePath, result);
  return result;
}

/**
 * Get a wizard's full content (all pages concatenated).
 */
function getWizardText(wizard, baseDir) {
  const pages = wizard.pages.map(p => {
    const data = readPage(p.file);
    return data ? { title: data.title, content: data.content } : null;
  }).filter(Boolean);
  return { title: wizard.title, category: wizard.category, pages };
}

// ─── Token matching ──────────────────────────────────────────────

function tokenize(text) {
  return text.toLowerCase().split(/[\s,;:.!?()\[\]{}"'/\\|_\-+*=<>«»]+/).filter(Boolean);
}

function commonPrefixLen(a, b) {
  const minLen = Math.min(a.length, b.length);
  let i = 0;
  while (i < minLen && a[i] === b[i]) i++;
  return i;
}

/**
 * Check whether every token in queryTokens finds a meaningful match
 * in targetTokens. A token matches if it is a substring of a target token,
 * a target token is a substring of it, or they share a common prefix >= 3 chars.
 */
function tokensMatch(queryTokens, targetTokens) {
  if (queryTokens.length === 0) return false;
  for (const qt of queryTokens) {
    if (!targetTokens.some(tt =>
      tt.includes(qt) || qt.includes(tt) || commonPrefixLen(qt, tt) >= 3
    )) {
      return false;
    }
  }
  return true;
}

// ─── Search ──────────────────────────────────────────────────────

/**
 * Extract a context-aware snippet around the first matching query token.
 */
function extractSnippet(content, queryTokens, contextChars = 150) {
  const lower = content.toLowerCase();
  for (const t of queryTokens) {
    const idx = lower.indexOf(t);
    if (idx >= 0) {
      const start = Math.max(0, idx - contextChars);
      const end = Math.min(content.length, idx + t.length + contextChars);
      return (start > 0 ? '…' : '') + content.slice(start, end).trim() + (end < content.length ? '…' : '');
    }
  }
  return content.substring(0, contextChars * 2);
}

/**
 * Search across ALL wizard pages using token-based matching.
 *
 * Scoring:
 *   title match                    = 10 pts
 *   full phrase match on page 0    =  5 pts
 *   full phrase match on page 1+   =  3 pts
 *   any-token match on page 0      =  2 pts
 *   any-token match on page 1+     =  1 pt
 *
 * Results are returned sorted by score descending.
 */
function searchWizards(wizards, query, baseDirs) {
  const q = query.toLowerCase();
  const queryTokens = tokenize(query);
  const results = [];

  for (const wiz of wizards) {
    let score = 0;
    let matchType = null;
    let snippet = undefined;

    const titleTokens = tokenize(wiz.title);
    if (queryTokens.length > 0 && tokensMatch(queryTokens, titleTokens)) {
      score += 10;
      matchType = 'title';
    }

    // Search every page
    for (let pi = 0; pi < wiz.pages.length; pi++) {
      const page = readPage(wiz.pages[pi]?.file);
      if (!page) continue;
      const contentLower = page.content.toLowerCase();
      const phraseBonus = pi === 0 ? 5 : 3;
      const tokenBonus  = pi === 0 ? 2 : 1;

      if (contentLower.includes(q)) {
        score += phraseBonus;
        if (!matchType) matchType = 'content';
        if (!snippet) snippet = extractSnippet(page.content, queryTokens);
      } else if (queryTokens.length > 1 && queryTokens.some(t => contentLower.includes(t))) {
        score += tokenBonus;
        if (!matchType) matchType = 'content';
        if (!snippet) snippet = extractSnippet(page.content, queryTokens);
      }
    }

    if (score > 0) {
      results.push({
        title: wiz.title,
        category: wiz.category,
        score,
        matchType,
        snippet,
        startFile: path.basename(wiz.pages[0]?.file || ''),
        pageCount: wiz.pages.length
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ─── Hebrew query support ────────────────────────────────────────

// Maps Hebrew terms to English keywords that match wizard titles.
// Multi-word keys must come first (they are checked before their component words).
// Values are English phrases whose individual tokens must ALL appear in a wizard title
// (e.g. "work orders" matches "Work Orders Wizard" because both tokens are in the title).
const TOPIC_MAP = {
  // ── Multi-word keys ──────────────────────────────────────────
  'הנהלת חשבונות': 'journal',           // Manual Journal Entries Wizard
  'פקודת עבודה':   'work orders',        // Work Orders Wizard
  'פקודות עבודה':  'work orders',        // Work Orders Wizard
  'הזמנת לקוח':   'sales order',         // Sales Order Wizard
  'הזמנות לקוח':  'sales order',         // Sales Order Wizard
  'הזמנת רכש':    'purchase order',      // Purchase Orders Wizard
  'הזמנות רכש':   'purchase order',      // Purchase Orders Wizard
  'חשבונית מס':   'invoice',             // Customer/Purchase Invoices Wizard
  'חשבוניות מס':  'invoice',             // same
  'ספירת מלאי':   'inventory count',     // Inventory Count Wizard
  'תנועות מלאי':  'inventory',           // Inventory Count Wizard
  'כרטיס פריט':   'part',                // Part Definition Wizard
  'רכוש קבוע':    'fixed assets',        // Fixed Assets Wizard
  'שנת כספים':    'fiscal',              // Fiscal Periods Wizard
  'שנות כספים':   'fiscal',              // Fiscal Periods Wizard
  'שנה כספית':    'fiscal',              // Fiscal Periods Wizard
  'שער חליפין':   'currencies',          // Currencies Wizard
  'ניכוי מס':     'withholding',         // Withholding Tax Wizard
  'מס ערך מוסף':  'taxes',               // Taxes Wizard
  'כוח אדם':      'personnel',           // Personnel Setup Wizard
  'לוח שנה':      'calendar',            // To Do List/Calendar Wizard
  'הצעת מחיר':    'price quotation',     // Price Quotations Wizard
  'הצעות מחיר':   'price quotation',     // Price Quotations Wizard
  'חשבון בנק':    'bank',                // Set Up Bank Accounts Wizard
  'חשבונות בנק':  'bank',                // Set Up Bank Accounts Wizard
  'תעודת משלוח':  'shipment',            // Customer Shipment/Return Wizard
  'תעודות משלוח': 'shipment',            // same
  'תעודת קבלה':   'goods',               // Receipt of Goods Wizard
  'דרישת רכש':    'purchase planning',   // Purchase Planning Wizard
  'דרישות רכש':   'purchase planning',   // Purchase Planning Wizard
  'זיכוי ללקוח':  'credit',              // Customer Refunds/Credit Vouchers Wizard
  'תנאי תשלום':   'payment',             // Set Up Payment Terms Wizard
  'אמצעי תשלום':  'payment',             // Set Up Payment Terms Wizard
  'סוגי לקוחות':  'customer',            // Open Customers Wizard
  'פנקס שיקים':   'bank',                // Set Up Bank Accounts Wizard
  'מסמכי רכש':    'purchase',            // Purchase Invoices and Memos Wizard
  'העברה בין מחסנים': 'warehouse transfers', // Warehouse Transfers Wizard
  'העברות בין מחסנים': 'warehouse transfers', // same
  'קבלות סחורה':  'goods receipt',       // Receipt of Goods Wizard
  // ── Single-word keys ─────────────────────────────────────────
  'רכש':         'purchase',             // Purchase Orders / Purchase Planning
  'הזמנה':       'order',                // Sales Order / Purchase Orders
  'לקוח':        'customer',             // Open Customers Wizard
  'לקוחות':      'customer',             // Open Customers Wizard
  'ספק':         'vendor',               // Open Vendors Wizard
  'ספקים':       'vendor',               // Open Vendors Wizard
  'מלאי':        'inventory',            // Inventory Count Wizard
  'חשבונית':     'invoice',              // Customer / Purchase Invoices Wizard
  'חשבוניות':    'invoice',              // same
  'תשלום':       'payment',              // Set Up Payment Terms Wizard
  'קבלה':        'receipt',              // Customer Receipts Wizard
  'מחסן':        'warehouse',            // Open a Warehouse / Warehouse Transfers
  'מחסנים':      'warehouse',            // same
  'מכירות':      'sales',                // Sales Order / Sales Reps Wizards
  'ייצור':       'work orders',          // Work Orders Wizard
  'תמחיר':       'costing',
  'תקציב':       'budget',
  'משלוח':       'shipment',             // Customer Shipment/Return Wizard
  'פריט':        'part',                 // Part Definition Wizard
  'פריטים':      'part',                 // same
  'מוצר':        'part',                 // Part Definition Wizard
  'מוצרים':      'part',                 // same
  'פקעות':       'work orders',          // Work Orders Wizard
  'מסלול':       'routing',
  'הרכבה':       'assembly',
  'כספים':       'financial',            // Set Up Financial Documents Wizard
  'חשבונות':     'accounts',             // Open GL Accounts Wizard
  'יומן':        'journal',              // Manual Journal Entries Wizard
  'מאזן':        'accounts',             // Open GL Accounts Wizard
  'מטבע':        'currencies',           // Currencies Wizard
  'מטבעות':      'currencies',           // same
  'בנק':         'bank',                 // Set Up Bank Accounts Wizard
  'בנקים':       'bank',                 // same
  'קופה':        'cashier',              // Set Up Cashiers Wizard
  'מעמ':         'taxes',                // Taxes Wizard
  'עובד':        'employee',             // Employee Wizard
  'עובדים':      'employee',             // same
  'שכר':         'personnel',            // Personnel Setup Wizard
  'פחת':         'fixed',                // Fixed Assets Wizard
  'נכס':         'fixed',                // Fixed Assets Wizard
  'נכסים':       'fixed',                // same
  'משתמש':       'user',                 // Opening a User Wizard
  'משתמשים':     'user',                 // same
  'הרשאות':      'privilege',            // Privilege Explorer Wizard
  'דוח':         'report',               // Report Generators Wizard
  'דוחות':       'report',               // same
  'מחולל':       'generator',            // Report Generators Wizard
  'פרוצדורה':    'procedure',
  'פרוצדורות':   'procedure',
  'תפריט':       'menu',                 // Warning Messages Wizard (menu runs)
  'מסך':         'form',                 // Privilege Explorer Wizard
  'סניף':        'branch',               // Branches Wizard
  'סניפים':      'branch',               // same
  'חברה':        'company',              // Companies Wizard
  'חברות':       'company',              // same
  'מחיר':        'price',                // Price Quotations Wizard
  'מחירים':      'price',                // same
  'הנחה':        'discount',
  'מחירון':      'price',                // Price Quotations Wizard
  'זיכוי':       'credit',               // Customer Refunds/Credit Vouchers Wizard
  'אשראי':       'credit',               // same
  'משימה':       'todo',                 // To Do List/Calendar Wizard
  'משימות':      'todo',                 // same
  'פעילות':      'activity',
  'סוכן':        'sales rep',            // Sales Reps Wizard
  'סוכנים':      'sales rep',            // same
  'יצוא':        'export',
  'מצב':         'status',
  'סטטוס':       'status',
  'אישור':       'approval',
  'חוזה':        'order',                // Sales/Purchase Order Wizard
  'שירות':       'service',
  'פרויקט':      'project',
};

const HEBREW_PREFIXES = ['ה', 'ו', 'ל', 'מ', 'ב', 'ש', 'כ'];

function hasHebrew(text) {
  return /[֐-׿]/.test(text);
}

function stripHebrewPrefixes(word) {
  for (const prefix of HEBREW_PREFIXES) {
    if (word.startsWith(prefix) && word.length > prefix.length + 1) {
      return word.slice(prefix.length);
    }
  }
  return word;
}

/**
 * Translate a Hebrew query into an array of English search phrases,
 * one per matched Hebrew term (OR semantics: each phrase is searched independently).
 */
function translateHebrewTerms(query) {
  const phrases = [];
  const words = query.split(/\s+/).filter(Boolean);

  // Multi-word keys first
  for (const [key, value] of Object.entries(TOPIC_MAP)) {
    if (key.includes(' ') && query.includes(key)) {
      phrases.push(value);
    }
  }

  for (const word of words) {
    if (TOPIC_MAP[word]) { phrases.push(TOPIC_MAP[word]); continue; }
    const stripped = stripHebrewPrefixes(word);
    if (stripped !== word && TOPIC_MAP[stripped]) { phrases.push(TOPIC_MAP[stripped]); continue; }
    for (const [key, value] of Object.entries(TOPIC_MAP)) {
      if (key.includes(' ')) continue;
      if (commonPrefixLen(word, key) >= 3) { phrases.push(value); break; }
    }
  }

  return [...new Set(phrases)];
}

/**
 * Search wizards with a Hebrew query using dual-language search.
 *
 * 1. Search Hebrew wizards directly (title + all-page content match).
 * 2. Translate each Hebrew term independently to English and search English
 *    wizards by title (OR across terms).
 * 3. Merge: Hebrew title matches → English title matches → Hebrew content matches.
 */
function searchWizardsHebrew(query, heWizards, enWizards, baseDirs) {
  const heResults = searchWizards(heWizards, query, baseDirs);

  const phrases = translateHebrewTerms(query);
  const enByTitle = new Map();

  for (const phrase of phrases) {
    const tokens = tokenize(phrase);
    for (const wiz of enWizards) {
      if (enByTitle.has(wiz.title)) continue;
      if (tokensMatch(tokens, tokenize(wiz.title))) {
        enByTitle.set(wiz.title, {
          title: wiz.title,
          category: wiz.category,
          score: 8,
          matchType: 'title',
          snippet: undefined,
          startFile: path.basename(wiz.pages[0]?.file || ''),
          pageCount: wiz.pages.length
        });
      }
    }
  }

  const seen = new Set();
  const merged = [];

  for (const r of heResults.filter(r => r.matchType === 'title')) {
    if (!seen.has(r.title)) { seen.add(r.title); merged.push(r); }
  }
  for (const r of enByTitle.values()) {
    if (!seen.has(r.title)) { seen.add(r.title); merged.push(r); }
  }
  for (const r of heResults) {
    if (r.matchType === 'content' && !seen.has(r.title)) {
      seen.add(r.title);
      merged.push(r);
    }
  }

  return merged;
}

module.exports = { readPage, getWizardText, searchWizards, searchWizardsHebrew, hasHebrew, tokenize, tokensMatch };
