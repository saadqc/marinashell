const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert/strict");
const net = require("net");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "marina-mcp-app-"));
os.homedir = () => root;
app.setPath("userData", root);
const testApp = process.env.MARINASHELL_TEST_APP;
if (testApp) app.setAppPath(testApp);
require(testApp ? path.join(testApp, "main/app.js") : "../main/app");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let settings;
let main;
let client;
let run;
const invoke = (name, args) =>
  settings.webContents.executeJavaScript(
    `window.api.invoke(${JSON.stringify(`plugin:mcp-server:${name}`)},${JSON.stringify(args || {})})`,
  );
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert(!result.isError, `${name}: ${result.content[0].text}`);
  return result.structuredContent || JSON.parse(result.content[0].text);
}
app
  .whenReady()
  .then(async () => {
    for (let i = 0; i < 100; i++) {
      main = BrowserWindow.getAllWindows()[0];
      if (main && !main.webContents.isLoading()) break;
      await pause(50);
    }
    await pause(500);
    const reloaded = new Promise(resolve => main.webContents.once("did-finish-load", resolve));
    await main.webContents.executeJavaScript(
      `window.api.updateSettings({plugins:{enabled:{list:{value:['run-configurations']}}}})`,
    );
    await reloaded;
    await pause(300);
    await main.webContents.executeJavaScript("window.api.openSettings()");
    for (let i = 0; i < 100; i++) {
      settings = BrowserWindow.getAllWindows().find((w) => w !== main);
      if (settings && !settings.webContents.isLoading()) break;
      await pause(50);
    }
    await pause(300);
    assert.equal(
      await settings.webContents.executeJavaScript(
        'Boolean(document.querySelector("#mcp-guide details"))',
      ),
      true,
      await settings.webContents.executeJavaScript(
        'document.querySelector("#mcp-error")?.textContent',
      ),
    );
    let mcpReloads=0;main.webContents.on("did-start-loading",()=>mcpReloads++);
    await settings.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('#mcp-controls button')).find(b=>b.textContent==='Enable MCP extension').click()`,
    );
    await pause(650);
    const status = await invoke("status");
    assert(status.ok, status.error);
    assert.equal(status.state, "stopped");
    const denied = await main.webContents.executeJavaScript(
      "window.api.invoke('plugin:mcp-server:start')",
    );
    assert.equal(denied.ok, false);
    const socket = net.createServer();
    await new Promise((r) => socket.listen(0, "127.0.0.1", r));
    const port = socket.address().port;
    await new Promise((r) => socket.close(r));
    assert((await invoke("settings", { port, restore: true })).ok);
    const pair = await invoke("pair", { name: "Integration test" });
    assert(pair.ok, pair.error);
    const persisted = fs.readFileSync(
      path.join(root, ".marinashell", "mcp-settings.json"),
      "utf8",
    );
    assert(!persisted.includes(pair.token), "Token must be encrypted");
    const scope = {
      projects: ["*"],
      hosts: ["__local__"],
      configurations: ["*"],
      scratchpad: true,
    };
    const permissions = Object.fromEntries(
      status.tools.map((n) => [n, "allow"]),
    );
    assert(
      (await invoke("policy", { id: pair.id, tools: permissions, scope })).ok,
    );
    const started = await invoke("start");
    assert.equal(started.state, "running", started.error);
    client = new Client({ name: "integration", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(started.url), {
        requestInit: { headers: { Authorization: `Bearer ${pair.token}` } },
      }),
    );
    assert(
      (await client.listTools()).tools.some(
        (t) => t.name === "configurations.run",
      ),
    );
    const project = await call("projects.create", {
      name: "MCP test",
      tabs: [
        { host: "__local__", currentPath: root, manualTitle: "Backend" },
        { host: "__local__", currentPath: root, manualTitle: "Docs" },
      ],
      layout: "2x1",
      requestId: "project-create",
    });
    const opened = await call("projects.open", {
      savedProjectId: project.id,
      expectedRevision: project.revision,
      requestId: "project-open",
    });
    const layout = await call("layout.get", { projectId: opened.id });
    assert.equal(layout.layout, "2x1");
    await call("layout.set", {
      projectId: opened.id,
      layout: "2x2",
      expectedRevision: layout.revision,
      requestId: "layout-set",
    });
    assert.equal(
      (await call("layout.get", { projectId: opened.id })).layout,
      "2x2",
    );
    const terminals = await call("terminals.list");
    assert.equal(
      terminals.items.filter((t) => t.projectId === opened.id).length,
      2,
    );
    await pause(400);
    await call("terminals.read", {
      terminalId: terminals.items.find((t) => t.projectId === opened.id).id,
    });
    main.show();
    main.focus();
    await main.webContents.executeJavaScript(
      `document.querySelector('[data-project-id="${opened.id}"]').click()`,
    );
    await pause(400);
    const target = terminals.items.find((t) => t.projectId === opened.id);
    const shot = await client.callTool({
      name: "screenshots.capture",
      arguments: { terminalId: target.id },
    });
    assert(!shot.isError, shot.content[0].text);
    assert.equal(shot.content[0].type, "image");
    assert(
      Buffer.from(shot.content[0].data, "base64")
        .subarray(1, 4)
        .equals(Buffer.from("PNG")),
    );
    await main.webContents.executeJavaScript(
      `const dialog=document.createElement('dialog');dialog.id='mcp-shot-test';document.body.append(dialog);dialog.showModal();`,
    );
    const blockedShot = await client.callTool({
      name: "screenshots.capture",
      arguments: { terminalId: target.id },
    });
    assert.equal(blockedShot.isError, true);
    await main.webContents.executeJavaScript(
      `document.querySelector('#mcp-shot-test').remove()`,
    );
    const config = await call("configurations.create", {
      configuration: {
        name: "MCP smoke",
        host: "__local__",
        type: "shell",
        mode: "commands",
        target: "printf 'mcp-smoke\\n'; sleep 30",
        cwd: root,
        interpreter: "/bin/bash",
      },
      requestId: "config-create",
    });
    let conflict = await client.callTool({
      name: "configurations.run",
      arguments: {
        configurationId: config.id,
        projectId: opened.id,
        expectedRevision: config.revision,
        requestId: "run-stale",
      },
    });
    assert.equal(conflict.isError, true);
    await invoke("policy", { id: pair.id, tools: permissions, scope });
    run = await call("configurations.run", {
      configurationId: config.id,
      projectId: opened.id,
      expectedRevision: config.revision,
      requestId: "run-start",
    });
    await pause(500);
    assert.equal(
      await main.webContents.executeJavaScript(
        `Boolean(document.querySelector('.running-configuration[data-run-id="${run.id}"]'))`,
      ),
      true,
      "Agent-started run must appear in the sidebar",
    );
    const output = await call("runs.read", { runId: run.id });
    assert(output.output.includes("mcp-smoke"));
    await call("configurations.stop", {
      runId: run.id,
      expectedRevision: run.revision,
      force: true,
      requestId: "run-stop",
    });
    for (let i = 0; i < 30; i++) {
      const runs = await call("runs.list");
      if (
        ["exited", "failed"].includes(
          runs.items.find((r) => r.id === run.id)?.status,
        )
      )
        break;
      await pause(200);
    }
    run = await call("configurations.restart", {
      runId: run.id,
      expectedRevision: config.revision,
      requestId: "run-restart",
    });
    await call("configurations.stop", {
      runId: run.id,
      expectedRevision: run.revision,
      force: true,
      requestId: "restarted-stop",
    });
    for (let i = 0; i < 30; i++) {
      const runs = await call("runs.list");
      if (
        ["exited", "failed"].includes(
          runs.items.find((r) => r.id === run.id)?.status,
        )
      )
        break;
      await pause(200);
    }
    const updated = (await call("projects.list")).items.find(
      (p) => !p.saved && p.id === opened.id,
    );
    await call("projects.close", {
      projectId: opened.id,
      expectedRevision: updated.revision,
      requestId: "project-close",
    });
    await call("projects.remove", {
      savedProjectId: project.id,
      expectedRevision: project.revision,
      requestId: "project-remove",
    });
    // Ask is a real local dialog; declining must keep the terminal count unchanged.
    await invoke("policy", {
      id: pair.id,
      tools: { ...permissions, "terminals.create": "ask" },
      scope,
    });
    const pending = client.callTool({
      name: "terminals.create",
      arguments: {
        host: "__local__",
        directory: root,
        title: "Denied",
        requestId: "denied",
      },
    });
    for (let i = 0; i < 100; i++) {
      if (
        await main.webContents.executeJavaScript(
          'Boolean(document.querySelector("dialog[open]"))',
        )
      )
        break;
      await pause(30);
    }
    await main.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent==='Deny').click()`,
    );
    assert.equal((await pending).isError, true);
    // Rotation invalidates existing bearer credentials immediately.
    await invoke("rotate", { id: pair.id });
    await assert.rejects(() => client.listTools());
    await client.close();
    await main.webContents.executeJavaScript(
      `(async()=>{const s=await window.api.getSettings();s.plugins.disabled.list.value=['mcp-server'];return window.api.updateSettings(s);})()`,
    );
    await pause(200);
    await assert.rejects(() => fetch(started.url));
    await main.webContents.executeJavaScript(
      `(async()=>{const s=await window.api.getSettings();s.plugins.disabled.list.value=[];return window.api.updateSettings(s);})()`,
    );
    await pause(200);
    assert.equal((await invoke("status")).state, "running");
    await invoke("stop");
    assert.equal((await invoke("status")).settings.desiredRunning, false);
    assert.equal(mcpReloads,0,"MCP toggles must preserve live terminals without reloading");
    fs.mkdirSync(path.join(__dirname, "../design/validation"), {
      recursive: true,
    });
    settings.show();
    settings.focus();
    await pause(250);
    await settings.webContents.executeJavaScript(
      "document.querySelector('#preferences-mcp').scrollIntoView()",
    );
    await pause(500);
    fs.writeFileSync(
      path.join(__dirname, "../design/validation/mcp-settings.png"),
      (await settings.webContents.capturePage()).toPNG(),
    );
    console.log(
      "PASS MCP Electron: encrypted pairing, Settings-only controls, real SDK project restore/layout/read, shared run launch/output/stop, approval dialog, rotation, disable/re-enable and saved state",
    );
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (settings && !settings.isDestroyed())
      await invoke("stop").catch(() => {});
    if (run && main && !main.isDestroyed())
      await main.webContents
        .executeJavaScript(
          `window.api.invoke('plugin:run-configurations:stop',{id:${JSON.stringify(run.id)},force:true})`,
        )
        .catch(() => {});
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  });
