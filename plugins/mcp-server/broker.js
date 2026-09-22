const { ipcMain } = require("electron");
const { randomUUID } = require("crypto");
function createBroker(getWindow) {
  const pending = new Map();
  const reply = (event, result) => {
    const item = pending.get(result?.id);
    if (!item || event.sender !== item.sender) return;
    item.finish(result.error ? new Error(result.error) : null, result.value);
  };
  ipcMain.on("mcp:response", reply);
  function request(action, args = {}, signal) {
    return new Promise((resolve, reject) => {
      const window = getWindow();
      const sender = window?.webContents;
      if (
        !sender ||
        sender.isDestroyed() ||
        sender.isLoadingMainFrame() ||
        signal?.aborted
      )
        return reject(new Error("UI_UNAVAILABLE"));
      const id = randomUUID();
      const abort = () => finish(new Error("TIMEOUT_OR_CANCELLED"));
      const navigation = (_event, _url, _inPlace, mainFrame) => {
        if (mainFrame) finish(new Error("UI_UNAVAILABLE"));
      };
      const timer = setTimeout(abort, action === "approve" ? 55000 : 30000);
      function finish(error, value) {
        if (!pending.delete(id)) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        sender.removeListener("did-start-navigation", navigation);
        if (error && !sender.isDestroyed()) sender.send("mcp:cancel", { id });
        error ? reject(error) : resolve(value);
      }
      pending.set(id, { sender, finish });
      signal?.addEventListener("abort", abort, { once: true });
      sender.on("did-start-navigation", navigation);
      sender.send("mcp:request", { id, action, args });
    });
  }
  function cancel() {
    for (const item of [...pending.values()])
      item.finish(new Error("SERVER_STOPPED"));
  }
  return {
    request,
    cancel,
    dispose() {
      cancel();
      ipcMain.removeListener("mcp:response", reply);
    },
  };
}
module.exports = { createBroker };
