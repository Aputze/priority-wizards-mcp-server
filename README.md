# Priority Wizards MCP Server

Standalone MCP server that provides access to Priority ERP wizard help content
extracted from compiled HTML Help (CHM) files.

## Source Data

- **wiz1.chm** — Hebrew wizards (located at `d:\priority\client\helpheb\`)
- **wiz3.chm** — English wizards (located at `d:\priority\client\helpheb\`)

Both were decompiled using `hh.exe -decompile` into:
- `d:\priority\tmp\chm_extract_wiz1\` (~4,452 .htm files, Hebrew)
- `d:\priority\tmp\chm_extract_wiz3\` (~19,360 .htm files, English)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  MCP Client (Cursor Agent / Claude)                 │
│  Calls wizard_list / wizard_search / wizard_get     │
└────────────┬────────────────────────────────────────┘
             │ STDIO (JSON-RPC 2.0)
┌────────────▼────────────────────────────────────────┐
│  priority-wizards-mcp-server (Node.js)               │
│                                                      │
│  ┌────────────────┐  ┌──────────────────────────┐   │
│  │ TOC Parser     │  │ Content Reader            │   │
│  │ (WIZ*.hhc)     │  │ (.htm files → text)       │   │
│  └───────┬────────┘  └────────────┬─────────────┘   │
│          │                        │                  │
│          ▼                        ▼                  │
│  ┌──────────────────────────────────────────────┐   │
│  │ Filesystem (d:\priority\tmp\chm_extract_*)    │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## MCP Interface

### Resources

| URI | Description |
|-----|-------------|
| `wizard://toc` | Full TOC (all wizards, both languages) |
| `wizard://toc/hebrew` | Hebrew wizard TOC |
| `wizard://toc/english` | English wizard TOC |

### Tools

| Tool | Description |
|------|-------------|
| `wizard_list` | List wizards with optional language/search filter |
| `wizard_search(query)` | Search across all wizard titles and content |
| `wizard_get(identifier)` | Get full wizard content by title or filename |

## Usage

```json
// List all English wizards about customers
{
  "toolName": "wizard_list",
  "arguments": { "language": "en", "search": "Customer" }
}

// Search for "exchange rates" in all wizard content
{
  "toolName": "wizard_search",
  "arguments": { "query": "exchange rates", "language": "en" }
}

// Read a wizard's full content
{
  "toolName": "wizard_get",
  "arguments": { "identifier": "Companies Wizard", "language": "en" }
}
```

## Developer

```bash
cd priority-wizards-mcp-server
npm install
npm start          # Run the MCP server (STDIO mode)
node src/test-server.js  # Run integration tests
```

## Files

- `src/index.js` — MCP server entry point
- `src/wizard-toc-parser.js` — Parses .hhc TOC files into structured data
- `src/wizard-content-reader.js` — Reads .htm files, strips HTML to text
- `src/test-parser.js` — Tests the TOC parser
- `src/test-server.js` — End-to-end MCP protocol test
