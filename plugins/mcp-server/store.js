const crypto = require("crypto");
const { createLibraryStore } = require("../../main/services/libraryStore");
const revision = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function createStore({ root, secureStorage }) {
  const file = createLibraryStore("mcp-settings", root);
  const receipts = createLibraryStore("mcp-receipts", root);
  const events = createLibraryStore("mcp-activity", root);
  let data = file.read()[0] || {
    port: 37651,
    restore: false,
    desiredRunning: false,
    clients: [],
  };
  function save() {
    file.write([data]);
  }
  function publicState() {
    return {
      ...data,
      clients: data.clients.map(({ secret, ...client }) => client),
    };
  }
  function token() {
    if (
      !secureStorage.isEncryptionAvailable() ||
      secureStorage.getSelectedStorageBackend?.() === "basic_text"
    )
      throw new Error(
        "Secure system credential storage is unavailable. Unlock your keychain or secret service first.",
      );
    const value = crypto.randomBytes(32).toString("base64url");
    return {
      value,
      secret: secureStorage.encryptString(value).toString("base64"),
    };
  }
  return {
    get data() {
      return data;
    },
    publicState,
    update(patch) {
      if (
        patch.port !== undefined &&
        (!Number.isInteger(patch.port) ||
          patch.port < 1024 ||
          patch.port > 65535)
      )
        throw new Error("Port must be between 1024 and 65535.");
      for (const key of ["port", "restore", "desiredRunning"])
        if (patch[key] !== undefined)
          data[key] = key === "port" ? patch[key] : Boolean(patch[key]);
      save();
    },
    add(name) {
      if (!String(name || "").trim() || String(name).length > 80)
        throw new Error("Enter an agent name (up to 80 characters).");
      const credential = token();
      const client = {
        id: crypto.randomUUID(),
        name: String(name).trim(),
        secret: credential.secret,
        version: 1,
        tools: {},
        scope: {
          projects: [],
          hosts: [],
          configurations: [],
          scratchpad: false,
        },
      };
      data.clients.push(client);
      save();
      return { id: client.id, token: credential.value };
    },
    rotate(id) {
      const client = data.clients.find((c) => c.id === id);
      if (!client) throw new Error("Agent not found");
      const credential = token();
      client.secret = credential.secret;
      client.version++;
      save();
      return { token: credential.value };
    },
    revoke(id) {
      data.clients = data.clients.filter((c) => c.id !== id);
      save();
    },
    policy(id, tools, scope, names, approvedRevisions = {}) {
      const client = data.clients.find((c) => c.id === id);
      if (!client) throw new Error("Agent not found");
      const next = {};
      for (const [name, mode] of Object.entries(tools || {})) {
        if (!names.includes(name) || !["hidden", "ask", "allow"].includes(mode))
          throw new Error("Invalid tool permission");
        next[name] = mode;
      }
      const allowed = (key) => {
        const values = scope?.[key];
        if (
          !Array.isArray(values) ||
          values.length > 1000 ||
          values.some((v) => typeof v !== "string" || v.length > 200)
        )
          throw new Error("Invalid scope");
        return [...new Set(values)];
      };
      client.approvedRevisions = approvedRevisions;
      client.tools = next;
      client.scope = {
        projects: allowed("projects"),
        hosts: allowed("hosts"),
        configurations: allowed("configurations"),
        scratchpad: scope.scratchpad === true,
      };
      client.version++;
      save();
    },
    authenticate(value) {
      if (typeof value !== "string" || value.length > 256) return null;
      const digest = revision(value);
      for (const client of data.clients) {
        try {
          if (
            crypto.timingSafeEqual(
              Buffer.from(digest),
              Buffer.from(
                revision(
                  secureStorage.decryptString(
                    Buffer.from(client.secret, "base64"),
                  ),
                ),
              ),
            )
          )
            return client;
        } catch {}
      }
      return null;
    },
    receipt: (id) => receipts.read().find((r) => r.id === id),
    saveReceipt: (item) => receipts.upsert(item),
    log(item) {
      events.write([
        ...events.read().slice(-199),
        { ...item, time: new Date().toISOString() },
      ]);
    },
    activity: () => events.read().slice(-50).reverse(),
  };
}
module.exports = { createStore, revision };
