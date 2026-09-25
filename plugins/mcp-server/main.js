const path = require("path");
const { pathToFileURL } = require("url");
const { safeStorage } = require("electron");
const { createLibraryStore } = require("../../main/services/libraryStore");
const { createStore } = require("./store");
const { createBroker } = require("./broker");
const { createTools, revision } = require("./tools");
const { createHttpServer } = require("./server");
module.exports = ({
  app,
  getMainWindow,
  getService,
  registerIpc,
  registerShutdown,
  registerActivation,
}) => {
  const store = createStore({ secureStorage: safeStorage });
  const broker = createBroker(getMainWindow);
  const library = createLibraryStore("saved-groups");
  const engine = createTools({
    store,
    broker,
    library,
    getService,
    capture: async (rect) => {
      const window = getMainWindow();
      if (!window || !window.isVisible() || window.isMinimized())
        throw new Error("UI_UNAVAILABLE");
      const image = await window.webContents.capturePage(
        Object.fromEntries(
          Object.entries(rect).map(([key, value]) => [
            key,
            Math.floor(value * window.webContents.getZoomFactor()),
          ]),
        ),
      );
      const scaled =
        image.getSize().width > 1600 ? image.resize({ width: 1600 }) : image;
      const png = scaled.toPNG();
      if (png.length > 2 * 1024 * 1024) throw new Error("Capture exceeds 2 MB");
      return { image: png.toString("base64") };
    },
  });
  const server = createHttpServer({
    store,
    tools: engine,
    onStop: broker.cancel,
  });
  const settingsUrl = pathToFileURL(
    path.resolve(__dirname, "../../settings.html"),
  ).href;
  const current = async () => {
    const live = await broker
      .request("snapshot", {}, AbortSignal.timeout(1500))
      .catch(() => ({ projects: [] }));
    // Project linkage is freshest in the live workspace (window state and
    // broker snapshot); the saved-project library can lag behind when
    // configurations were linked after the project was saved.
    const stateStore = require("../../main/services/stateStore");
    const liveGroups = new Map();
    for (const g of [
      ...(stateStore.loadState().tabGroups || []),
      ...live.projects,
    ]) {
      if (g && g.id)
        liveGroups.set(g.id, {
          name: g.name || "",
          configurationIds: [...(g.configurationIds || [])],
          savedGroupId: g.savedGroupId || "",
        });
    }
    const projects = library.read().map((l) => {
      const counterpart = [...liveGroups.values()].find(
        (g) => g.savedGroupId === l.id,
      );
      return {
        id: l.id,
        name: l.name,
        configurationIds: counterpart
          ? counterpart.configurationIds
          : l.configurationIds || [],
      };
    });
    for (const [id, g] of liveGroups) {
      if (!g.savedGroupId)
        projects.push({
          id,
          name: `${g.name} (open)`,
          configurationIds: g.configurationIds,
        });
    }
    return {
      ok: true,
      ...server.status(),
      settings: store.publicState(),
      tools: engine.names,
      activity: store.activity(),
      projects,
      configurations: (getService("runs")?.manager.configs.read() || []).map(
        (c) => ({ id: c.id, name: c.name }),
      ),
      hosts: require("../../main/services/sshConfig").listConfigHosts() || [],
    };
  };
  function ipc(name, handler) {
    registerIpc(name, async (event, args = {}) => {
      try {
        // Section links add a fragment without changing the Settings document.
        const senderUrl = new URL(event.sender.getURL());
        senderUrl.hash = '';
        if (senderUrl.href !== settingsUrl || event.senderFrame !== event.sender.mainFrame)
          throw new Error("Settings access only");
        return await handler(args);
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
  }
  ipc("status", current);
  ipc("start", async () => {
    store.update({ desiredRunning: true });
    await server.start();
    return current();
  });
  ipc("stop", async () => {
    store.update({ desiredRunning: false });
    await server.stop();
    return current();
  });
  ipc("settings", async (patch) => {
    if (
      !["stopped", "error"].includes(server.status().state) &&
      patch.port !== undefined &&
      patch.port !== store.data.port
    )
      throw new Error("Stop the server before changing its port.");
    store.update({ port: patch.port, restore: patch.restore });
    return current();
  });
  ipc("pair", ({ name, password }) => ({ ok: true, ...store.add(name, password) }));
  ipc("password", ({ id, password }) => {
    store.setPassword(id, password);
    broker.cancel();
    return current();
  });
  ipc("rotate", ({ id }) => {
    const result = store.rotate(id);
    broker.cancel();
    return { ok: true, ...result };
  });
  ipc("revoke", ({ id }) => {
    store.revoke(id);
    broker.cancel();
    return current();
  });
  ipc("policy", ({ id, tools, scope }) => {
    const revisions = Object.fromEntries(
      (getService("runs")?.manager.configs.read() || [])
        .filter(
          (c) =>
            scope.configurations.includes("*") ||
            scope.configurations.includes(c.id),
        )
        .map((c) => [c.id, revision(c)]),
    );
    store.policy(id, tools, scope, engine.names, revisions);
    broker.cancel();
    return current();
  });
  registerActivation(async (enabled) => {
    if (!enabled) await server.stop();
    else if (store.data.restore && store.data.desiredRunning)
      await server.start();
  });
  registerShutdown(async () => {
    await server.stop();
    broker.dispose();
  });
  if (store.data.restore && store.data.desiredRunning) server.start();
};
