/**
 * Quick end-to-end test of the entity map features.
 */
const { spawn } = require('child_process');
const path = require('path');

const projectDir = path.resolve(__dirname, '..'); // up from src/ to root
const p = spawn('node', ['src/index.js'], { cwd: projectDir, stdio: ['pipe', 'pipe', 'pipe'] });

let buffer = '';
let id = 0;
const pending = new Map();

p.stdout.on('data', d => {
  buffer += d.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const resp = JSON.parse(line);
      const cb = pending.get(resp.id);
      if (cb) { pending.delete(resp.id); cb(resp); }
    } catch {}
  }
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const rid = ++id;
    const msg = JSON.stringify({ jsonrpc: '2.0', id: rid, method, params }) + '\n';
    const t = setTimeout(() => { pending.delete(rid); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(rid, r => { clearTimeout(t); if (r.error) reject(new Error(r.error.message)); else resolve(r); });
    p.stdin.write(msg);
  });
}

async function main() {
  await new Promise(r => setTimeout(r, 2000));

  // Initialize
  await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await new Promise(r => setTimeout(r, 300));

  // 1. List tools
  const tools = await send('tools/list');
  const toolNames = tools.result.tools.map(t => t.name);
  console.log('Tools:', toolNames.join(', '));

  // 2. List resources
  const resources = await send('resources/list');
  const resourceUris = resources.result.resources.map(r => r.uri);
  console.log('Resources:', resourceUris.join(', '));

  // 3. wizard_entity_map for ORDERS
  const r1 = await send('tools/call', { name: 'wizard_entity_map', arguments: { entity: 'ORDERS' } });
  const d1 = JSON.parse(r1.result.content[0].text);
  console.log(`\nORDERS → ${d1.wizard.title} (${d1.wizard.relevance}, ${d1.wizard.context})`);

  // 4. wizard_entity_map all
  const r4 = await send('tools/call', { name: 'wizard_entity_map', arguments: { all: true } });
  const d4 = JSON.parse(r4.result.content[0].text);
  console.log(`\nAll entities: ${d4.count}`);

  console.log('\n✅ All tests passed!');
  p.kill();
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Failed:', err.message);
  p.kill();
  process.exit(1);
});
