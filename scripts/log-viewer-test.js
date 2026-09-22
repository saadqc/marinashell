const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'logs-test-'));
const file=path.join(root,"app's log.txt");fs.writeFileSync(file,Array.from({length:600},(_,i)=>`line ${i}\n`).join(''));
let stopped=0;
const {registerLogViewer}=require('../main/services/logViewer');
const sessionManager=require('../main/services/sessionManager').createSessionManager({sendToRenderer:()=>{},logDebug:()=>{},getSettings:()=>({})});
const stream=sessionManager.streamCommand;
sessionManager.streamCommand=async(...args)=>{const stop=await stream(...args);return ()=>{stopped++;stop();};};
registerLogViewer({ipcMain,BrowserWindow,sessionManager});
app.whenReady().then(async()=>{
 const source=new BrowserWindow({show:false,webPreferences:{preload:path.resolve('preload.js')}});
 await source.loadURL('about:blank');
 await source.webContents.executeJavaScript(`api.invoke('logs:open',${JSON.stringify({host:'__local__',path:file})})`);
 const viewer=BrowserWindow.getAllWindows().find(w=>w!==source);
 assert(viewer.isAlwaysOnTop());
 const run=js=>viewer.webContents.executeJavaScript(js);
 async function wait(text){for(let i=0;i<100;i++){if((await run('document.querySelector("#output").textContent')).includes(text))return;await new Promise(r=>setTimeout(r,50));}throw Error('Missing '+text);}
 await wait('line 599');assert(!(await run('document.querySelector("#output").textContent')).includes('line 99\n'));
 await run('document.querySelector("#follow").click()');await new Promise(r=>setTimeout(r,200));
 fs.appendFileSync(file,'appended entry\n');await wait('appended entry');
 await run('document.querySelector("#follow").click()');await new Promise(r=>setTimeout(r,200));
 fs.appendFileSync(file,'after pause\n');await new Promise(r=>setTimeout(r,1200));
 assert(!(await run('document.querySelector("#output").textContent')).includes('after pause'));
 viewer.close();assert(stopped>=2);source.destroy();console.log('PASS: topmost popup, last 500 lines, quoted paths, live follow, uncheck stops streaming, close cleanup');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{BrowserWindow.getAllWindows().forEach(w=>w.destroy());fs.rmSync(root,{recursive:true,force:true});app.exit(process.exitCode||0);});
