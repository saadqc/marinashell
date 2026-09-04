const path = require('path');
const { app, BrowserWindow } = require('electron');

async function run() {
  const window = new BrowserWindow({
    width: 920,
    height: 640,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.webContents.on('console-message', (_event, _level, message) => console.log('[renderer]', message));
  await window.loadFile(path.join(__dirname, 'editor-plugin-test.html'));
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      for (let i = 0; i < 50 && !window.editorPluginActivate; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const activate = window.editorPluginActivate;
      if (!activate) throw new Error('Editor module did not load');
      let viewInfo = null;
      let savedPayload = null;
      const api = {
        invoke: async (channel, payload) => {
          if (channel.endsWith(':read')) {
            if (payload.path.endsWith('.py')) {
              return {
                ok: true,
                content: 'print',
                stat: { size: 5, mtimeMs: 1000, mode: 33188 }
              };
            }
            return {
              ok: true,
              content: 'service:\\r\\n  image: marina:latest\\r\\n  enabled: true\\r\\n',
              stat: { size: 58, mtimeMs: 1000, mode: 33188 }
            };
          }
          savedPayload = payload;
          return { ok: true, stat: { size: payload.content.length, mtimeMs: 2000, mode: 33188 } };
        },
        copyToClipboard: async () => true,
        readClipboard: async () => 'clipboard value'
      };
      activate({
        api,
        openView: () => {},
        registerEditorMode: () => {},
        registerView: (_id, info) => { viewInfo = info; }
      });
      const root = document.getElementById('editor-test-root');
      const cleanup = viewInfo.mount(root, {
        file: { tabId: 'test', path: '/tmp/config.yaml', name: 'config.yaml', sessionType: 'local' },
        setRefresh: () => {}
      });
      const waitFor = async (selector) => {
        for (let i = 0; i < 50; i += 1) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error('Timed out waiting for ' + selector);
      };
      const editor = await waitFor('.cm-editor');
      const statusButtons = Array.from(document.querySelectorAll('.mse-status-button'));
      const before = {
        language: document.querySelector('.mse-status-meta > span').textContent,
        indentation: statusButtons[0].textContent,
        eol: statusButtons[1].textContent,
        suggest: Array.from(document.querySelectorAll('.mse-actions button')).some((item) => item.textContent === 'Suggest'),
        geometry: (() => {
          const workspaceRect = document.querySelector('.mse-workspace').getBoundingClientRect();
          const stageRect = document.querySelector('.mse-stage').getBoundingClientRect();
          const statusRect = document.querySelector('.mse-status').getBoundingClientRect();
          return {
            workspaceBottom: workspaceRect.bottom,
            stageBottom: stageRect.bottom,
            statusTop: statusRect.top,
            statusBottom: statusRect.bottom,
            statusHeight: statusRect.height
          };
        })()
      };

      const rect = editor.getBoundingClientRect();
      editor.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 80,
        clientY: rect.top + 40
      }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      const menu = Array.from(document.querySelectorAll('.mse-menu-item')).map((item) => ({
        label: item.querySelector('.mse-menu-label').textContent,
        disabled: item.disabled
      }));

      statusButtons[1].click();
      const lf = Array.from(document.querySelectorAll('.mse-menu-item')).find((item) => item.textContent.includes('LF'));
      lf.click();
      const save = Array.from(document.querySelectorAll('.mse-actions button')).find((item) => item.textContent === 'Save');
      save.click();
      for (let i = 0; i < 50 && !savedPayload; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      const savedAsLf = savedPayload && !savedPayload.content.includes('\\r\\n');
      await new Promise((resolve) => setTimeout(resolve, 30));

      savedPayload = null;
      statusButtons[1].click();
      const crlf = Array.from(document.querySelectorAll('.mse-menu-item')).find((item) => item.textContent.includes('CRLF'));
      crlf.click();
      save.click();
      for (let i = 0; i < 50 && !savedPayload; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      const savedAsCrlf = savedPayload && savedPayload.content.includes('\\r\\n');
      cleanup();
      root.innerHTML = '';

      const pythonCleanup = viewInfo.mount(root, {
        file: { tabId: 'test', path: '/tmp/check.py', name: 'check.py', sessionType: 'local' },
        setRefresh: () => {}
      });
      await waitFor('.cm-editor');
      const pythonLanguage = document.querySelector('.mse-status-meta > span').textContent;
      const pythonSuggest = Array.from(document.querySelectorAll('.mse-actions button')).find((item) => item.textContent === 'Suggest');
      pythonSuggest.click();
      let completionVisible = false;
      try {
        await waitFor('.cm-tooltip-autocomplete');
        completionVisible = true;
      } catch (err) {}
      pythonCleanup();
      return { before, menu, savedAsLf, savedAsCrlf, pythonLanguage, completionVisible };
    })()
  `, true);
  await window.close();

  const menuLabels = result.menu.map((item) => item.label);
  if (result.before.language !== 'YAML') throw new Error('YAML mode was not detected');
  if (result.before.indentation !== 'Spaces: 2') throw new Error('Indentation was not detected');
  if (result.before.eol !== 'CRLF') throw new Error('CRLF was not detected');
  if (!result.before.suggest) throw new Error('Completion action is missing');
  const geometry = result.before.geometry;
  if (Math.abs(geometry.statusHeight - 27) > 1) throw new Error('Status bar height is not fixed');
  if (Math.abs(geometry.stageBottom - geometry.statusTop) > 1) throw new Error('Editor overlaps the status bar');
  if (geometry.statusBottom > geometry.workspaceBottom + 1) throw new Error('Status bar is outside the workspace');
  for (const label of ['Cut', 'Copy', 'Paste', 'Delete', 'Select all']) {
    if (!menuLabels.includes(label)) throw new Error(`Context action is missing: ${label}`);
  }
  if (result.menu.find((item) => item.label === 'Paste').disabled) throw new Error('Paste did not enable for clipboard text');
  if (!result.savedAsLf || !result.savedAsCrlf) throw new Error('Line-ending conversion failed');
  if (result.pythonLanguage !== 'Python' || !result.completionVisible) throw new Error('Python completion did not open');
  console.log('editor plugin browser test: ok');
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((err) => {
    console.error(err);
    app.exit(1);
  });
