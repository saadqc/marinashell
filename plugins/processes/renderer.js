import { modal, button, confirmAction } from '../../renderer/components/dialog.js';
import { withRates, filterAndSort } from './model.mjs';
const bytes = value => value == null ? '—' : value >= 1073741824 ? `${(value/1073741824).toFixed(1)} GB` : value >= 1048576 ? `${(value/1048576).toFixed(1)} MB` : `${(value/1024).toFixed(1)} KB`;
export default function activate({ api, state, registerCommand }) {
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./style.css', import.meta.url).href; document.head.append(css);
  let opened = false;
  registerCommand('Show Process List', () => {
    if (opened) return;
    opened = true;
    const view = modal('Processes', {wide:true}); view.dialog.classList.add('process-dialog');
    const controls = document.createElement('div'); controls.className = 'process-controls';
    const host = document.createElement('select'); host.setAttribute('aria-label','Process host'); host.add(new Option('Local machine','__local__'));
    for (const [alias] of state.hostConfigs) if (alias !== '__local__') host.add(new Option(alias,alias));
    const active = state.tabs.get(state.activeTabId)?.host; if ([...host.options].some(option=>option.value===active)) host.value = active;
    const name = document.createElement('input'); name.placeholder = 'Filter name, user or PID…'; name.setAttribute('aria-label','Filter processes by name');
    const port = document.createElement('input'); port.type='number'; port.min='1'; port.max='65535'; port.placeholder='Port'; port.setAttribute('aria-label','Filter processes by port');
    const liveLabel = document.createElement('label'); const live = document.createElement('input'); live.type='checkbox'; live.checked=true; liveLabel.append(live,document.createTextNode('Live'));
    const refresh = button('Refresh',()=>sample());
    controls.append(host,name,port,liveLabel,refresh);
    const status = document.createElement('div'); status.className='process-status'; status.setAttribute('role','status');
    const wrap = document.createElement('div'); wrap.className='process-table-wrap';
    const table = document.createElement('table'); const head=document.createElement('thead'), header=document.createElement('tr'), body=document.createElement('tbody');
    const columns=[['name','Process'],['pid','PID'],['user','User'],['cpuPercent','CPU %'],['ramBytes','RAM'],['readRate','Read/s'],['writeRate','Write/s'],['readBytes','Disk read'],['writeBytes','Disk written'],['ports','Ports']];
    let rows=[], previous=null, sort='ramBytes', direction=-1, disposed=false, generation=0, inFlight=false;
    const stopping = new Set(), busy = new Set();
    const processKey = row => JSON.stringify([host.value,row.pid,row.identity]);
    async function stopProcess(row) {
      const key=processKey(row), targetHost=host.value;
      if(busy.has(key))return;
      busy.add(key);draw();
      try {
        const force=stopping.has(key);
        if(force && !await confirmAction('Force stop process?', `${row.name} (PID ${row.pid}) has already received a stop request. Force stop it now?`, 'Force stop'))return;
        if(disposed || targetHost!==host.value)return;
        const result=await api.invoke('plugin:processes:stop',{host:targetHost,pid:row.pid,identity:row.identity,force});
        if(!result.ok)throw new Error(result.error);
        stopping.add(key);
        if(!disposed && targetHost===host.value) {
          status.textContent=result.exited?'Process has already exited.':force?'Force stop sent.':'Stop requested. Click Kill again if the process does not exit.';
          await sample();
        }
      } catch(error) { if(!disposed && targetHost===host.value)status.textContent=error.message; }
      finally {busy.delete(key);draw();}
    }
    const headings=[];
    function draw() {
      if (disposed) return;
      const filtered=filterAndSort(rows,name.value,port.value,sort,direction);
      body.replaceChildren();
      for (const row of filtered) {
        const tr=document.createElement('tr');
        for (const [key] of columns) { const td=document.createElement('td'); td.textContent=key==='ports' ? row.ports.join(', ') || '—' : key==='cpuPercent' ? row.cpuPercent.toFixed(1) : ['ramBytes','readRate','writeRate','readBytes','writeBytes'].includes(key) ? bytes(row[key]) : row[key]; if(key==='name') td.title=row.name; tr.append(td); }
        const action=document.createElement('td');action.className='process-action';
        const key=processKey(row), kill=button(busy.has(key)?'Stopping…':'Kill',()=>stopProcess(row),'danger');
        kill.disabled=busy.has(key) || !row.identity || row.pid<=1;
        kill.title=!row.identity?'Process identity unavailable':stopping.has(key)?'Stop requested. Click again to force stop.':'Request process stop';
        kill.setAttribute('aria-label',`Kill ${row.name} (PID ${row.pid})`);
        action.append(kill);tr.append(action);body.append(tr);
      }
      if (!filtered.length) { const row=document.createElement('tr'), cell=document.createElement('td'); cell.colSpan=columns.length+1; cell.textContent=inFlight?'Loading processes…':'No matching processes.'; row.append(cell); body.append(row); }
      for(const {th,key,label,control} of headings) {th.setAttribute('aria-sort',key===sort?(direction===-1?'descending':'ascending'):'none');control.textContent=label+(key===sort?(direction===-1?' ↓':' ↑'):'');}
      count.textContent=`${filtered.length} of ${rows.length} processes`;
    }
    for(const [key,label] of columns) { const th=document.createElement('th'); const control=button(label,()=>{if(key==='ports')return;direction=sort===key?-direction:-1;sort=key;draw();}); if(key==='ports')control.disabled=true; th.append(control);header.append(th);headings.push({th,key,label,control}); }
    const actionHeader=document.createElement('th');actionHeader.textContent='Action';header.append(actionHeader);
    head.append(header);table.append(head,body);wrap.append(table);
    const note=document.createElement('p');note.className='process-note';
    const count=document.createElement('span');count.className='process-count';
    view.body.append(controls,status,wrap,note);view.footer.append(count,button('Close',view.close));
    async function sample() {
      if(disposed || inFlight)return;
      inFlight=true;refresh.disabled=true;const requestedHost=host.value, version=generation;status.textContent=rows.length?'Updating…':'Loading processes…';draw();
      try {
        const result=await api.invoke('plugin:processes:list',{host:requestedHost});
        if(disposed || version!==generation)return;
        if(!result.ok)throw new Error(result.error);
        rows=withRates(result,previous);previous=result;note.textContent=(result.notes||[]).join(' ');status.textContent=`${result.platform} · Updated ${new Date(result.sampledAt*1000).toLocaleTimeString()}`;
      } catch(error) {if(!disposed && version===generation)status.textContent=`${error.message}${rows.length?' Showing the last successful sample.':''}`;}
      finally {inFlight=false;refresh.disabled=false;draw();if(!disposed && version!==generation)sample();}
    }
    host.addEventListener('change',()=>{generation++;rows=[];previous=null;note.textContent='';draw();sample();});
    name.addEventListener('input',draw);port.addEventListener('input',draw);
    const timer=setInterval(()=>{if(live.checked)sample();},3000);
    view.dialog.addEventListener('close',()=>{disposed=true;opened=false;generation++;clearInterval(timer);},{once:true});
    sample();name.focus();
  });
}
