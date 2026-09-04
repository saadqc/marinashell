import { getActiveTab } from '../state.js';
import {
  buildSftpUri,
  escapeShellPath,
  fillTemplate,
  getPathLabel,
  matchAssociation,
  normalizeFileInput,
  normalizeRemotePath,
  formatRemotePath
} from '../utils.js';
import { LARGE_FILE_BYTES } from '../constants.js';

export function createEditorService(state, settingsService, actionsPanel, persistenceService, editorModes = new Map()) {
  function getCurrentHostContext(fileInfo) {
    const tab = getActiveTab(state);
    const pathStyle = tab ? tab.remotePathStyle : 'posix';
    const hostKey = tab ? tab.host : '';
    const config = state.hostConfigs.get(hostKey) || {};
    const host = config.hostName || config.alias || hostKey;
    const user = config.user || '';
    const port = config.port || '22';
    const normalized = normalizeRemotePath(fileInfo.path, tab ? tab.currentPath : '/', { pathStyle });
    const escapedPath = escapeShellPath(normalized);
    const shellPath = formatRemotePath(normalized, pathStyle);
    const escapedShellPath = escapeShellPath(shellPath);
    const name = fileInfo.name || getPathLabel(normalized, pathStyle);
    const extIndex = name.lastIndexOf('.');
    const ext = extIndex > 0 ? name.slice(extIndex + 1) : '';
    return {
      path: normalized,
      escapedPath,
      shellPath,
      escapedShellPath,
      pathStyle,
      host,
      alias: hostKey,
      user,
      port,
      name,
      ext
    };
  }

  async function openFile(fileInput) {
    const tab = getActiveTab(state);
    if (!tab || !tab.connected || !state.api) {
      persistenceService.setStatus('Not connected', true, tab);
      return;
    }
    const fileInfo = normalizeFileInput(fileInput);
    if (!fileInfo.path) {
      return;
    }
    const editor = settingsService.getEditorSettings();
    const association = matchAssociation(fileInfo.name, editor.associations);
    const mode = association && association.mode ? association.mode : editor.mode;
    const commandTemplate = association && association.commandTemplate
      ? association.commandTemplate
      : editor.commandTemplate;
    const localCommandTemplate = association && association.localCommandTemplate
      ? association.localCommandTemplate
      : editor.localCommandTemplate;
    const sftpUriTemplate = association && association.sftpUriTemplate
      ? association.sftpUriTemplate
      : editor.sftpUriTemplate;
    const context = getCurrentHostContext(fileInfo);

    if (fileInfo.size && fileInfo.size > LARGE_FILE_BYTES) {
      const sizeMb = (fileInfo.size / (1024 * 1024)).toFixed(2);
      const proceed = window.confirm(`This file is ${sizeMb} MB. Continue opening?`);
      if (!proceed) {
        return;
      }
    }

    const customEditor = editorModes.get(mode);
    if (typeof customEditor === 'function') {
      try {
        await customEditor({ tab, fileInfo, context, mode });
      } catch (err) {
        const message = err && err.message ? err.message : 'Editor failed to open the file';
        persistenceService.setStatus(message, true, tab);
      }
      return;
    }

    if (mode === 'inline-editor') {
      persistenceService.setStatus('Enable the CodeMirror Editor plugin in Settings to use the inline editor', true, tab);
      return;
    }

    if (mode === 'local-download') {
      const id = `open-${Date.now()}`;
      actionsPanel.createTransferRow(id, `Open ${getPathLabel(context.path, context.pathStyle)}`);
      const result = await state.api.download(tab.id, { remotePath: context.path, open: true, id });
      if (result && result.ok) {
        actionsPanel.markTransferComplete(id, 'opened');
      } else {
        actionsPanel.markTransferComplete(id, 'error');
      }
      return;
    }

    if (mode === 'sftp-uri') {
      const uri = buildSftpUri(sftpUriTemplate, context);
      await state.api.openExternal(uri);
      return;
    }

    if (mode === 'local-command') {
      const command = fillTemplate(localCommandTemplate, {
        ...context,
        sftpUri: buildSftpUri(sftpUriTemplate, context)
      });
      await state.api.execLocal(command);
      return;
    }

    const shellContext = {
      ...context,
      path: context.shellPath || context.path,
      escapedPath: context.escapedShellPath || context.escapedPath
    };
    const command = fillTemplate(commandTemplate, shellContext);
    tab.isBusy = true;
    state.api.write(tab.id, `${command}\n`);
  }

  return {
    openFile
  };
}
