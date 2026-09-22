// Cleanup must use live renderer tabs, even when restoring tabs is disabled.
function registerGroupCleanup(ipcMain, getWindow) {
  ipcMain.handle('workspace:cleanup-groups', async () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) throw new Error('Open the workspace before cleaning up groups.');
    const sender = window.webContents;
    const id = require('crypto').randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        clearTimeout(timer);
        ipcMain.removeListener('workspace:cleanup-groups-response', respond);
        sender.removeListener('destroyed', closed);
        error ? reject(error) : resolve(result);
      };
      const respond = (event, payload) => {
        if (event.sender !== sender || payload?.id !== id) return;
        finish(payload.error ? new Error(payload.error) : null, payload.result);
      };
      const closed = () => finish(new Error('The workspace closed. Please try again.'));
      const timer = setTimeout(() => finish(new Error('Workspace is not ready. Please try again.')), 10000);
      ipcMain.on('workspace:cleanup-groups-response', respond);
      sender.once('destroyed', closed);
      sender.send('workspace:cleanup-groups-request', { id });
    });
  });
}
module.exports = { registerGroupCleanup };
