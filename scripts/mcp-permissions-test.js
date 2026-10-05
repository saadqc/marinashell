const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStore, revision } = require("../plugins/mcp-server/store");
const { createTools } = require("../plugins/mcp-server/tools");
const { createLibraryStore } = require("../main/services/libraryStore");
const { projectConfigurations } = require("../plugins/mcp-server/projectConfigurations");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "marina-mcp-policy-"));
  try {
    const store = createStore({
      root,
      secureStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(s),
        decryptString: (b) => b.toString(),
      },
    });
    const pair = store.add("Codex");
    const configs = createLibraryStore("run-configurations", root);
    let launches = 0;
    let approvals = 0;
    let approve = true;
    let afterApproval = () => {};
    let run;
    const manager = {
      configs,
      list: () => run ? [run] : [],
      async start(id, groupId) {
        launches++;
        run = { id: "run", configurationId: id, groupId, host: "__local__", status: "running" };
        return run;
      },
      async restart() { launches++; return run; },
    };
    const snapshot = { stamp: "stable", projects: [{ id: "project", name: "Gene/Variation" }], terminals: [] };
    const engine = createTools({
      store,
      library: createLibraryStore("groups", root),
      getService: (name) => name === "runs" ? { manager } : null,
      broker: {
        async request(action) {
          if (action === "snapshot") return snapshot;
          assert.equal(action, "approve");
          approvals++;
          afterApproval();
          return approve;
        },
      },
    });
    const scope = { configurations: ["*"], hosts: ["__local__"], projects: ["project"], scratchpad: false };
    const tools = { "configurations.run": "allow", "configurations.restart": "allow", "configurations.stop": "allow" };
    const policy = (s = scope, t = tools, revisions = {}, known = configs.read().map(c => c.id)) => store.policy(pair.id, t, s, engine.names, revisions, known);
    let request = 0;
    const execute = (extra = {}, name = "configurations.run") => engine.execute(pair.id, name, {
      ...(name === "configurations.run" ? { configurationId: "config", projectId: "project" } : { runId: "run" }),
      expectedRevision: revision(configs.read()[0]), requestId: `request-${++request}`, ...extra,
    }, undefined);
    // Save the broad grant first, then create a configuration. No resave.
    policy();
    configs.upsert({ id: "config", name: "Worker", host: "__local__", target: "first" });
    await execute();
    assert.equal(launches, 1);
    assert.equal(approvals, 0);
    configs.upsert({ ...configs.read()[0], target: "changed" });
    await execute();
    await execute({}, "configurations.restart");
    assert.equal(launches, 3, "broad access must cover changed configurations and restart");
    await assert.rejects(execute({ expectedRevision: "old" }), /Target changed/);
    assert.equal(launches, 3);
    assert.equal(store.activity()[0].target, "config");
    assert.match(store.activity()[0].reason, /Target changed/);
    policy({ ...scope, hosts: [] });
    await assert.rejects(execute(), { code: "PERMISSION_DENIED" });
    policy({ ...scope, projects: [] });
    await assert.rejects(execute(), { code: "PERMISSION_DENIED" });
    policy();
    configs.upsert({ ...configs.read()[0], killPortOnLaunch: true, killPort: 8012 });
    await assert.rejects(execute(), /Additional permission required: configurations.killPort/);
    assert.equal(launches, 3, "broad access must preserve host, project and port restrictions");
    configs.upsert({ ...configs.read()[0], killPortOnLaunch: false });
    const selective = { ...scope, configurations: ["config"] };
    policy(selective);
    await execute();
    assert.equal(launches, 4);
    configs.upsert({ ...configs.read()[0], target: "changed again" });
    await execute();
    assert.equal(launches, 5, "saved selections must grant Allow without an extra approval snapshot");
    policy({ ...scope, configurations: [], futureConfigurations: true });
    await assert.rejects(execute(), { code: "PERMISSION_DENIED" });
    const persistedPolicy = createStore({ root, secureStorage: {} }).data.clients.find(c => c.id === pair.id);
    assert.equal(persistedPolicy.scope.futureConfigurations, true);
    assert(persistedPolicy.knownConfigurationIds.includes("config"), "future access baseline must survive restarting");
    const futureConfig = configs.upsert({ id: "future", name: "New worker", host: "__local__", target: "future" });
    await execute({ configurationId: futureConfig.id, expectedRevision: revision(futureConfig) });
    assert.equal(launches, 6, "future access must grant a newly created configuration");
    policy({ ...scope, configurations: [], futureConfigurations: false });
    await assert.rejects(execute({ configurationId: futureConfig.id, expectedRevision: revision(futureConfig) }), { code: "PERMISSION_DENIED" });
    // Invalid saves must leave the previous policy intact.
    const previousPolicy = JSON.stringify(store.publicState());
    assert.throws(() => policy({ ...scope, hosts: null }), /Invalid scope/);
    assert.equal(JSON.stringify(store.publicState()), previousPolicy);
    // Ask still prompts for broad scope, and a decline never launches.
    policy(scope, { ...tools, "configurations.run": "ask" });
    approve = false;
    await assert.rejects(execute(), /declined/);
    approve = true;
    await execute();
    assert.equal(approvals, 2);
    assert.equal(launches, 7);
    afterApproval = () => configs.upsert({ ...configs.read()[0], target: "edited during approval" });
    await assert.rejects(execute(), { code: "REVISION_CONFLICT" });
    assert.equal(launches, 7, "editing during approval must invalidate the pending call");
    const linked = projectConfigurations([
      { id: "broad", tabs: [{ host: "__local__", directory: "/work" }] },
      { id: "gene", tabs: [{ host: "__local__", directory: "/work/gene/backend" }], configurationIds: ["explicit"] },
      { id: "remote", tabs: [{ host: "remote", directory: "/work/gene/backend" }] },
    ], [
      { id: "new", host: "__local__", cwd: "/work/gene/backend" },
      { id: "explicit", host: "__local__", cwd: "/work" },
      { id: "remote", host: "remote", cwd: "/work/gene/backend" },
      { id: "boundary", host: "__local__", cwd: "/workspace" },
    ]);
    assert.deepEqual(linked.find(p => p.id === "gene").configurationIds, ["explicit", "new"]);
    assert.deepEqual(linked.find(p => p.id === "remote").configurationIds, ["remote"]);
    assert.deepEqual(linked.find(p => p.id === "broad").configurationIds, []);
    assert(projectConfigurations([{id:"a",tabs:[{directory:"/same"}]},{id:"b",tabs:[{directory:"/same"}]}], [{id:"ambiguous",host:"__local__",cwd:"/same"}]).every(p => !p.configurationIds.length));
    console.log("PASS MCP permissions: saved selections, future access, legacy grants, host/project/port scope, Ask, concurrent changes, atomic saves and project matching");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
