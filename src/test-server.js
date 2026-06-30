/**
 * Quick test of the MCP server via STDIO JSON-RPC.
 */
const { spawn } = require('child_process');

const serverProcess = spawn('node', ['src/index.js'], {
  cwd: __dirname,
  stdio: ['pipe', 'pipe', 'pipe']
});

let buffer = '';
let requestId = 0;
const pending = new Map();
let serverReady = false;

serverProcess.stdout.on('data', (data) => {
  buffer += data.toString();
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const response = JSON.parse(line);
      const resolver = pending.get(response.id);
      if (resolver) {
        pending.delete(response.id);
        resolver(response);
      }
    } catch {}
  }
});

serverProcess.stderr.on('data', (data) => {
  const text = data.toString();
  if (text.includes('Server running')) serverReady = true;
});

function sendRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout: ${method}`));
    }, 15000);
    pending.set(id, (response) => {
      clearTimeout(timeout);
      if (response.error) reject(new Error(response.error.message));
      else resolve(response);
    });
    serverProcess.stdin.write(msg);
  });
}

async function main() {
  try {
    // Wait for server ready
    while (!serverReady) await new Promise(r => setTimeout(r, 100));

    // Initialize
    const init = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' }
    });
    console.log('Server:', init.result.serverInfo.name, init.result.serverInfo.version);

    // Notify initialized
    serverProcess.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await new Promise(r => setTimeout(r, 100));

    // List tools
    const tools = await sendRequest('tools/list');
    console.log('Tools:', tools.result.tools.map(t => t.name).join(', '));

    // List resources
    const resources = await sendRequest('resources/list');
    console.log('Resources:', resources.result.resources.map(r => r.uri).join(', '));

    // Read TOC
    const toc = await sendRequest('resources/read', { uri: 'wizard://toc' });
    const tocData = JSON.parse(toc.result.contents[0].text);
    console.log(`TOC: ${tocData.total} wizards (HE: ${tocData.hebrew}, EN: ${tocData.english})`);
    console.log('  First 5:', tocData.wizards.slice(0, 5).map(w => w.title).join(', '));

    // wizard_list
    const list = await sendRequest('tools/call', { name: 'wizard_list', arguments: { language: 'en', search: 'Company' } });
    const listData = JSON.parse(list.result.content[0].text);
    console.log(`\nwizard_list(en, Company): ${listData.count} found`);
    listData.wizards.slice(0, 5).forEach(w => console.log(`  → ${w.title} (${w.pages}p, ${w.startFile})`));

    // wizard_search
    const search = await sendRequest('tools/call', { name: 'wizard_search', arguments: { query: 'exchange rates', language: 'en' } });
    const sData = JSON.parse(search.result.content[0].text);
    console.log(`\nwizard_search("exchange rates"): ${sData.count} results`);
    sData.results.slice(0, 5).forEach(r => console.log(`  → ${r.title} [${r.matchType}]`));

    // wizard_get by title
    const get = await sendRequest('tools/call', { name: 'wizard_get', arguments: { identifier: 'Companies Wizard', language: 'en' } });
    const lines = get.result.content[0].text.split('\n');
    console.log(`\nwizard_get("Companies Wizard"):`);
    console.log(`  ${lines[0]}`);
    console.log(`  ${lines[1]}`);
    console.log('  Intro:', (lines[4] || '').substring(0, 200));

    // wizard_get by filename
    const get2 = await sendRequest('tools/call', { name: 'wizard_get', arguments: { identifier: '68000.htm' } });
    console.log(`\nwizard_get("68000.htm"): ${get2.result.content[0].text.split('\n')[0]}`);

    // wizard://read/{filename} resource URIs (procurement entities)
    for (const uri of ['wizard://read/81000.htm', 'wizard://read/51030.htm', 'wizard://read/70003.htm']) {
      const res = await sendRequest('resources/read', { uri });
      console.log(`\nresources/read(${uri}): ${res.result.contents[0].text.split('\n')[0]}`);
    }

    console.log('\n✅ All tests passed!');
  } catch (err) {
    console.error('❌ Failed:', err.message);
  }

  serverProcess.kill();
  process.exit(0);
}

main();
