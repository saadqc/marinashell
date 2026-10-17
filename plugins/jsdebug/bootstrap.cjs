const inspector = require('node:inspector');
const fs = require('node:fs');
const endpoint = __MARINA_ENDPOINT__;
inspector.open(0, '127.0.0.1', false);
const url = new URL(inspector.url());
fs.writeFileSync(endpoint + '.tmp', JSON.stringify({ host: '127.0.0.1', port: Number(url.port), pid: process.pid, cwd: process.cwd(), interpreter: process.execPath }), { mode: 0o600 });
fs.renameSync(endpoint + '.tmp', endpoint);
console.log('JSDebug: waiting for debugger');
inspector.waitForDebugger();
