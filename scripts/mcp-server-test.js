const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { createStore } = require("../plugins/mcp-server/store");
const { createTools } = require("../plugins/mcp-server/tools");
const { createHttpServer } = require("../plugins/mcp-server/server");
const { createLibraryStore } = require("../main/services/libraryStore");
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "marina-mcp-unit-"));
  const store = createStore({
    root,
    secureStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
  });
  const socket = net.createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  store.update({ port });
  let writes = 0;
  let approval;
  let approve = () => true;
  const snapshot = {
    projects: [],
    terminals: [{ id: "one", projectId: "", host: "__local__", title: "One" }],
    stamp: "stable",
  };
  const broker = {
    request: async (action, args) => {
      if (action === "snapshot") return snapshot;
      if (action === "approve") {
        approval = args;
        return approve();
      }
      if (action === "terminals.create") {
        writes++;
        return { id: "new" };
      }
      return { text: "hello" };
    },
  };
  const engine = createTools({
    store,
    broker,
    library: createLibraryStore("groups", root),
    getService: () => null,
    capture: () => {},
  });
  const server = createHttpServer({ store, tools: engine });
  await server.start();
  assert.equal(server.status().state, "running");
  const pair = store.add("Test");
  const scope = {
    projects: [],
    hosts: ["__local__"],
    configurations: [],
    scratchpad: true,
  };
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.status().url), {
      requestInit: { headers: { Authorization: `Bearer ${pair.token}` } },
    }),
  );
  assert.equal((await client.listTools()).tools.length, 0);
  let result = await client.callTool({ name: "terminals.list", arguments: {} });
  assert.equal(result.isError, true);
  store.policy(
    pair.id,
    {
      "terminals.list": "allow",
      "terminals.create": "ask",
      "terminals.read": "allow",
    },
    scope,
    engine.names,
  );
  assert.equal((await client.listTools()).tools.length, 3);
  result = await client.callTool({ name: "terminals.list", arguments: {} });
  assert.equal(result.structuredContent.items.length, 1);
  result = await client.callTool({
    name: "terminals.read",
    arguments: { terminalId: "unknown" },
  });
  assert.match(result.content[0].text, /TARGET_GONE/);
  const args = {
    host: "__local__",
    directory: "/tmp",
    title: "Test",
    requestId: "once",
  };
  result = await client.callTool({ name: "terminals.create", arguments: args });
  assert(!result.isError, result.content[0].text);
  assert.equal(writes, 1);
  assert.equal(approval.arguments.requestId, "once");
  result = await client.callTool({ name: "terminals.create", arguments: args });
  assert(result.isError);
  assert.equal(writes, 1);
  approve = () => {
    store.revoke(pair.id);
    return true;
  };
  result = await client.callTool({
    name: "terminals.create",
    arguments: { ...args, requestId: "revoked" },
  });
  assert(result.isError);
  assert.equal(writes, 1);
  const url = server.status().url;
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pair.token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    401,
  );
  const another = store.add("Another");
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${another.token}`,
          Origin: "https://evil.example",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    await new Promise((resolve) => {
      const request = require("http").request(
        url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${another.token}`,
            Host: "evil.example",
            "Content-Type": "application/json",
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.end("{}");
    }),
    403,
  );
  await client.close();
  await server.stop();
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(port, "127.0.0.1", r));
  await server.start();
  assert.equal(server.status().state, "error");
  assert.equal(store.data.port, port);
  await new Promise((r) => blocker.close(r));
  await server.start();
  assert.equal(server.status().state, "running");
  await server.stop();
  const persisted = createStore({
    root,
    secureStorage: {
      isEncryptionAvailable: () => true,
      decryptString: (b) => b.toString(),
    },
  });
  assert.equal(persisted.data.clients.length, 1);
  assert.equal(persisted.receipt(`${pair.id}:once`).status, "completed");
  fs.rmSync(root, { recursive: true, force: true });
  console.log(
    "PASS MCP: real SDK discovery/calls, hidden tools, bounded schemas, scopes, approval, revocation, idempotency, auth, Host/Origin and lifecycle",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
