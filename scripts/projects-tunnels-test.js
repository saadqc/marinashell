const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { normalizeProject } = require('../main/services/projects');
const { createTunnelManager } = require('../plugins/tunnels/manager');
const service = require('../main/services/tunnelService');
(async () => {
  assert.throws(()=>normalizeProject({name:'Bad',tabs:[{manualTitle:'Bad',host:'host',currentPath:'relative'}]}));
  const project=normalizeProject({name:'Mixed',layout:'2x2',tabs:['a','b','__local__','c'].map(host=>({host,manualTitle:host,currentPath:'/srv/app'}))});
  assert.equal(project.layout,'2x2'); assert.equal(project.tabs.length,4);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marina-tunnels-'));
  const calls=[], live=new Map(); let fail=false;
  const sessions={ connectControl:async(id,host)=>{calls.push(['connect',id,host]); await new Promise(r=>setTimeout(r,15));}, createTunnel:async(id,type,config)=>{calls.push(['create',id,type,config]); if(fail) throw new Error('Port busy'); live.set(id,{status:'active'}); return {id};}, disconnect:async id=>{calls.push(['disconnect',id]); live.delete(id);} };
  const manager=createTunnelManager({root,sessionManager:sessions,resolveHost:alias=>({alias}),tunnelService:{tunnels:live}});
  try {
    const legacy = { db: [{type:'local',srcPort:5433,dstHost:'127.0.0.1',dstPort:5432}], other: [{type:'dynamic',srcPort:1080,autoStart:false}], malformed:null };
    const original=structuredClone(legacy);
    const migrated=createTunnelManager({root:path.join(root,'migration'),sessionManager:sessions,resolveHost:alias=>({alias}),legacy});
    assert.equal(migrated.list().length,2);
    assert.equal(migrated.list()[0].host,'db');assert.equal(migrated.list()[1].host,'other');
    assert(migrated.list().every(p=>typeof p.id==='string' && p.id));
    assert.equal(new Set(migrated.list().map(p=>p.id)).size,2);
    assert.equal(migrated.list()[0].autoStart,true);assert.equal(migrated.list()[1].autoStart,false);
    assert.deepEqual(legacy,original);
    await migrated.start(migrated.list()[0].id);await migrated.shutdown();
    const again=createTunnelManager({root:path.join(root,'migration'),sessionManager:sessions,resolveHost:alias=>({alias}),legacy});
    assert.deepEqual(again.list(),migrated.list(),'Migration is idempotent and IDs persist');
    for(const [index,legacy] of [null,{},'invalid',42,[null,{host:'db',type:'dynamic',srcPort:1080,id:'same'},{host:'db',type:'dynamic',srcPort:1081,id:'same'}]].entries()) {
      const converted=createTunnelManager({root:path.join(root,`shape-${index}`),sessionManager:sessions,resolveHost:alias=>({alias}),legacy});
      assert.equal(converted.list().length,index===4?2:0);
      assert.equal(new Set(converted.list().map(p=>p.id)).size,converted.list().length);
    }
    calls.length=0;
    const profile=await manager.save({name:'Database',host:'db',type:'local',srcPort:5433,dstHost:'127.0.0.1',dstPort:5432});
    await Promise.all([manager.start(profile.id),manager.start(profile.id)]);
    assert.equal(calls.filter(c=>c[0]==='connect').length,1);
    assert.deepEqual(calls.find(c=>c[0]==='create')[3],{localPort:5433,remoteHost:'127.0.0.1',remotePort:5432});
    assert.equal(manager.list()[0].status,'active'); await manager.stop(profile.id); assert.equal(manager.list()[0].status,'stopped');
    fail=true; await assert.rejects(manager.start(profile.id),/Port busy/); assert.equal(manager.list()[0].status,'error'); fail=false;
    await manager.start(profile.id); live.clear(); assert.equal(manager.list()[0].status,'error');
    const remote=await manager.save({...profile,type:'remote'}); await manager.start(remote.id);
    assert.deepEqual(calls.filter(c=>c[0]==='create').at(-1)[3],{remotePort:5433,localHost:'127.0.0.1',localPort:5432});
    await manager.remove(profile.id); assert.equal(manager.list().length,0);
    await assert.rejects(manager.save({name:'Invalid',host:'__local__',type:'local',srcPort:0}));
    const restarted=createTunnelManager({root,sessionManager:sessions,resolveHost:alias=>({alias}),legacy:[profile]}); assert.equal(restarted.list().length,0,'Deleted profiles must not remigrate');
    // Real listener collision must reject rather than leave an unresolved operation.
    const blocker=net.createServer(); await new Promise(resolve=>blocker.listen(0,'127.0.0.1',resolve));
    try { await assert.rejects(Promise.race([service.createLocalForward({},'collision',{localPort:blocker.address().port,type:'local'}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Timed out')),1000);timer.unref();})]),/EADDRINUSE/); }
    finally { await new Promise(resolve=>blocker.close(resolve)); }
    console.log('PASS: project validation, tunnel persistence, duplicate starts, forwarding mapping, failure/retry, disconnect detection, deletion, listener collision');
  } finally { await manager.shutdown(); fs.rmSync(root,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
