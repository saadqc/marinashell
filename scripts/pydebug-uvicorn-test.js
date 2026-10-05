const assert = require('assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path'); const net = require('net');
const { spawn, execFileSync } = require('child_process');
const { createRunManager } = require('../plugins/run-configurations/manager');
const { createDebugManager } = require('../plugins/pydebug/session-manager');
const { createDebugStore } = require('../plugins/pydebug/store');
const python = process.env.PYDEBUG_TEST_PYTHON || '/tmp/marinashell-pydebug-test-env/bin/python';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-debug-http-')); let runs, debug;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const execute = (_host, command) => new Promise((resolve, reject) => {
  const child = spawn('/bin/bash', ['-c', command], { env: { ...process.env, HOME: root } }); let stdout = '', stderr = '';
  child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data); child.on('error', reject); child.on('close', exitCode => resolve({ stdout, stderr, exitCode }));
});
async function port() { const server=net.createServer(); await new Promise(r=>server.listen(0,'127.0.0.1',r)); const number=server.address().port; await new Promise(r=>server.close(r)); return number; }
(async () => {
  const file = path.join(root, 'fixture_app.py');
  fs.writeFileSync(file, 'async def app(scope, receive, send):\n    if scope["type"] != "http":\n        return\n    case_id = scope["query_string"].decode()\n    payload = {"case_id": case_id}\n    await send({"type": "http.response.start", "status": 200, "headers": []})\n    await send({"type": "http.response.body", "body": case_id.encode()})\n');
  const applicationPort = await port();
  runs = createRunManager({ execute, hostIdentity: async () => 'fixture', root }); const store = createDebugStore(root);
  debug = createDebugManager({ runs, store });
  const config = runs.configs.upsert({ name:'Uvicorn', host:'__local__', type:'python', mode:'module', interpreter:python, target:'uvicorn', args:`fixture_app:app --host 127.0.0.1 --port ${applicationPort} --lifespan off --reload --reload-dir ${root} --workers 1`, cwd:root });
  const original = JSON.stringify(runs.configs.read());
  store.saveBreakpoint({ host:'__local__',projectId:'web',path:file,line:6,condition:'case_id == "CASE-123"' });
  const result = await debug.start(config.id,'web','HTTP fixture');
  assert(result.run.debugNotes.includes('Reload disabled for this debug session'));
  const url = `http://127.0.0.1:${applicationPort}/`;
  for(let i=0;i<100;i++){try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)break;}catch(_){} await delay(100);}
  let resolved = false; const request = fetch(url+'?CASE-123',{signal:AbortSignal.timeout(15000)}).then(async response=>{ resolved=true; return response.text(); });
  request.catch(()=>{});
  let paused;
  for(let i=0;i<100;i++){paused=debug.list().find(s=>s.id===result.session.id);if(paused.state==='paused')break;await delay(100);}
  assert.equal(paused.state,'paused'); assert.equal(resolved,false);
  const frames = await debug.request(paused.id,'stackTrace',{threadId:paused.threadId},paused.generation);
  const frame=frames.stackFrames.find(f=>f.source?.path===file || f.source?.path===fs.realpathSync(file)); assert(frame); assert.equal(frame.line,6);
  const value=await debug.request(paused.id,'evaluate',{frameId:frame.id,expression:'payload',context:'watch'},paused.generation); assert.match(value.result,/CASE-123/);
  await debug.action(paused.id,'continue'); assert.equal(await request,'CASE-123');
  await debug.stop(paused.id); const output = await runs.poll(result.run.id,0,0); assert.doesNotMatch(output.output,/Started reloader process/);
  assert.equal(JSON.stringify(runs.configs.read()),original);
  await assert.rejects(fetch(url,{signal:AbortSignal.timeout(1000)}));
  const missing=runs.configs.upsert({...config,id:'missing-python',interpreter:'/missing/python'});
  const before=runs.list().length; await assert.rejects(debug.start(missing.id,'web'),/preflight failed/); assert.equal(runs.list().length,before);
  const emptyEnvironment=path.join(root,'without-debugpy'); execFileSync(python,['-m','venv','--without-pip',emptyEnvironment]);
  const noAdapter=runs.configs.upsert({...config,id:'missing-debugpy',interpreter:path.join(emptyEnvironment,'bin','python')});
  await assert.rejects(debug.start(noAdapter.id,'web'), error=>error.message.includes('pip install debugpy==1.8.17') && error.message.includes(noAdapter.interpreter));
  assert.equal(runs.list().length,before);
  const multiple=runs.configs.upsert({...config,id:'multi-worker',args:config.args.replace('--workers 1','--workers 2')}); await assert.rejects(debug.start(multiple.id,'web'),/one Uvicorn worker/);
  const cancellation=debug.start(config.id,'web'); cancellation.catch(()=>{}); await debug.shutdown(); await assert.rejects(cancellation,/cancelled/);
  for(const run of runs.list())assert(['exited','failed','blocked'].includes((await runs.status(run.id)).status));
  console.log('PASS: real Uvicorn module/request conditional stop, payload and async stack, resume response, disabled reload, unchanged saved configuration, released port, missing-interpreter/multi-worker preflight and launch-cancellation cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await debug?.shutdown();await runs?.shutdown();fs.rmSync(root,{recursive:true,force:true});});
