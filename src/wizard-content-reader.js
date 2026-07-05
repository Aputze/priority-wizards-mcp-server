/**
 * WizardContentReader — Reads wizard HTML content and strips to readable text.
 */
const fs = require('fs');
const path = require('path');

/**
 * Read a wizard page HTML file and extract meaningful text content.
 * Strips HTML tags, styles, scripts, and navigation elements.
 */
function readPage(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const html = fs.readFileSync(filePath, 'utf-8');
  
  // Extract title
  const titleM = html.match(/<title>([^<]*)<\/title>/i);
  const title = titleM ? titleM[1].trim() : path.basename(filePath, '.htm');
  
  // Extract body content — strip scripts, styles, objects
  const bodyM = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyM) return { title, content: '', raw: html };
  
  let text = bodyM[1];
  
  // Remove script blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Remove object/embed
  text = text.replace(/<object[\s\S]*?<\/object>/gi, '');
  // Remove style blocks
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, ' ');
  // Remove multiple spaces/newlines
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/\s+/g, ' ').trim();
  
  return { title, content: text, raw: html };
}

/**
 * Get a wizard's full content (all its pages concatenated).
 */
function getWizardText(wizard, baseDir) {
  const pages = wizard.pages.map(p => {
    const data = readPage(p.file);
    return data ? { title: data.title, content: data.content } : null;
  }).filter(Boolean);
  
  return {
    title: wizard.title,
    category: wizard.category,
    pages
  };
}

/**
 * Search across all wizard content.
 */
function searchWizards(wizards, query, baseDirs) {
  const q = query.toLowerCase();
  const results = [];
  
  for (const wiz of wizards) {
    // Search title
    const titleMatch = wiz.title.toLowerCase().includes(q);
    
    // Search first page content
    const firstPage = readPage(wiz.pages[0]?.file);
    const contentMatch = firstPage && firstPage.content.toLowerCase().includes(q);
    
    if (titleMatch || contentMatch) {
      results.push({
        title: wiz.title,
        category: wiz.category,
        matchType: titleMatch ? 'title' : 'content',
        snippet: contentMatch && firstPage ? firstPage.content.substring(0, 200) : undefined,
        startFile: path.basename(wiz.pages[0]?.file || ''),
        pageCount: wiz.pages.length
      });
    }
  }
  
  return results;
}

// ─── Hebrew Query Support ────────────────────────────────────────

const TOPIC_MAP = {
  'רכש': 'purchase',
  'הזמנה': 'order',
  'לקוח': 'customer',
  'ספק': 'supplier',
  'מלאי': 'inventory',
  'חשבונית': 'invoice',
  'תשלום': 'payment',
  'מחסן': 'warehouse',
  'מכירות': 'sales',
  'ייצור': 'production',
  'הנהלת חשבונות': 'accounting',
  'תמחיר': 'costing',
  'תקציב': 'budget',
  'משלוח': 'shipping',
};

const HEBREW_PREFIXES = ['ה', 'ו', 'ל', 'מ', 'ב', 'ש', 'כ'];

/**
 * Detect if text contains Hebrew characters.
 */
function hasHebrew(text) {
  return /[\u0590-\u05FF]/.test(text);
}

/**
 * Strip common Hebrew one-letter prefixes from a word.
 */
function stripHebrewPrefixes(word) {
  for (const prefix of HEBREW_PREFIXES) {
    if (word.startsWith(prefix) && word.length > prefix.length + 1) {
      return word.slice(prefix.length);
    }
  }
  return word;
}

/**
 * Compute common prefix length between two strings.
 */
function commonPrefixLen(a, b) {
  const minLen = Math.min(a.length, b.length);
  let i = 0;
  while (i < minLen && a[i] === b[i]) i++;
  return i;
}

/**
 * Translate Hebrew query keywords to English using the TOPIC_MAP.
 * Handles direct matches, prefix stripping, and construct-state fuzzy matching.
 */
function translateHebrewQuery(query) {
  const translated = new Set();
  const words = query.split(/\s+/).filter(Boolean);

  // Check multi-word keys first (e.g., 'הנהלת חשבונות')
  for (const [key, value] of Object.entries(TOPIC_MAP)) {
    if (key.includes(' ') && query.includes(key)) {
      translated.add(value);
    }
  }

  for (const word of words) {
    // 1. Direct match
    if (TOPIC_MAP[word]) {
      translated.add(TOPIC_MAP[word]);
      continue;
    }

    // 2. Strip prefix and try
    const stripped = stripHebrewPrefixes(word);
    if (stripped !== word && TOPIC_MAP[stripped]) {
      translated.add(TOPIC_MAP[stripped]);
      continue;
    }

    // 3. Fuzzy match (handles construct state: הזמנת → הזמנה)
    for (const [key, value] of Object.entries(TOPIC_MAP)) {
      if (key.includes(' ')) continue;
      if (commonPrefixLen(word, key) >= 3) {
        translated.add(value);
        break;
      }
    }
  }

  return [...translated].join(' ');
}

/**
 * Search wizards with a Hebrew query using dual-language search.
 *
 * 1. Search Hebrew wizards (title + content match)
 * 2. Translate Hebrew query to English, search English wizards (title match only)
 * 3. Merge and deduplicate by title: title matches first, then content matches
 */
function searchWizardsHebrew(query, heWizards, enWizards, baseDirs) {
  // Step 1: Full search in Hebrew wizards
  const heResults = searchWizards(heWizards, query, baseDirs);

  // Step 2: Translate and search English wizards (title only)
  const enQuery = translateHebrewQuery(query);
  const enResults = [];

  if (enQuery) {
    const enKeywords = enQuery.toLowerCase().split(/\s+/).filter(Boolean);
    for (const wiz of enWizards) {
      const titleLower = wiz.title.toLowerCase();
      if (enKeywords.some(kw => titleLower.includes(kw))) {
        enResults.push({
          title: wiz.title,
          category: wiz.category,
          matchType: 'title',
          snippet: undefined,
          startFile: path.basename(wiz.pages[0]?.file || ''),
          pageCount: wiz.pages.length
        });
      }
    }
  }

  // Step 3: Merge — title matches first, then content matches, deduplicated by title
  const seen = new Set();
  const merged = [];

  const titleResults = [
    ...heResults.filter(r => r.matchType === 'title'),
    ...enResults
  ];

  for (const r of titleResults) {
    if (!seen.has(r.title)) {
      seen.add(r.title);
      merged.push(r);
    }
  }

  for (const r of heResults) {
    if (r.matchType === 'content' && !seen.has(r.title)) {
      seen.add(r.title);
      merged.push(r);
    }
  }

  return merged;
}

module.exports = { readPage, getWizardText, searchWizards, searchWizardsHebrew, hasHebrew };
