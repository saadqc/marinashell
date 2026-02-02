const fs = require('fs');
const path = require('path');
const { clipboard, dialog } = require('electron');

function pad2(value) {
  return String(value).padStart(2, '0');
}

function buildTimestamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function defaultFileName() {
  return `marinashell-${buildTimestamp()}.png`;
}

async function captureImage(getMainWindow) {
  const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
  if (!win || win.isDestroyed()) {
    throw new Error('Main window is not available');
  }
  return win.webContents.capturePage();
}

module.exports = function (context) {
  const { app, registerIpc, getMainWindow } = context;

  registerIpc('preview', async () => {
    try {
      const image = await captureImage(getMainWindow);
      return { ok: true, dataUrl: image.toDataURL() };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to capture screenshot' };
    }
  });

  registerIpc('copy', async () => {
    try {
      const image = await captureImage(getMainWindow);
      clipboard.writeImage(image);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to copy screenshot' };
    }
  });

  registerIpc('saveDocuments', async () => {
    try {
      const image = await captureImage(getMainWindow);
      const docs = app.getPath('documents');
      const filePath = path.join(docs, defaultFileName());
      fs.writeFileSync(filePath, image.toPNG());
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to save screenshot' };
    }
  });

  registerIpc('saveAs', async () => {
    try {
      const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
      const result = await dialog.showSaveDialog(win || undefined, {
        title: 'Save Screenshot',
        defaultPath: defaultFileName(),
        filters: [{ name: 'PNG Image', extensions: ['png'] }]
      });
      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true };
      }
      const image = await captureImage(getMainWindow);
      fs.writeFileSync(result.filePath, image.toPNG());
      return { ok: true, filePath: result.filePath };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to save screenshot' };
    }
  });
};

