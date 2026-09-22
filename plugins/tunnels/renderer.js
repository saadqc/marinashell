import { modal, button, confirmAction, showError } from '../../renderer/components/dialog.js';
export default function activate({ api, registerView, registerCommand, dockLayout, state }) {
  async function call(action, payload) { const result = await api.invoke(`plugin:tunnels:${action}`, payload); if (!result.ok) throw new Error(result.error); return result.data; }
  function field(text, el) { const label = document.createElement('label'); label.className = 'project-field'; const span = document.createElement('span'); span.textContent = text; label.append(span, el); return label; }
  function input(value = '') { const el = document.createElement('input'); el.value = value; return el; }
  function edit(refresh, profile = {}) {
    const view = modal(profile.id ? 'Edit tunnel profile' : 'New tunnel profile');
    const name = input(profile.name); const host = document.createElement('select');
    for (const [alias] of state.hostConfigs) if (alias !== '__local__') host.add(new Option(alias, alias));
    if (profile.host && ![...host.options].some(option => option.value === profile.host)) host.add(new Option(`${profile.host} (unavailable)`, profile.host));
    if (profile.host) host.value = profile.host;
    const type = document.createElement('select'); for (const [value, label] of [['local','Local forwarding'],['remote','Remote forwarding'],['dynamic','SOCKS proxy']]) type.add(new Option(label, value)); type.value = profile.type || 'local';
    const source = input(profile.srcPort || ''); source.type = 'number'; source.min = '1'; source.max = '65535';
    const destination = input(profile.dstHost || '127.0.0.1'); const port = input(profile.dstPort || ''); port.type = 'number'; port.min = '1'; port.max = '65535';
    const sourceField = field('Listen port', source), destinationField = field('Destination host', destination), portField = field('Destination port', port);
    const hint = document.createElement('p'); hint.className = 'form-hint';
    const update = () => { const dynamic = type.value === 'dynamic'; destinationField.hidden = portField.hidden = dynamic; hint.textContent = type.value === 'remote' ? 'Listens on the SSH host’s loopback address and forwards to a destination on this computer.' : dynamic ? 'Creates a SOCKS5 proxy on this computer’s loopback address through the SSH host.' : 'Listens on this computer’s loopback address and forwards to a destination reachable from the SSH host.'; };
    type.addEventListener('change', update); update();
    const autoStart = document.createElement('input'); autoStart.type = 'checkbox'; autoStart.checked = Boolean(profile.autoStart);
    const error = document.createElement('p'); error.className = 'form-error'; error.setAttribute('role','alert');
    view.body.append(field('Profile name', name), field('SSH connection', host), field('Type', type), hint, sourceField, destinationField, portField, field('Start when a terminal connects to this host', autoStart), error);
    const save = button('Save profile', async () => { save.disabled = true; try { await call('save', { id: profile.id, name: name.value, host: host.value, type: type.value, autoStart: autoStart.checked, srcPort: source.value, dstHost: destination.value, dstPort: port.value }); view.close(); await refresh(); } catch (err) { error.textContent = err.message; save.disabled = false; } });
    view.footer.append(button('Cancel',view.close,'ghost-btn'),save); name.focus();
  }
  registerView('tunnels', { title: 'Tunnels', iconClass: 'icon-tunnels', icon: 'network', requiresConnection: false, mount(container, { setRefresh }) {
    container.classList.add('tunnel-workspace');
    const header = document.createElement('div'); header.className = 'tunnel-toolbar';
    const title = document.createElement('div'); const heading = document.createElement('h2'); heading.textContent = 'Tunnel profiles'; const subtitle = document.createElement('p'); subtitle.textContent = 'Saved SSH forwarding, independent of your open projects.'; title.append(heading,subtitle);
    const list = document.createElement('div'); list.className = 'tunnel-list';
    let disposed = false, busy = false;
    async function refresh() {
      if (busy || disposed) return;
      busy = true;
      try {
        const profiles = await call('list'); if (disposed) return;
        list.replaceChildren();
        if (!profiles.length) { const empty = document.createElement('p'); empty.className = 'tunnel-empty'; empty.textContent = 'No tunnel profiles yet. Add a profile to forward a port through an SSH connection.'; list.append(empty); }
        for (const profile of profiles) {
          const row = document.createElement('div'); row.className = 'tunnel-profile'; row.dataset.profileId = profile.id;
          const info = document.createElement('div'); const name = document.createElement('strong'); name.textContent = profile.name;
          const detail = document.createElement('small'); detail.textContent = `${profile.host} · ${profile.type} · :${profile.srcPort}${profile.type === 'dynamic' ? ' · SOCKS5' : ` → ${profile.dstHost}:${profile.dstPort}`}`;
          const status = document.createElement('span'); status.className = `tunnel-state ${profile.status}`; status.textContent = profile.error || profile.status;
          info.append(name,detail,status);
          const active = ['active','connecting'].includes(profile.status);
          const toggle = button(active ? 'Stop' : 'Start', async () => { toggle.disabled = true; toggle.textContent = active ? 'Stopping…' : 'Connecting…'; try { await call(active ? 'stop' : 'start',profile.id); } catch (err) { showError(err); } await refresh(); });
          const editButton = button('Edit', () => edit(refresh,profile),'ghost-btn'); editButton.disabled = active;
          const remove = button('Delete', async () => { if (!await confirmAction('Delete tunnel profile?', `Delete “${profile.name}” and stop its forwarding?`, 'Delete')) return; try { await call('remove',profile.id); await refresh(); } catch (err) { showError(err); } },'ghost-btn');
          row.append(info,toggle,editButton,remove); list.append(row);
        }
      } catch (err) { if (!disposed) list.textContent = err.message; } finally { busy = false; }
    }
    header.append(title,button('New profile',() => edit(refresh),'primary-btn')); container.append(header,list);
    setRefresh(refresh); refresh(); const timer = setInterval(refresh,3000);
    return () => { disposed = true; clearInterval(timer); container.classList.remove('tunnel-workspace'); container.replaceChildren(); };
  }});
  const attempted = new Set();
  async function autoStart() {
    try {
      if ((await api.getSettings())?.ui?.connection?.autoStartTunnels?.value === false) return;
      const hosts = new Set([...state.tabs.values()].filter(tab => tab.connected).map(tab => tab.host));
      const profiles = await call('list');
      for (const profile of profiles) {
        if (!hosts.has(profile.host)) { attempted.delete(profile.id); continue; }
        if (profile.autoStart && !attempted.has(profile.id)) { attempted.add(profile.id); call('start',profile.id).catch(showError); }
      }
    } catch (err) { console.warn('Tunnel profiles could not be loaded', err.message); }
  }
  window.addEventListener('marinashell:session-state-changed', autoStart);
  autoStart();
  registerCommand('Manage tunnel profiles', () => dockLayout.mountViewInActive('tunnels'));
}
