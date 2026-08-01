/**
 * Priority Wizards MCP Server
 * 
 * Provides access to decompiled CHM wizard content via MCP resources and tools.
 * 
 * Resources:
 *   wizard://toc              — Full table of contents (all wizards + pages)
 *   wizard://{name}           — Full content of a wizard (all pages)
 *   wizard://{name}/{page}    — Single page content
 * 
 * Tools:
 *   wizard_list              — List all wizards with metadata
 *   wizard_search(query)     — Search across all wizard content
 *   wizard_get(name)         — Get full wizard content
 *
 * Transports:
 *   node src/index.js         — STDIO (Cursor)
 *   node src/index.js --http  — HTTP Streamable (Jeen / Docker)
 */
require('dotenv').config({
  path: require('path').resolve(__dirname, '..', '.env'),
  quiet: true
});

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

const path = require('path');
const { parseToc, buildWizardList } = require('./wizard-toc-parser');
const { readPage, searchWizards, searchWizardsHebrew, hasHebrew, tokenize, tokensMatch } = require('./wizard-content-reader');

// ─── Configuration ───────────────────────────────────────────────
const CONFIG = {
  hebrewToc: process.env.WIZ1_HHC || 'D:\\priority\\tmp\\chm_extract_wiz1\\WIZ1.hhc',
  hebrewDir: process.env.WIZ1_DIR || 'D:\\priority\\tmp\\chm_extract_wiz1',
  englishToc: process.env.WIZ3_HHC || 'D:\\priority\\tmp\\chm_extract_wiz3\\WIZ3.hhc',
  englishDir: process.env.WIZ3_DIR || 'D:\\priority\\tmp\\chm_extract_wiz3',
  port: parseInt(process.env.PORT || '3002', 10),
  host: process.env.HOST || '0.0.0.0',
  apiKey: process.env.API_KEY || null,
};

// ─── Load wizards at startup ─────────────────────────────────────
console.error('[Wizards MCP] Loading wizard indexes...');
let heTree, enTree;
try {
  heTree = parseToc(CONFIG.hebrewToc);
} catch (e) {
  console.error(`[Wizards MCP] FATAL: Cannot load Hebrew TOC from "${CONFIG.hebrewToc}"`);
  console.error(`[Wizards MCP] Set WIZ1_HHC in .env to the correct path. Error: ${e.message}`);
  process.exit(1);
}
try {
  enTree = parseToc(CONFIG.englishToc);
} catch (e) {
  console.error(`[Wizards MCP] FATAL: Cannot load English TOC from "${CONFIG.englishToc}"`);
  console.error(`[Wizards MCP] Set WIZ3_HHC in .env to the correct path. Error: ${e.message}`);
  process.exit(1);
}
const heWizards = buildWizardList(heTree, CONFIG.hebrewDir);
const enWizards = buildWizardList(enTree, CONFIG.englishDir);
const allWizards = [...heWizards, ...enWizards];
console.error(`[Wizards MCP] Loaded ${heWizards.length} Hebrew + ${enWizards.length} English = ${allWizards.length} total wizards`);
console.error(`[Wizards MCP] Paths: WIZ1_DIR=${CONFIG.hebrewDir} WIZ3_DIR=${CONFIG.englishDir}`);

// Build lookups
// English wizards loaded FIRST so ENTITY_WIZARD_MAP (built from English wizards) takes priority on filename collisions
const wizByFile = new Map(); // filename_lower → wizard (dedup dirs)
for (const w of enWizards) {
  const key = path.basename(w.pages[0]?.file || '').toLowerCase();
  if (!wizByFile.has(key)) wizByFile.set(key, w);
}
for (const w of heWizards) {
  const key = path.basename(w.pages[0]?.file || '').toLowerCase();
  if (wizByFile.has(key)) {
    console.error(`[Wizards MCP] Collision: Hebrew wizard "${w.title}" (${key}) shadowed by English wizard`);
  } else {
    wizByFile.set(key, w);
  }
}

// ─── Entity-to-Wizard Map ────────────────────────────────────────
// Maps Priority ERP entity names to relevant wizard documentation.
// Generated from analysis of all 135 English wizards.
const ENTITY_WIZARD_MAP = [
  {"entity":"CUSTOMERS","title":"Open Customers Wizard","file":"1131.htm","relevance":"high","context":"customer setup, customer types, customer management"},
  {"entity":"ORDERS","title":"Sales Order Wizard","file":"62000.htm","relevance":"high","context":"sales orders, order processing, order items"},
  {"entity":"PORDERS","title":"Purchase Orders Wizard","file":"81000.htm","relevance":"high","context":"purchase orders, PO processing, PO items"},
  {"entity":"PART","title":"Part Definition Wizard","file":"70007.htm","relevance":"high","context":"product/part definition, item master setup"},
  {"entity":"SUPPLIERS","title":"Open Vendors Wizard","file":"1141.htm","relevance":"high","context":"vendor/supplier setup and management"},
  {"entity":"CURRENCIES","title":"Currencies Wizard","file":"101.htm","relevance":"high","context":"currency setup, exchange rates, multi-currency"},
  {"entity":"ACCOUNTS","title":"Open GL Accounts Wizard","file":"1501.htm","relevance":"high","context":"chart of accounts, GL account setup"},
  {"entity":"WAREHOUSES","title":"Open a Warehouse Wizard","file":"671.htm","relevance":"high","context":"warehouse setup and configuration"},
  {"entity":"CINVOICES","title":"Purchase Invoices and Memos Wizard","file":"70003.htm","relevance":"high","context":"consolidated AP invoices, supplier invoices"},
  {"entity":"PINVOICES","title":"Purchase Invoices and Memos Wizard","file":"70003.htm","relevance":"high","context":"supplier consolidated invoices, AP invoices"},
  {"entity":"YINVOICES","title":"Purchase Invoices and Memos Wizard","file":"70003.htm","relevance":"high","context":"supplier invoices, accounts payable"},
  {"entity":"AINVOICES","title":"Customer Invoices Wizard","file":"82000.htm","relevance":"high","context":"AR tax invoices, customer invoices"},
  {"entity":"EINVOICES","title":"Customer Invoices Wizard","file":"82000.htm","relevance":"medium","context":"receipt tax invoices, customer receipt invoices"},
  {"entity":"TINVOICES","title":"Customer Receipts Wizard","file":"61000.htm","relevance":"high","context":"customer receipts, payment collections"},
  {"entity":"DOCUMENTS_C","title":"Inventory Count Wizard","file":"20600.htm","relevance":"high","context":"inventory count documents, stocktaking"},
  {"entity":"DOCUMENTS_D","title":"Customer Shipment/Return Wizard","file":"63000.htm","relevance":"high","context":"customer shipment documents, delivery vouchers"},
  {"entity":"DOCUMENTS_P","title":"Receipt of Goods Wizard","file":"51030.htm","relevance":"high","context":"goods receipt documents, supplier receipts"},
  {"entity":"DOCUMENTS_T","title":"Warehouse Transfers Wizard","file":"64000.htm","relevance":"high","context":"warehouse transfer documents, stock transfers"},
  {"entity":"SERIAL","title":"Work Orders Wizard","file":"51050.htm","relevance":"high","context":"production work orders (פקודות עבודה / פקע\"ות), kit list, routing, production reporting, release, close"},
  {"entity":"SERIALZOOM","title":"Work Orders Wizard","file":"51050.htm","relevance":"medium","context":"work orders zoom view, production status overview"},
  {"entity":"BANKS","title":"Set Up Bank Accounts Wizard","file":"20560.htm","relevance":"high","context":"bank setup, bank account configuration"},
  {"entity":"BANKBRANCHES","title":"Set Up Bank Accounts Wizard","file":"20560.htm","relevance":"medium","context":"bank branch setup, branch codes"},
  {"entity":"BANKACCTYPES","title":"Set Up Bank Accounts Wizard","file":"20560.htm","relevance":"medium","context":"bank account type definitions"},
  {"entity":"BANKNOTES","title":"Set Up Bank Accounts Wizard","file":"20560.htm","relevance":"medium","context":"bank notes, currency denominations"},
  {"entity":"CASH","title":"Set Up Cashiers Wizard","file":"20720.htm","relevance":"high","context":"cash register/bank setup, petty cash"},
  {"entity":"EMPLOYEES","title":"Employee Wizard","file":"20810.htm","relevance":"high","context":"employee management, employee records"},
  {"entity":"TAXES","title":"Taxes Wizard","file":"1301.htm","relevance":"high","context":"VAT setup, tax codes, tax rates"},
  {"entity":"PAY","title":"Set Up Payment Terms Wizard","file":"20320.htm","relevance":"high","context":"payment terms, due date calculations"},
  {"entity":"PAYMENTTYPE","title":"Set Up Payment Terms Wizard","file":"20320.htm","relevance":"medium","context":"payment type definitions, payment methods"},
  {"entity":"IVTYPES","title":"Set Up Financial Documents Wizard","file":"2601.htm","relevance":"high","context":"financial document types, certificate type setup"},
  {"entity":"IVCODES","title":"Set Up Financial Documents Wizard","file":"2601.htm","relevance":"medium","context":"additional financial classification codes"},
  {"entity":"DOCPAT","title":"Set Up Financial Documents Wizard","file":"2601.htm","relevance":"medium","context":"document number patterns, certificate numbering"},
  {"entity":"EXPENSETYPES","title":"Set Up Financial Documents Wizard","file":"2601.htm","relevance":"medium","context":"expense type definitions for financial docs"},
  {"entity":"FNCCONST","title":"Set Up Default Accounts Wizard","file":"20440.htm","relevance":"high","context":"financial constants, default account mappings"},
  {"entity":"FNCTRANS","title":"Manual Journal Entries Wizard","file":"20300.htm","relevance":"high","context":"financial transactions, manual journal entries"},
  {"entity":"GENLEDGERS","title":"Fiscal Periods Wizard","file":"20360.htm","relevance":"high","context":"fiscal years, period setup, general ledger periods"},
  {"entity":"BRANCHES","title":"Branches Wizard","file":"20340.htm","relevance":"high","context":"branch setup, organizational branches"},
  {"entity":"COMPDATA","title":"Companies Wizard","file":"68000.htm","relevance":"high","context":"company data, company information setup"},
  {"entity":"ENVIRONMENT","title":"Companies Wizard","file":"68000.htm","relevance":"medium","context":"company environments, company configuration"},
  {"entity":"COMPSTATUSES","title":"Companies Wizard","file":"68000.htm","relevance":"low","context":"company status reference, lifecycle states"},
  {"entity":"SYSCONST","title":"Companies Wizard","file":"68000.htm","relevance":"medium","context":"system constants, global system parameters"},
  {"entity":"UPGRADES","title":"Companies Wizard","file":"68000.htm","relevance":"low","context":"system upgrade versions, release history"},
  {"entity":"USERS","title":"Opening a User Wizard","file":"66000.htm","relevance":"high","context":"user setup, login credentials, user management"},
  {"entity":"AGENTS","title":"Sales Reps Wizard","file":"20400.htm","relevance":"high","context":"sales agents/reps, commission setup"},
  {"entity":"CTYPE","title":"Open Customers Wizard","file":"1131.htm","relevance":"medium","context":"customer type definitions, customer classification"},
  {"entity":"ORDSTATUS","title":"Sales Order Wizard","file":"62000.htm","relevance":"low","context":"order status reference codes"},
  {"entity":"CREDITREASONS","title":"Customer Refunds/Credit Vouchers Wizard","file":"90300.htm","relevance":"high","context":"credit reason codes, refund reasons"},
  {"entity":"CUSTNOTESA","title":"To Do List/Calendar Wizard","file":"90000.htm","relevance":"medium","context":"customer notes, task journal, to-do items"},
  {"entity":"FAMILY_LOG","title":"Set Up Accounting Families Wizard","file":"20480.htm","relevance":"high","context":"accounting families, product families"},
  {"entity":"FIXEDASSETS","title":"Fixed Assets Wizard","file":"40100.htm","relevance":"high","context":"fixed assets, depreciation, asset management"},
  {"entity":"LOGFILE","title":"Part Definition Wizard","file":"70007.htm","relevance":"medium","context":"inventory movement log (לוג תנועות מלאי), stock transaction history across all items"},
  {"entity":"LOGPART","title":"Part Definition Wizard","file":"70007.htm","relevance":"high","context":"item card (כרטיס פריט), per-part ledger showing all stock movements and balances"},
  {"entity":"PURDEMANDS","title":"Purchase Planning Wizard","file":"51200.htm","relevance":"high","context":"purchase demands, consolidated procurement requirements"},
  {"entity":"PRDISINGLE","title":"Purchase Planning Wizard","file":"51200.htm","relevance":"high","context":"purchase requisitions, single procurement requests"},
  {"entity":"PURTAXES","title":"Taxes Wizard","file":"1301.htm","relevance":"medium","context":"purchase tax codes, input VAT codes"},
  {"entity":"SATCODES","title":"Taxes Wizard","file":"1301.htm","relevance":"low","context":"Israeli SAT tax authority codes"},
  {"entity":"TAXONOMYCODES","title":"Part Definition Wizard","file":"70007.htm","relevance":"low","context":"product taxonomy/classification codes"},
  {"entity":"VATCOMPTYPES","title":"Taxes Wizard","file":"1301.htm","relevance":"medium","context":"VAT company entity types"},
  {"entity":"VATTYPES","title":"Taxes Wizard","file":"1301.htm","relevance":"medium","context":"VAT record types, VAT classification"},
  {"entity":"WTAXCODES","title":"Withholding Tax Wizard","file":"30001.htm","relevance":"high","context":"withholding tax codes, WHT setup"},
  {"entity":"WTAXES","title":"Withholding Tax Wizard","file":"30001.htm","relevance":"high","context":"withholding tax definitions and rates"},
  {"entity":"WTAXNUMEXPLS","title":"Withholding Tax Wizard","file":"30001.htm","relevance":"medium","context":"withholding tax filing number explanations"},
  {"entity":"TAXEXEMPTREASONS","title":"Taxes Wizard","file":"1301.htm","relevance":"medium","context":"VAT exemption reason codes"},
  {"entity":"FORM1099","title":"Withholding Tax Wizard","file":"30001.htm","relevance":"low","context":"1099 tax form sections"},
  {"entity":"ACT","title":"Manual Journal Entries Wizard","file":"20300.htm","relevance":"medium","context":"financial transaction types, action codes"},
  {"entity":"EREP","title":"Report Generators Wizard","file":"2000.htm","relevance":"medium","context":"report generator, report definition"},
  {"entity":"FORMLIMITED","title":"Privilege Explorer Wizard","file":"20930.htm","relevance":"medium","context":"form licensing, API access flags, REST enablement"},
  {"entity":"EFORM","title":"Privilege Explorer Wizard","file":"20930.htm","relevance":"low","context":"screen generator, form generator tool"},
  {"entity":"EMENU","title":"Privilege Explorer Wizard","file":"20930.htm","relevance":"low","context":"menu generator, menu structure tool"},
  {"entity":"EPROG","title":"Privilege Explorer Wizard","file":"20930.htm","relevance":"low","context":"procedure generator, program tool"},
  {"entity":"CITIES_ONE","title":"Open Customers Wizard","file":"1131.htm","relevance":"low","context":"city reference data, address locations"},
  {"entity":"COUNTRIES","title":"Open Customers Wizard","file":"1131.htm","relevance":"low","context":"country reference data, address countries"},
  {"entity":"MARITALSTATUS","title":"Personnel Setup Wizard","file":"20770.htm","relevance":"low","context":"marital status reference for HR"},
  {"entity":"BASESUPREP","title":"Open Vendors Wizard","file":"1141.htm","relevance":"medium","context":"base supplier report data, supplier info"},
  {"entity":"TYPSU","title":"Open Vendors Wizard","file":"1141.htm","relevance":"medium","context":"supplier preparation types, vendor types"},
  {"entity":"PARTARC","title":"Part Definition Wizard","file":"70007.htm","relevance":"high","context":"part components, BOM structure, child parts"},
  {"entity":"PARTEXTFILE","title":"Part Definition Wizard","file":"70007.htm","relevance":"medium","context":"part external documents, attached files"},
  {"entity":"DEFINEMNFPARTMIG","title":"Part Definition Wizard","file":"70007.htm","relevance":"medium","context":"manufacturer part migration, vendor part mapping"},
  {"entity":"NCATALOG","title":"Report Generators Wizard","file":"2000.htm","relevance":"low","context":"table catalog, table definition tool"},
  {"entity":"NCATALOGC","title":"Report Generators Wizard","file":"2000.htm","relevance":"low","context":"column catalog, table column definitions"},
  {"entity":"NCOLUMNSC","title":"Report Generators Wizard","file":"2000.htm","relevance":"low","context":"column definitions, column properties"},
  {"entity":"SALARYCONST","title":"Personnel Setup Wizard","file":"20770.htm","relevance":"medium","context":"salary constants, payroll configuration"},
  {"entity":"PDPROFTEXTHEADER","title":"Price Quotations Wizard","file":"70001.htm","relevance":"medium","context":"price quotation text templates, proposal text"},
  {"entity":"EXPFILES","title":"Report Generators Wizard","file":"2000.htm","relevance":"low","context":"export file definitions, data export setup"},
  {"entity":"FORMPREPERRS","title":"Warning Messages Wizard","file":"20620.htm","relevance":"low","context":"form preparation errors and warnings"},
  {"entity":"MENU","title":"Warning Messages Wizard","file":"20620.htm","relevance":"low","context":"menu execution log, menu runs"},
  {"entity":"PROGMAILBODY","title":"Set Up Financial Documents Wizard","file":"2601.htm","relevance":"low","context":"mail body text templates for documents"},
];

// Build entity lookup (entity → map entry)
const entityMapLookup = new Map();
for (const entry of ENTITY_WIZARD_MAP) {
  entityMapLookup.set(entry.entity.toUpperCase(), entry);
}
console.error(`[Wizards MCP] Loaded ${ENTITY_WIZARD_MAP.length} entity→wizard mappings`);

// ─── MCP Server factory (new instance per STDIO process / HTTP request) ──
function createServer() {
  const server = new Server({
    name: 'priority-wizards-mcp',
    version: '1.0.0'
  }, {
    capabilities: {
      tools: {},
      resources: {}
    }
  });

// ─── Resources ───────────────────────────────────────────────────
const RESOURCE_URI_PREFIX = 'wizard://';

/** Extract start filename from wizard:// or wizard://read/ URIs */
function parseWizardResourceUri(uri) {
  const match = uri.match(/^wizard:\/\/(?:read\/)?(.+)$/i);
  if (!match) return null;
  const pathPart = match[1];
  // wizard://{startFile}/{page} — page reads not implemented; use start file only
  const startFile = pathPart.split('/')[0];
  return startFile.toLowerCase();
}

function wizardResourceUri(filename) {
  return `wizard://read/${filename}`;
}

function readWizardByStartFile(startFileKey) {
  const wiz = wizByFile.get(startFileKey);
  if (!wiz) return null;
  const baseDir = heWizards.includes(wiz) ? CONFIG.hebrewDir : CONFIG.englishDir;
  return { wiz, baseDir, text: formatWizardText(wiz, baseDir) };
}

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'wizard://toc',
      name: 'Wizard Table of Contents',
      description: 'Complete listing of all wizards in Hebrew and English with page counts',
      mimeType: 'application/json'
    },
    {
      uri: 'wizard://toc/hebrew',
      name: 'Hebrew Wizard TOC',
      description: 'Hebrew wizards (from wiz1.chm)',
      mimeType: 'application/json'
    },
    {
      uri: 'wizard://toc/english',
      name: 'English Wizard TOC',
      description: 'English wizards (from wiz3.chm)',
      mimeType: 'application/json'
    },
    {
      uri: 'wizard://entity-map',
      name: 'Entity-to-Wizard Map',
      description: 'Maps 88 Priority ERP entities to their relevant wizard documentation with context',
      mimeType: 'application/json'
    }
  ]
}));

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    {
      uriTemplate: 'wizard://read/{filename}',
      name: 'Wizard by filename',
      description: 'Full wizard documentation by start page filename (e.g. 81000.htm for Purchase Orders). Prefer wizard_get tool when available.',
      mimeType: 'text/plain'
    },
    {
      uriTemplate: 'wizard://{filename}',
      name: 'Wizard by filename (short form)',
      description: 'Same as wizard://read/{filename}',
      mimeType: 'text/plain'
    }
  ]
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  
  if (uri === 'wizard://toc') {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          total: allWizards.length,
          hebrew: heWizards.length,
          english: enWizards.length,
          wizards: allWizards.map(w => ({
            title: w.title,
            category: w.category,
            pages: w.pages.length,
            startFile: path.basename(w.pages[0]?.file || '')
          }))
        }, null, 2)
      }]
    };
  }
  
  if (uri === 'wizard://toc/hebrew') {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(heWizards.map(w => ({
          title: w.title,
          pages: w.pages.length,
          startFile: path.basename(w.pages[0]?.file || '')
        })), null, 2)
      }]
    };
  }
  
  if (uri === 'wizard://toc/english') {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(enWizards.map(w => ({
          title: w.title,
          category: w.category,
          pages: w.pages.length,
          startFile: path.basename(w.pages[0]?.file || '')
        })), null, 2)
      }]
    };
  }

  if (uri === 'wizard://entity-map') {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          count: ENTITY_WIZARD_MAP.length,
          entities: ENTITY_WIZARD_MAP
        }, null, 2)
      }]
    };
  }
  
  // wizard://read/{startFile} or wizard://{startFile}
  const startFileKey = parseWizardResourceUri(uri);
  if (startFileKey) {
    const result = readWizardByStartFile(startFileKey);
    if (!result) {
      throw new Error(`Wizard not found: ${startFileKey}. Use wizard://toc or wizard_list to see available wizards.`);
    }
    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: result.text
      }]
    };
  }
  
  throw new Error(`Unknown resource: ${uri}`);
});

// ─── Tools ───────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'wizard_list',
      description: 'List all available wizards with titles, categories, and page counts. Supports optional filter by language (en/he) or search term.',
      inputSchema: {
        type: 'object',
        properties: {
          language: {
            type: 'string',
            description: 'Filter by language: "en" for English, "he" for Hebrew. Omit for both.',
            enum: ['en', 'he']
          },
          search: {
            type: 'string',
            description: 'Optional search term to filter wizard titles'
          }
        }
      }
    },
    {
      name: 'wizard_search',
      description: 'Search across all wizard titles and content for a query string.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (searches titles and page content)'
          },
          language: {
            type: 'string',
            description: 'Optional language filter: "en" or "he"',
            enum: ['en', 'he']
          }
        },
        required: ['query']
      }
    },
    {
      name: 'wizard_get',
      description: 'Get the full content of a wizard by its exact title or start filename.',
      inputSchema: {
        type: 'object',
        properties: {
          identifier: {
            type: 'string',
            description: 'Wizard title (exact match) or start filename (e.g. "68000.htm" for Companies Wizard)'
          },
          language: {
            type: 'string',
            description: 'Optional language hint: "en" or "he"',
            enum: ['en', 'he']
          }
        },
        required: ['identifier']
      }
    },
    {
      name: 'wizard_entity_map',
      description: 'Get the documentation wizard relevant to a Priority ERP entity. Maps entities like ORDERS, CUSTOMERS, PART to their corresponding setup wizard. Returns the wizard title, relevance level, and topic context.',
      inputSchema: {
        type: 'object',
        properties: {
          entity: {
            type: 'string',
            description: 'Priority ERP entity name (e.g. ORDERS, CUSTOMERS, PART, PORDERS). Case-insensitive.'
          },
          all: {
            type: 'boolean',
            description: 'If true, return the full entity-to-wizard map (ignores entity filter)'
          }
        }
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  switch (name) {
    case 'wizard_list': {
      let source = allWizards;
      if (args.language === 'he') source = heWizards;
      if (args.language === 'en') source = enWizards;
      
      let results = source.map(w => ({
        title: w.title,
        category: w.category,
        pages: w.pages.length,
        startFile: path.basename(w.pages[0]?.file || '')
      }));
      
      if (args.search) {
        const qTokens = tokenize(args.search);
        results = results.filter(r => tokensMatch(qTokens, tokenize(r.title)));
      }
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: results.length,
            wizards: results
          }, null, 2)
        }]
      };
    }
    
    case 'wizard_search': {
      const { query, language } = args;
      
      // Auto-detect Hebrew queries and use dual-language search
      if (hasHebrew(query)) {
        const results = searchWizardsHebrew(query, heWizards, enWizards, [CONFIG.hebrewDir, CONFIG.englishDir]);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              query,
              count: results.length,
              results: results.slice(0, 50)
            }, null, 2)
          }]
        };
      }
      
      // Search ALL wizards for maximum recall (token-based matching), then post-filter by language
      let results = searchWizards(allWizards, query, [CONFIG.hebrewDir, CONFIG.englishDir]);
      
      // Apply language post-filter — keep only results whose wizard title exists in the target language set
      if (language === 'en') {
        const enTitles = new Set(enWizards.map(w => w.title));
        results = results.filter(r => enTitles.has(r.title));
      } else if (language === 'he') {
        const heTitles = new Set(heWizards.map(w => w.title));
        results = results.filter(r => heTitles.has(r.title));
      }
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            query,
            count: results.length,
            results: results.slice(0, 50)
          }, null, 2)
        }]
      };
    }
    
    case 'wizard_entity_map': {
      const { entity, all } = args;
      if (all) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: ENTITY_WIZARD_MAP.length,
              entities: ENTITY_WIZARD_MAP
            }, null, 2)
          }]
        };
      }
      const upper = (entity || '').toUpperCase();
      const match = entityMapLookup.get(upper);
      if (!match) {
        // Try partial match — only match if the stored entity name contains the query prefix,
        // NOT the reverse (e.g. "WORDERS" must not match stored "ORDERS")
        const partial = ENTITY_WIZARD_MAP.filter(e => e.entity.includes(upper));
        if (partial.length === 0) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ entity: upper, found: false, message: `No wizard mapping found for entity "${entity}". Use wizard_entity_map(all: true) to see all ${ENTITY_WIZARD_MAP.length} mapped entities.` }, null, 2)
            }]
          };
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ entity: upper, found: true, matches: partial }, null, 2)
          }]
        };
      }
      // Include full wizard content hint = how to get the full content
      const wizardWiz = wizByFile.get(match.file.toLowerCase());
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            entity: upper,
            found: true,
            wizard: {
              title: match.title,
              file: match.file,
              relevance: match.relevance,
              context: match.context
            },
            fullContentAvailable: !!wizardWiz,
            resourceUri: wizardResourceUri(match.file),
            getFullContent: `Use wizard_get(identifier: "${match.file}") or read resource ${wizardResourceUri(match.file)}`
          }, null, 2)
        }]
      };
    }

    case 'wizard_get': {
      const { identifier, language } = args;
      const id = identifier.toLowerCase();
      
      // Try by filename first
      let wizard = wizByFile.get(id);
      
      // Try by title
      if (!wizard) {
        let source = allWizards;
        if (language === 'he') source = heWizards;
        if (language === 'en') source = enWizards;
        
        // Try exact title match
        wizard = source.find(w => w.title.toLowerCase() === id);
        // Try contains match
        if (!wizard) {
          wizard = source.find(w => w.title.toLowerCase().includes(id));
        }
      }
      
      if (!wizard) {
        throw new Error(`Wizard not found: "${identifier}". Use wizard_list to see available wizards.`);
      }
      
      const baseDir = heWizards.includes(wizard) ? CONFIG.hebrewDir : CONFIG.englishDir;
      return {
        content: [{
          type: 'text',
          text: formatWizardText(wizard, baseDir)
        }]
      };
    }
    
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
  });

  return server;
}

// ─── Helpers ─────────────────────────────────────────────────────
function formatWizardText(wizard, baseDir) {
  const lines = [];
  lines.push(`# ${wizard.title}`);
  if (wizard.category) lines.push(`Category: ${wizard.category}`);
  lines.push(`Pages: ${wizard.pages.length}`);
  lines.push('');
  
  for (const page of wizard.pages) {
    const data = readPage(page.file);
    if (data) {
      lines.push(`## ${data.title}`);
      lines.push(data.content);
      lines.push('');
    }
  }
  
  return lines.join('\n');
}

// ─── Start ───────────────────────────────────────────────────────
async function main() {
  const useHttp = process.argv.includes('--http');

  if (useHttp) {
    const express = require('express');
    const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

    const app = express();
    app.use(express.json({ limit: '4mb' }));

    app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        server: 'priority-wizards-mcp',
        wizards: { hebrew: heWizards.length, english: enWizards.length }
      });
    });

    // Optional bearer-token auth — enabled when API_KEY env var is set
    if (CONFIG.apiKey) {
      console.error('[Wizards MCP] API_KEY is set — HTTP endpoint requires Authorization: Bearer <key>');
      app.use('/mcp', (req, res, next) => {
        const auth = req.headers['authorization'] || '';
        if (auth === `Bearer ${CONFIG.apiKey}`) return next();
        res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
      });
    }

    // Stateless Streamable HTTP — new server + transport per request (SDK pattern)
    app.post('/mcp', async (req, res) => {
      const mcpServer = createServer();
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
        res.on('close', () => {
          transport.close();
          mcpServer.close();
        });
      } catch (error) {
        console.error('[Wizards MCP] Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null
          });
        }
      }
    });

    app.get('/mcp', (_req, res) => {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null
      });
    });

    app.delete('/mcp', (_req, res) => {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null
      });
    });

    app.listen(CONFIG.port, CONFIG.host, () => {
      console.error(`[Wizards MCP] HTTP server running on http://${CONFIG.host}:${CONFIG.port}`);
      console.error(`[Wizards MCP] Health: http://${CONFIG.host}:${CONFIG.port}/health`);
      console.error(`[Wizards MCP] MCP endpoint: http://${CONFIG.host}:${CONFIG.port}/mcp`);
    });
  } else {
    const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[Wizards MCP] Server running on STDIO');
  }
}

main().catch(err => {
  console.error('[Wizards MCP] Fatal error:', err);
  process.exit(1);
});
