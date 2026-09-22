const path = require('path');
const { resolveHost } = require('./sshConfig');
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
function registerLogViewer({ipcMain, BrowserWindow, sessionManager}) {
  const viewers = new Map();
  ipcMain.handle('logs:open', async (_event, payload = {}) => {
    if (typeof payload.path !== 'string' || !payload.path || /[\r\n\0]/.test(payload.path)) throw new Error('Invalid file path');
    const host = payload.host || '__local__';
    const config = host === '__local__' ? null : resolveHost(host, () => {});
    if (host !== '__local__' && !config) throw new Error('SSH host not found');
    const window = new BrowserWindow({width:1000,height:650,minWidth:480,minHeight:300,alwaysOnTop:true,backgroundColor:'#191a1c',title:'Logs',webPreferences:{preload:path.join(__dirname,'logViewerPreload.js'),contextIsolation:true,nodeIntegration:false}});
    const entry = {window,host,file:payload.path,config,id:`logs:${window.id}`,epoch:0,stop:null};
    const senderId=window.webContents.id;
    viewers.set(senderId,entry);
    window.on('closed',()=>{entry.epoch++;entry.stop?.();viewers.delete(senderId);sessionManager.disconnect(entry.id);});
    await window.loadFile(path.join(__dirname,'../../renderer/logViewer.html'));
    return {ok:true};
  });
  ipcMain.handle('logs:read', async (event, {follow=false}={}) => {
    const entry=viewers.get(event.sender.id);
    if(!entry) throw new Error('Log viewer closed');
    const epoch=++entry.epoch;entry.stop?.();entry.stop=null;
    const send=(type,text)=>{if(epoch===entry.epoch && !entry.window.isDestroyed())event.sender.send('logs:output',{type,text});};
    try {
      // A dedicated channel keeps the source terminal and its commands untouched.
      entry.connection ||= sessionManager.connectControl(entry.id,entry.config,'log viewer');
      await entry.connection;
      if(epoch!==entry.epoch){if(entry.window.isDestroyed())await sessionManager.disconnect(entry.id);return;}
      send('reset',`${entry.host} · ${entry.file}`);
      const stop=await sessionManager.streamCommand(entry.id,`exec tail -n 500 ${follow===true?'-F ':''}-- ${quote(entry.file)}`,
        text=>send('data',text),text=>send('error',text),()=>send('end',''));
      if(epoch!==entry.epoch)stop();else entry.stop=stop;
      return {ok:true};
    } catch(error) {entry.connection=null;send('error',error.message);return {ok:false};}
  });
}
module.exports={registerLogViewer};
