import { modal, button, showError } from '../components/dialog.js';

export function createExternalEditors(state, persistence) {
  async function request(channel, payload) {
    const result = await state.api.invoke(`external-editors:${channel}`, payload);
    if (!result?.ok) throw Object.assign(new Error(result?.error || 'External editors are unavailable.'), result);
    return result;
  }

  async function populateSelect(select, preferred = '') {
    select.replaceChildren(new Option('Use global default', ''));
    if (preferred) { select.add(new Option(preferred, preferred)); select.value = preferred; }
    try {
      const { editors, defaultEditorId } = await request('list');
      select.replaceChildren(new Option(`Use global default${defaultEditorId ? ` (${editors.find(editor => editor.id === defaultEditorId)?.name || defaultEditorId})` : ''}`, ''));
      for (const editor of editors) select.add(new Option(editor.name, editor.id));
      select.value = preferred;
    } catch { select.title = 'Editor detection is unavailable. Open Settings to try again.'; }
  }

  async function open(source, name, preferred = '') {
    const view = modal(`Open ${name || 'project'} in editor`);
    view.dialog.classList.add('external-editor-picker');
    const hint = document.createElement('p'); hint.className = 'form-hint';
    hint.textContent = 'Open configured folders together in one workspace. Islet also supports SSH folders.';
    const list = document.createElement('div'); list.className = 'external-editor-options';
    const status = document.createElement('p'); status.className = 'form-hint'; status.setAttribute('role', 'status');
    view.body.append(hint, list, status);
    const settings = async () => { view.close(); try { await request('settings'); } catch (error) { showError(error); } };
    view.footer.append(button('Editor settings', settings, 'ghost-btn'), button('Cancel', view.close, 'ghost-btn'));

    async function attempt(editor, useExistingWorkspace = false) {
      view.dialog.querySelectorAll('button').forEach(element => { element.disabled = true; });
      status.textContent = `Opening ${editor.name}…`;
      try {
        const result = await request('open', { ...source, editorId: editor.id, useExistingWorkspace });
        view.close();
        persistence.setStatus(result.usedExisting ? `Sent the existing workspace to ${result.editorName}` : `Sent ${name || 'project'} to ${result.editorName} · ${result.folderCount} ${result.folderCount === 1 ? 'folder' : 'folders'}`);
      } catch (error) {
        status.textContent = '';
        const missing = ['EDITOR_MISSING', 'INVALID_EDITOR_PATH'].includes(error.code);
        const failure = modal(missing ? `${editor.name} ${error.code === 'EDITOR_MISSING' ? 'not found' : 'path unavailable'}` : 'Unable to open project');
        failure.dialog.classList.add('external-editor-error');
        const message = document.createElement('p'); message.textContent = error.message; failure.body.append(message);
        if (error.folders?.length) {
          const folders = document.createElement('ul');
          for (const text of error.folders) { const item = document.createElement('li'); item.textContent = text; folders.append(item); }
          failure.body.append(folders);
        }
        if (missing) failure.footer.append(button('Open editor settings', () => { failure.close(); settings(); }), button('Detect again', async () => { failure.close(); await load(true); }, 'ghost-btn'));
        if (['MISSING_FOLDERS', 'NO_FOLDERS', 'REMOTE_UNSUPPORTED'].includes(error.code)) failure.footer.append(button('Edit project', () => {
          failure.close(); view.close(); window.dispatchEvent(new CustomEvent('marinashell:edit-project', { detail: source }));
        }));
        if (['MISSING_FOLDERS', 'LAUNCH_FAILED'].includes(error.code)) failure.footer.append(button('Try again', () => { failure.close(); attempt(editor); }, 'ghost-btn'));
        if (error.canUseExisting) failure.footer.append(button('Open existing workspace', () => { failure.close(); attempt(editor, true); }));
        failure.footer.append(button('Cancel', failure.close, 'ghost-btn'));
      } finally { view.dialog.querySelectorAll('button').forEach(element => { element.disabled = false; }); }
    }

    async function load(refresh = false) {
      status.textContent = 'Detecting editors…';
      try {
        const { editors, defaultEditorId } = await request('list', { refresh });
        if (!view.dialog.isConnected) return;
        list.replaceChildren();
        for (const editor of editors) {
          const row = button('', () => attempt(editor), 'external-editor-option'); row.dataset.editorId = editor.id;
          const title = document.createElement('strong'); title.textContent = editor.name;
          const detail = document.createElement('small');
          const chosen = editor.id === (preferred || defaultEditorId);
          detail.textContent = `${chosen ? 'Default · ' : ''}${editor.status === 'available' ? `${editor.override ? 'Custom path' : 'Detected'}${editor.version ? ` · ${editor.version}` : ''}` : editor.status === 'invalid-path' ? 'Configured path unavailable' : 'Not installed'}`;
          row.append(title, detail); row.title = editor.family === 'jetbrains' ? 'Opens a grouped IDE project. Window placement follows your IDE settings.' : `Open in ${editor.name}`;
          row.classList.toggle('preferred', chosen); list.append(row);
        }
        status.textContent = '';
      } catch (error) { status.textContent = error.message; }
    }
    await load();
  }

  async function openGroup(groupId) {
    try {
      if (await persistence.persistTabs() === false) throw new Error('The current project could not be saved. Try again before opening it in an editor.');
      const group = state.appState.tabGroups.find(item => item.id === groupId);
      if (!group) throw new Error('This group is no longer open.');
      let preferred = group.externalEditor?.preferredEditorId || '';
      if (group.savedGroupId) {
        const saved = (await state.api.invoke('groups:list')).find(item => item.id === group.savedGroupId);
        preferred = saved?.externalEditor?.preferredEditorId || preferred;
      }
      await open({ projectId: groupId }, group.name, preferred);
    } catch (error) { showError(error); }
  }
  return { openGroup, populateSelect, openSaved: project => open({ savedProjectId: project.id }, project.name, project.externalEditor?.preferredEditorId || '') };
}
