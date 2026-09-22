const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('logs',{
  read:follow=>ipcRenderer.invoke('logs:read',{follow}),
  onOutput:handler=>ipcRenderer.on('logs:output',(_event,payload)=>handler(payload))
});
