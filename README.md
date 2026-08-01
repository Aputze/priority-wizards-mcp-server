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
│  MCP Client (Cursor / Jeen / other)                 │
│  Calls wizard_list / wizard_search / wizard_get     │
└────────────┬────────────────────────────────────────┘
             │ STDIO  or  HTTP Streamable (POST /mcp)
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
│  │ Filesystem (paths from .env or defaults)      │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Configuration (`.env`)

Copy `.env.example` to `.env` and adjust paths for your machine:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `WIZ1_HHC` | `D:\priority\tmp\chm_extract_wiz1\WIZ1.hhc` | Hebrew TOC file |
| `WIZ1_DIR` | `D:\priority\tmp\chm_extract_wiz1` | Hebrew HTML directory |
| `WIZ3_HHC` | `D:\priority\tmp\chm_extract_wiz3\WIZ3.hhc` | English TOC file |
| `WIZ3_DIR` | `D:\priority\tmp\chm_extract_wiz3` | English HTML directory |
| `PORT` | `3002` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP listen host |

## Running

### STDIO (Cursor / local MCP)

```bash
npm start
# or: node src/index.js
```

### HTTP Streamable (local)

```bash
npm run start:http
# or: node src/index.js --http
```

### Docker (recommended for Jeen / multi-user)

Wizard HTML stays on the host and is mounted read-only into the container.

1. Ensure `.env` has host mount paths (forward slashes on Windows):

```env
WIZ1_HOST_DIR=D:/priority/tmp/chm_extract_wiz1
WIZ3_HOST_DIR=D:/priority/tmp/chm_extract_wiz3
PORT=3002
```

2. Build and start:

```bash
npm run docker:up
# or: docker compose up -d --build
```

3. Check:

```bash
curl http://localhost:3002/health
docker compose logs -f wizards-mcp
```

4. Stop:

```bash
npm run docker:down
```

| Script | Command |
|--------|---------|
| `npm run docker:up` | Build + start detached |
| `npm run docker:down` | Stop and remove container |
| `npm run docker:logs` | Follow container logs |

Endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check + wizard counts |
| `POST` | `/mcp` | MCP Streamable HTTP endpoint |

```bash
curl http://localhost:3002/health
```

## MCP Interface

### Resources

| URI | Description |
|-----|-------------|
| `wizard://toc` | Full TOC (all wizards, both languages) |
| `wizard://toc/hebrew` | Hebrew wizard TOC |
| `wizard://toc/english` | English wizard TOC |
| `wizard://entity-map` | Entity-to-wizard mapping for Priority ERP forms |
| `wizard://read/{filename}` | Full wizard content by start page (e.g. `wizard://read/81000.htm`) |
| `wizard://{filename}` | Short form of the above |

### Tools

| Tool | Description |
|------|-------------|
| `wizard_list` | List wizards with optional language/search filter |
| `wizard_search(query)` | Search across all wizard titles and content |
| `wizard_get(identifier)` | Get full wizard content by title or filename |
| `wizard_entity_map` | Map a Priority ERP entity to its setup wizard |

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
npm start              # STDIO mode (Cursor)
npm run start:http     # HTTP mode on PORT (default 3002)
npm run docker:up      # Docker HTTP on PORT
npm test               # Integration tests
```

## Files

- `src/index.js` — MCP server entry point (STDIO + HTTP)
- `src/wizard-toc-parser.js` — Parses .hhc TOC files into structured data
- `src/wizard-content-reader.js` — Reads .htm files, strips HTML to text
- `src/test-parser.js` — Tests the TOC parser
- `src/test-server.js` — End-to-end MCP protocol test
- `Dockerfile` / `docker-compose.yml` — Container deployment (HTTP)
- `.env.example` — Configuration template
