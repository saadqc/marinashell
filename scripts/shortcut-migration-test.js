const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'shortcut-migration-'));
const original=os.homedir;os.homedir=()=>root;
const {loadSettings,settingsPath}=require('../main/services/settingsStore');
try {
 fs.mkdirSync(path.dirname(settingsPath()),{recursive:true});
 for(const [value,expected] of [['mod+t','mod+alt+t'],['ctrl+n','ctrl+n'],['','']]) {
  fs.writeFileSync(settingsPath(),JSON.stringify({ui:{shortcuts:{newTab:{type:'string',value}}}}));
  const shortcuts=loadSettings().ui.shortcuts;
  assert.equal(shortcuts.newTab.value,expected);assert.equal(shortcuts.selectEditor.value,'mod+e');assert.equal(shortcuts.selectTerminal.value,'mod+t');
 }
 fs.writeFileSync(settingsPath(),JSON.stringify({ui:{shortcuts:{newTab:{value:'mod+t'},selectTerminal:{value:'mod+shift+t'}}}}));
 assert.equal(loadSettings().ui.shortcuts.newTab.value,'mod+t');
 console.log('PASS: previous default migrates, custom/disabled bindings preserved, new defaults available');
} finally {os.homedir=original;fs.rmSync(root,{recursive:true,force:true});}
