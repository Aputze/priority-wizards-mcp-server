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

module.exports = { readPage, getWizardText, searchWizards };
