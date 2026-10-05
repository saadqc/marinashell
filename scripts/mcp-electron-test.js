const { app, BrowserWindow, clipboard } = require("electron");
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
async function uiWait(expression, description) {
  for (let i = 0; i < 100; i++) {
    if (await settings.webContents.executeJavaScript(expression)) return;
    await pause(50);
  }
  throw new Error(`Settings UI timed out: ${description}`);
}
async function clickSettings(selector) {
  const rect = await settings.webContents.executeJavaScript(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target || target.disabled) return null;
    target.scrollIntoView({block: 'center', inline: 'nearest'});
    const r = target.getBoundingClientRect();
    return r.width && r.height ? {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)} : null;
  })()`);
  assert(rect, `Missing or hidden pointer target: ${selector}`);
  settings.webContents.sendInputEvent({type: 'mouseDown', button: 'left', clickCount: 1, ...rect});
  settings.webContents.sendInputEvent({type: 'mouseUp', button: 'left', clickCount: 1, ...rect});
  await pause(80);
}
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
    await settings.webContents.executeJavaScript(`document.querySelector('a[href="#preferences-mcp"]').click()`);
    assert(settings.webContents.getURL().endsWith('#preferences-mcp'));
    let mcpReloads=0;main.webContents.on("did-start-loading",()=>mcpReloads++);
    await settings.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('#mcp-controls button')).find(b=>b.textContent==='Enable agent access').click()`,
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
    // Exercise the public UI with native pointer clicks, including credentials
    // copied after reopening Settings, rather than only invoking the IPC API.
    await uiWait("Boolean(document.querySelector('.mcp-create-form'))", "creation form");
    await clickSettings('.mcp-create-form button');
    assert.equal((await invoke("status")).settings.clients.length, 0, "Empty names must not create agents");
    await settings.webContents.executeJavaScript(`document.querySelector('.mcp-create-form input[type=text]').value = 'UI agent'`);
    await clickSettings('.mcp-create-form button');
    await uiWait("Boolean(document.querySelector('.mcp-agent-table tr[data-agent-id]'))", "created agent row");
    let uiAgent = (await invoke("status")).settings.clients.find(c => c.name === "UI agent");
    assert(uiAgent);
    let uiToken = (await invoke("credential", {id: uiAgent.id})).token;
    const deniedCopy = await main.webContents.executeJavaScript(`window.api.invoke('plugin:mcp-server:credential', {id:${JSON.stringify(uiAgent.id)}})`);
    assert.equal(deniedCopy.ok, false, "Credential retrieval is Settings-only");
    const agentRow = `.mcp-agent-table tr[data-agent-id="${uiAgent.id}"]`;
    await clickSettings(`${agentRow} .mcp-credential button`);
    await uiWait("document.querySelector('#mcp-error').textContent.includes('Credential copied')", "copy feedback");
    assert.equal(clipboard.readText(), uiToken);
    assert.equal(await settings.webContents.executeJavaScript(`document.body.textContent.includes(${JSON.stringify(uiToken)})`), false);
    await clickSettings(`${agentRow} .mcp-agent-actions button:nth-child(2)`);
    await uiWait("document.querySelector('#mcp-error').textContent.includes('Token rotated')", "rotation");
    let newToken = (await invoke("credential", {id: uiAgent.id})).token;
    assert.notEqual(uiToken, newToken);
    await clickSettings(`${agentRow} .mcp-credential button`);
    await uiWait("document.querySelector('#mcp-error').textContent.includes('Credential copied')", "rotated token copy");
    assert.equal(clipboard.readText(), newToken);
    await clickSettings(`${agentRow} .mcp-agent-actions button:nth-child(3)`);
    await settings.webContents.executeJavaScript(`document.querySelector('.mcp-password-form input').value = 'short'`);
    await clickSettings('.mcp-password-form .mcp-primary');
    assert.equal((await invoke("credential", {id: uiAgent.id})).token, newToken, "Invalid passwords must preserve the token");
    await settings.webContents.executeJavaScript(`document.querySelector('.mcp-password-form input').value = 'ui-password-123!'`);
    await clickSettings('.mcp-password-form .mcp-primary');
    await uiWait("document.querySelector('#mcp-error').textContent.includes('Password updated')", "manual password");
    assert.equal((await invoke("credential", {id: uiAgent.id})).token, "ui-password-123!");
    assert(!fs.readFileSync(path.join(root, ".marinashell", "mcp-settings.json"), "utf8").includes("ui-password-123!"));
    await new Promise(resolve => { settings.webContents.once('did-finish-load', resolve); settings.reload(); });
    await uiWait("Boolean(document.querySelector('.mcp-agent-table tr[data-agent-id]'))", "agents after reopening");
    assert.equal(await settings.webContents.executeJavaScript("document.querySelectorAll('main > section:not([hidden])').length"), 1);
    await clickSettings(`${agentRow} .mcp-credential button`);
    await uiWait("document.querySelector('#mcp-error').textContent.includes('Credential copied')", "saved password copy");
    assert.equal(clipboard.readText(), "ui-password-123!");
    await clickSettings(`${agentRow} .mcp-agent-actions button:first-child`);
    assert.equal(await settings.webContents.executeJavaScript("document.querySelector('#mcp-tab-permissions').getAttribute('aria-selected')"), 'true');
    await clickSettings('#mcp-tab-connection');
    assert.equal(await settings.webContents.executeJavaScript("document.querySelectorAll('#mcp-controls > [role=tabpanel]:not([hidden])').length"), 1);
    await clickSettings('#mcp-tab-agents');
    // Creating with a manual password uses the same table and Copy action.
    await settings.webContents.executeJavaScript(`document.querySelector('.mcp-create-form input[type=text]').value = 'Manual UI agent'; document.querySelector('.mcp-create-form input[type=password]').value = 'manual-ui-123!'`);
    await clickSettings('.mcp-create-form button');
    await uiWait("document.querySelector('.mcp-agent-table').textContent.includes('Manual UI agent')", "manual agent creation");
    const manualUi = (await invoke("status")).settings.clients.find(c => c.name === "Manual UI agent");
    assert.equal((await invoke("credential", {id: manualUi.id})).token, "manual-ui-123!");
    await invoke("revoke", {id: manualUi.id});
    await clickSettings(`${agentRow} .mcp-agent-actions button:nth-child(4)`);
    await clickSettings(`${agentRow} + tr .mcp-danger`);
    await uiWait("!document.querySelector('.mcp-agent-table tr[data-agent-id]')", "revoked rows removed");
    assert.equal((await invoke("credential", {id: uiAgent.id})).ok, false);
    await clickSettings('a[href="#preferences-workspace"]');
    assert.equal(await settings.webContents.executeJavaScript("document.querySelectorAll('main > section:not([hidden])').length"), 1);
    await clickSettings('a[href="#preferences-mcp"]');
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
    // A user-chosen fixed password pairs an agent without a generated token,
    // is stored encrypted, and can be replaced like any other credential.
    const fixedPair = await invoke("pair", {
      name: "Fixed password agent",
      password: "integration-fixed-1",
    });
    assert(fixedPair.ok, fixedPair.error);
    assert.equal(fixedPair.fixed, true);
    assert.equal(fixedPair.token, "integration-fixed-1");
    assert(
      !fs
        .readFileSync(path.join(root, ".marinashell", "mcp-settings.json"), "utf8")
        .includes("integration-fixed-1"),
      "Fixed password must be encrypted",
    );
    const fixedScope = {
      projects: [],
      hosts: ["__local__"],
      configurations: [],
      scratchpad: true,
    };
    assert(
      (
        await invoke("policy", {
          id: fixedPair.id,
          tools: { "terminals.list": "allow" },
          scope: fixedScope,
        })
      ).ok,
    );
    const fixedClient = new Client({ name: "fixed", version: "1" });
    await fixedClient.connect(
      new StreamableHTTPClientTransport(new URL(started.url), {
        requestInit: { headers: { Authorization: "Bearer integration-fixed-1" } },
      }),
    );
    assert.equal((await fixedClient.listTools()).tools.length, 1);
    await fixedClient.close();
    assert(
      (await invoke("password", { id: fixedPair.id, password: "integration-fixed-2" })).ok,
    );
    const stale = new Client({ name: "stale", version: "1" });
    await assert.rejects(
      stale.connect(
        new StreamableHTTPClientTransport(new URL(started.url), {
          requestInit: { headers: { Authorization: "Bearer integration-fixed-1" } },
        }),
      ),
    );
    await stale.close().catch(() => {});
    const reconnected = new Client({ name: "fixed2", version: "1" });
    await reconnected.connect(
      new StreamableHTTPClientTransport(new URL(started.url), {
        requestInit: { headers: { Authorization: "Bearer integration-fixed-2" } },
      }),
    );
    assert.equal((await reconnected.listTools()).tools.length, 1);
    await reconnected.close();
    const invalid = await invoke("password", {
      id: fixedPair.id,
      password: "short",
    });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /printable/);
    // One future-access field outside the project card; no pseudo-projects.
    await settings.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('#mcp-controls button')).find(b=>b.textContent==='Refresh status').click()`,
    );
    await uiWait("Boolean(document.querySelector('.mcp-project-list'))", "project access list");
    const accessView = await settings.webContents.executeJavaScript(`(() => {
      document.querySelector('#mcp-tab-permissions').click();
      const select = document.querySelector('#mcp-controls select[aria-label="Agent permissions"]');
      select.value = Array.from(select.options).find(o => o.textContent === 'Fixed password agent').value;
      select.dispatchEvent(new Event('change'));
      const future = document.querySelector('input[aria-label="Allow agents to access all future configurations"]');
      return { future: Boolean(future), outside: !future.closest('fieldset'), tree: Boolean(document.querySelector('.mcp-tree')),
        obsolete: /All projects, including future ones|All configurations, including future ones|Unassigned configurations/.test(document.querySelector('#mcp-controls').textContent) };
    })()`);
    assert(accessView.future && accessView.outside && !accessView.tree && !accessView.obsolete);
    await clickSettings('button[aria-label="Check all tool permissions"]');
    assert.equal(await settings.webContents.executeJavaScript("[...document.querySelectorAll('.mcp-permissions select')].every(s=>s.value==='allow')"), true);
    await clickSettings('button[aria-label="Check all tool permissions"]');
    assert.equal(await settings.webContents.executeJavaScript("[...document.querySelectorAll('.mcp-permissions select')].every(s=>s.value==='hidden')"), true);
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
    const fourPaneLayout = await call("layout.get", { projectId: opened.id });
    await call("layout.set", {
      projectId: opened.id,
      layout: "3-left",
      expectedRevision: fourPaneLayout.revision,
      requestId: "layout-three-panes",
    });
    assert.equal((await call("layout.get", { projectId: opened.id })).layout, "3-left");
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
    // A uniquely matching configuration appears inside its project. Project
    // access and individual configuration access remain explicit and editable.
    await settings.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('#mcp-controls button')).find(b=>b.textContent==='Refresh status').click()`,
    );
    await uiWait(`Boolean(document.querySelector('.mcp-project[data-project-id="${project.id}"] .mcp-config-access[data-configuration-id="${config.id}"]'))`, "configuration linked to project");
    await settings.webContents.executeJavaScript(`(() => {
      document.querySelector('#mcp-tab-permissions').click();
      const select = document.querySelector('#mcp-controls select[aria-label="Agent permissions"]');
      select.value = Array.from(select.options).find(o => o.textContent === 'Fixed password agent').value;
      select.dispatchEvent(new Event('change'));
    })()`);
    const projectSelector = `.mcp-project[data-project-id="${project.id}"]`;
    await clickSettings(`${projectSelector} .mcp-project-toggle`);
    assert.equal(await settings.webContents.executeJavaScript(`document.querySelector('${projectSelector} .mcp-project-configurations').hidden`), true);
    await clickSettings(`${projectSelector} .mcp-project-toggle`);
    assert.equal(await settings.webContents.executeJavaScript(`document.querySelector('${projectSelector} .mcp-project-configurations').hidden`), false);
    await clickSettings('button[aria-label="Check all tool permissions"]');
    await clickSettings('button[aria-label="Check all project and configuration access"]');
    assert.equal(await settings.webContents.executeJavaScript("[...document.querySelectorAll('.mcp-project-list input')].every(i=>i.checked&&!i.disabled&&!i.indeterminate)"), true);
    await clickSettings('button[aria-label="Check all project and configuration access"]');
    assert.equal(await settings.webContents.executeJavaScript("[...document.querySelectorAll('.mcp-project-list input')].every(i=>!i.checked)"), true);
    await clickSettings(`${projectSelector} .mcp-project-header input`);
    const savePermissions = async () => {
      await settings.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#mcp-controls button')).find(b=>b.textContent==='Save agent permissions').click()`);
      await uiWait("document.querySelector('#mcp-error').textContent.includes('Permissions saved for Fixed password agent')", "saved scope confirmation");
    };
    await savePermissions();
    const actualScope = (await invoke("status")).settings.clients.find(c => c.id === fixedPair.id).scope;
    assert(actualScope.projects.includes(project.id) && actualScope.configurations.includes(config.id));
    assert(!actualScope.projects.includes("*") && !actualScope.configurations.includes("*"));
    assert.equal(actualScope.futureConfigurations, false);
    assert.equal(await settings.webContents.executeJavaScript(`document.querySelector('.mcp-config-access[data-configuration-id="${config.id}"] input').checked`), true);
    const scopedClient = new Client({ name: "saved-scope", version: "1" });
    await scopedClient.connect(new StreamableHTTPClientTransport(new URL(started.url), {
      requestInit: { headers: { Authorization: `Bearer ${(await invoke("credential", {id:fixedPair.id})).token}` } },
    }));
    const scopedList = async () => {
      const result = await scopedClient.callTool({name:"configurations.list",arguments:{}});
      assert(!result.isError, result.content[0].text);
      return result.structuredContent.items;
    };
    assert((await scopedList()).some(c=>c.id===config.id));
    await clickSettings(`.mcp-config-access[data-configuration-id="${config.id}"] input`);
    await savePermissions();
    assert(!(await scopedList()).some(c=>c.id===config.id), "unchecking must remove actual MCP access");
    await clickSettings(`.mcp-config-access[data-configuration-id="${config.id}"] input`);
    await clickSettings('input[aria-label="Allow agents to access all future configurations"]');
    await savePermissions();
    assert((await invoke("status")).settings.clients.find(c=>c.id===fixedPair.id).scope.futureConfigurations);
    const futureConfig = await call("configurations.create", {
      configuration:{name:"Future config",host:"__local__",type:"shell",mode:"commands",target:"true",cwd:root},requestId:"future-config-create",
    });
    assert((await scopedList()).some(c=>c.id===futureConfig.id), "future access must take effect without another save");
    await scopedClient.close();
    settings.setSize(900, 760);
    settings.show();
    await settings.webContents.executeJavaScript("document.querySelector('#mcp-tab-permissions').click()");
    await pause(150);
    assert.equal(await settings.webContents.executeJavaScript("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), true);
    fs.mkdirSync(path.join(__dirname, "../design/validation"), {recursive:true});
    fs.writeFileSync(path.join(__dirname, "../design/validation/mcp-permissions.png"), (await settings.webContents.capturePage()).toPNG());
    let conflict = await client.callTool({
      name: "configurations.run",
      arguments: {
        configurationId: config.id,
        projectId: opened.id,
        expectedRevision: "stale-configuration-revision",
        requestId: "run-stale",
      },
    });
    assert.equal(conflict.isError, true);
    assert.match(conflict.content[0].text, /Target changed/);
    const failedActivity = (await invoke("status")).activity.find(
      (entry) => entry.tool === "configurations.run" && entry.outcome === "REVISION_CONFLICT",
    );
    assert.equal(failedActivity.target, config.id);
    assert.match(failedActivity.reason, /Target changed/);
    await settings.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('#mcp-controls button')).find(b=>b.textContent==='Refresh status').click()`,
    );
    await uiWait("Array.from(document.querySelectorAll('#mcp-controls td')).some(c=>c.textContent.includes('Target changed'))", "activity failure reason");
    await clickSettings('#mcp-tab-activity');
    assert.equal(await settings.webContents.executeJavaScript(
      "document.querySelector('#mcp-panel-activity').textContent.includes('Target changed')",
    ), true);
    // All configurations was saved before creation: launching a future
    // configuration must work without another permissions save.
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
    await clickSettings('.mcp-refresh');
    await uiWait("document.querySelector('.mcp-server-bar strong').textContent === 'Server stopped'", "final server state");
    await clickSettings('#mcp-tab-agents');
    await clickSettings('a[href="#preferences-editor"]');
    settings.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Right'});
    settings.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Right'});
    await uiWait("document.querySelector('a[href=\"#preferences-workspace\"]').getAttribute('aria-selected') === 'true'", "keyboard tabs");
    await clickSettings('a[href="#preferences-mcp"]');
    await settings.webContents.executeJavaScript(
      "document.querySelector('#mcp-tab-agents').click(); document.querySelector('main').scrollTop = 0",
    );
    await pause(500);
    fs.writeFileSync(
      path.join(__dirname, "../design/validation/mcp-settings.png"),
      (await settings.webContents.capturePage()).toPNG(),
    );
    settings.setSize(560, 720);
    await pause(200);
    const compact = await settings.webContents.executeJavaScript(`({
      bodyOverflow: document.body.scrollWidth > window.innerWidth,
      mainOverflow: document.querySelector('main').scrollWidth > document.querySelector('main').clientWidth,
      visiblePanels: document.querySelectorAll('main > section:not([hidden])').length,
      visibleAgentPanels: document.querySelectorAll('#mcp-controls > [role=tabpanel]:not([hidden])').length
    })`);
    assert(!compact.bodyOverflow && !compact.mainOverflow, `Settings overflow: ${JSON.stringify(compact)}`);
    assert.equal(compact.visiblePanels, 1);
    assert.equal(compact.visibleAgentPanels, 1);
    fs.writeFileSync(path.join(__dirname, "../design/validation/mcp-settings-compact.png"), (await settings.webContents.capturePage()).toPNG());
    console.log(
      "PASS MCP Electron: pointer-driven agent creation/copy/rotation/manual passwords/revocation, persisted copy, keyboard tabs and compact layout, encrypted credentials, Settings-only controls, real SDK project restore/layout/read, shared run launch/output/stop, approval dialog, rotation, disable/re-enable and saved state",
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
