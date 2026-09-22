const { z } = require("zod");
const { zodToJsonSchema } = require("zod-to-json-schema");
const { randomUUID } = require("crypto");
const { revision } = require("./store");
const { normalizeProject } = require("../../main/services/projects");
const str = z.string().min(1).max(200);
const page = {
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(100),
};
const write = {
  requestId: str.describe(
    "Unique idempotency key. Reuse only for retrying this exact operation.",
  ),
};
const expected = { expectedRevision: str };
const projectId = z.string().max(200).default("");
const definitions = [];
function tool(name, description, shape, mutates = false) {
  definitions.push({
    name,
    description,
    schema: z.object(shape).strict(),
    mutates,
  });
}
tool("terminals.list", "List permitted open terminal metadata.", page);
tool(
  "terminals.read",
  "Read terminal scrollback, bounded to 256 KB. May contain sensitive command output.",
  {
    terminalId: str,
    lastN: z.number().int().min(1).max(5000).default(500),
    cursor: z.string().max(20000).optional(),
  },
);
tool(
  "terminals.create",
  "Create and connect a terminal in an existing project, without changing focus.",
  {
    projectId,
    host: str,
    directory: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^(\/|[A-Za-z]:[\\/])/),
    title: z.string().min(1).max(100),
    ...write,
  },
  true,
);
tool(
  "terminals.close",
  "Disconnect and close a terminal. This can stop its running shell processes.",
  { terminalId: str, ...expected, ...write },
  true,
);
tool(
  "screenshots.capture",
  "Capture a visible terminal only. Dialogs and obscured terminals cannot be captured.",
  { terminalId: str },
);
tool(
  "configurations.list",
  "List permitted configuration summaries with revisions, excluding commands and environment values.",
  page,
);
tool(
  "configurations.create",
  "Save a run configuration, without launching. Granting create and run permits code execution.",
  {
    configuration: z
      .object({
        name: z.string().min(1).max(100),
        host: str,
        type: z.enum(["python", "javascript", "shell"]),
        mode: z.enum(["script", "module", "npm", "commands"]),
        target: z.string().max(30000),
        cwd: z.string().max(4096),
        interpreter: z.string().max(4096).optional(),
        args: z.string().max(10000).optional(),
        killPortOnLaunch: z.boolean().optional(),
        killPort: z.number().int().min(1).max(65535).optional(),
      })
      .strict(),
    ...write,
  },
  true,
);
tool(
  "configurations.run",
  "Launch a saved configuration at its expected revision. Port cleanup requires separate permission.",
  { configurationId: str, projectId, ...expected, ...write },
  true,
);
tool(
  "configurations.stop",
  "Stop a managed run. Force termination requires configurations.forceStop permission.",
  { runId: str, force: z.boolean().default(false), ...expected, ...write },
  true,
);
tool(
  "configurations.restart",
  "Stop then relaunch the saved configuration at its expected revision.",
  { runId: str, ...expected, ...write },
  true,
);
tool(
  "runs.list",
  "List permitted managed runs, excluding internal connection details.",
  page,
);
tool(
  "runs.read",
  "Read bounded managed run output. May contain sensitive output.",
  {
    runId: str,
    offset: z.number().int().min(0).default(0),
    generation: z.number().int().min(0).default(0),
  },
);
tool(
  "projects.list",
  "List permitted saved and open projects with revisions.",
  page,
);
tool(
  "projects.create",
  "Save a project with local or SSH directories and split layout. Does not open it.",
  {
    name: z.string().min(1).max(100),
    tabs: z
      .array(
        z
          .object({
            host: str,
            currentPath: z.string().max(4096),
            manualTitle: z.string().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(32),
    layout: z.enum(["1x1", "2x1", "1x2", "2x2"]).default("1x1"),
    ...write,
  },
  true,
);
tool(
  "projects.open",
  "Open a saved project and restore its split layout and connections.",
  { savedProjectId: str, ...expected, ...write },
  true,
);
tool(
  "projects.remove",
  "Remove a saved project definition only. Open terminals and files remain.",
  { savedProjectId: str, ...expected, ...write },
  true,
);
tool(
  "projects.close",
  "Close an open project and disconnect its terminal sessions.",
  { projectId: str, ...expected, ...write },
  true,
);
tool("layout.get", "Get the split layout of an open project.", {
  projectId: str,
});
tool(
  "layout.set",
  "Set an open project to a supported split layout without changing focus.",
  {
    projectId: str,
    layout: z.enum(["1x1", "2x1", "1x2", "2x2"]),
    ...expected,
    ...write,
  },
  true,
);
tool(
  "processes.list",
  "List host processes with CPU, memory, available disk counters and ports. Requires the Processes plugin.",
  {
    host: str,
    query: z.string().max(100).default(""),
    port: z.number().int().min(1).max(65535).optional(),
    ...page,
  },
);
const extraPermissions = [
  "configurations.killPort",
  "configurations.forceStop",
];
const names = [...definitions.map((d) => d.name), ...extraPermissions];
const fail = (code, message = code) => {
  throw Object.assign(new Error(message), { code });
};
function createTools({ store, broker, library, getService, capture }) {
  const includes = (list, id) => list.includes("*") || list.includes(id);
  const requireHost = (client, host) => {
    if (!includes(client.scope.hosts, host))
      fail("PERMISSION_DENIED", "Host is outside the allowed scope.");
  };
  const configSummary = (c) => ({
    id: c.id,
    name: c.name,
    host: c.host,
    type: c.type,
    cwd: c.cwd,
    killPortOnLaunch: c.killPortOnLaunch,
    killPort: c.killPort,
    revision: revision(c),
  });
  const runSummary = (r) => ({
    id: r.id,
    configurationId: r.configurationId,
    name: r.name,
    host: r.host,
    projectId: r.groupId || "",
    status: r.status,
    startedAt: r.startedAt,
    exitCode: r.exitCode,
    revision: revision({
      id: r.id,
      configurationId: r.configurationId,
      instance: r.instance,
      startedAt: r.startedAt,
    }),
  });
  function manager() {
    const service = getService("runs");
    if (!service)
      fail("DEPENDENCY_DISABLED", "Enable Run configurations first.");
    return service.manager;
  }
  function projectAllowed(c, id, snapshot) {
    if (!id) return c.scope.scratchpad;
    const p = snapshot.projects.find((p) => p.id === id);
    return Boolean(
      p &&
        (includes(c.scope.projects, id) ||
          (p.savedGroupId && includes(c.scope.projects, p.savedGroupId))),
    );
  }
  function terminalAllowed(c, t, snapshot) {
    return (
      includes(c.scope.hosts, t.host) &&
      projectAllowed(c, t.projectId, snapshot)
    );
  }
  function requireProject(c, id, snapshot) {
    if (!projectAllowed(c, id, snapshot))
      fail("PERMISSION_DENIED", "Project is outside the allowed scope.");
  }
  function requireConfig(c, config) {
    if (!config) fail("TARGET_GONE");
    requireHost(c, config.host);
    if (!includes(c.scope.configurations, config.id))
      fail("PERMISSION_DENIED", "Configuration is outside the allowed scope.");
  }
  function visible(d, client) {
    return (
      ["ask", "allow"].includes(client.tools[d.name]) &&
      (!/^(configurations|runs)\./.test(d.name) || getService("runs")) &&
      (d.name !== "processes.list" || getService("processes"))
    );
  }
  async function execute(clientId, name, raw, signal, acceptedVersion) {
    const started = Date.now();
    const client = store.data.clients.find((c) => c.id === clientId);
    if (!client || client.version !== acceptedVersion) fail("AUTH_REQUIRED");
    const version = client.version;
    const d = definitions.find((d) => d.name === name);
    if (!d || !visible(d, client))
      fail("PERMISSION_DENIED", "Tool is not exposed.");
    const parsed = d.schema.safeParse(raw);
    if (!parsed.success)
      fail(
        "INVALID_ARGUMENT",
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
    const a = parsed.data;
    const fingerprint = revision({ name, a });
    const receiptId = d.mutates ? `${clientId}:${a.requestId}` : null;
    const guard = () => {
      if (signal?.aborted) fail("TIMEOUT");
      const fresh = store.data.clients.find((c) => c.id === clientId);
      if (!fresh || fresh.version !== version || !visible(d, fresh))
        fail(
          "PERMISSION_DENIED",
          "Permissions changed; retry with current permissions.",
        );
    };
    let receiptStarted = false;
    try {
      const old = receiptId && store.receipt(receiptId);
      if (old) {
        if (old.fingerprint !== fingerprint)
          fail(
            "REVISION_CONFLICT",
            "Request ID was used for different arguments.",
          );
        fail(
          "ALREADY_REQUESTED",
          `Operation already ${old.status}. Inspect current state before making another request.`,
        );
      }
      const snapshot = await broker.request("snapshot", {}, signal);
      guard();
      const t = a.terminalId
        ? snapshot.terminals.find((t) => t.id === a.terminalId)
        : null;
      if (a.terminalId && !t) fail("TARGET_GONE");
      if (t && !terminalAllowed(client, t, snapshot)) fail("PERMISSION_DENIED");
      const group = a.projectId
        ? snapshot.projects.find((p) => p.id === a.projectId)
        : null;
      if ("projectId" in a) requireProject(client, a.projectId, snapshot);
      if (a.host) requireHost(client, a.host);
      const saved = a.savedProjectId
        ? library.read().find((p) => p.id === a.savedProjectId)
        : null;
      if (a.savedProjectId) {
        if (!saved) fail("TARGET_GONE");
        if (!includes(client.scope.projects, saved.id))
          fail("PERMISSION_DENIED");
        for (const tab of saved.tabs) requireHost(client, tab.host);
      }
      let config;
      let run;
      if (a.runId) {
        run = manager()
          .list()
          .find((r) => r.id === a.runId);
        if (!run) fail("TARGET_GONE");
        requireHost(client, run.host);
        requireProject(client, run.groupId || "", snapshot);
        config = manager()
          .configs.read()
          .find((c) => c.id === run.configurationId);
        requireConfig(client, config);
      } else if (a.configurationId) {
        config = manager()
          .configs.read()
          .find((c) => c.id === a.configurationId);
        requireConfig(client, config);
      }
      if (name === "projects.create") {
        if (!client.scope.projects.includes("*"))
          fail(
            "PERMISSION_DENIED",
            "Creating projects requires All projects (including future projects).",
          );
        for (const tab of a.tabs) requireHost(client, tab.host);
      }
      if (name === "configurations.create") {
        if (!client.scope.configurations.includes("*"))
          fail(
            "PERMISSION_DENIED",
            "Creating configurations requires All configurations (including future configurations).",
          );
        requireHost(client, a.configuration.host);
      }
      const targetRevision = saved
        ? revision(saved)
        : name === "configurations.stop"
          ? runSummary(run).revision
          : config
            ? revision(config)
            : t
              ? revision(t)
              : group
                ? revision(group)
                : null;
      if (a.expectedRevision && a.expectedRevision !== targetRevision)
        fail(
          "REVISION_CONFLICT",
          "Target changed. List it again before acting.",
        );
      const checks = [name];
      if (name === "projects.open") {
        checks.push("terminals.create");
        for (const p of snapshot.projects.filter(
          (p) => p.savedGroupId === saved.id,
        ))
          for (const member of snapshot.terminals.filter(
            (t) => t.projectId === p.id,
          ))
            if (!terminalAllowed(client, member, snapshot))
              fail("PERMISSION_DENIED");
      }
      if (name === "projects.close") {
        checks.push("terminals.close");
        for (const member of snapshot.terminals.filter(
          (t) => t.projectId === a.projectId,
        ))
          if (!terminalAllowed(client, member, snapshot))
            fail("PERMISSION_DENIED");
        for (const r of getService("runs")
          ?.manager.list()
          .filter((r) => r.groupId === a.projectId) || []) {
          requireHost(client, r.host);
          if (!includes(client.scope.configurations, r.configurationId))
            fail("PERMISSION_DENIED");
          const fresh = await manager().status(r.id);
          if (!["exited", "failed", "blocked"].includes(fresh.status))
            fail(
              "ACTIVE_RUNS",
              "Stop project runs before closing the project.",
            );
        }
      }
      if (
        ["configurations.run", "configurations.restart"].includes(name) &&
        config.killPortOnLaunch
      )
        checks.push("configurations.killPort");
      if (a.force) checks.push("configurations.forceStop");
      if (name === "configurations.restart")
        checks.push("configurations.stop", "configurations.run");
      if (["configurations.run", "configurations.restart"].includes(name))
        for (const existing of manager()
          .list()
          .filter(
            (r) =>
              r.configurationId === config.id &&
              !["exited", "failed", "blocked"].includes(r.status),
          )) {
          requireHost(client, existing.host);
          requireProject(client, existing.groupId || "", snapshot);
        }
      for (const permission of checks)
        if (!["ask", "allow"].includes(client.tools[permission]))
          fail(
            "PERMISSION_DENIED",
            `Additional permission required: ${permission}`,
          );
      const needsApproval = checks.some((p) => client.tools[p] === "ask");
      if (needsApproval) {
        const approved = await broker.request(
          "approve",
          {
            client: client.name,
            tool: name,
            arguments: {
              ...a,
              ...(config &&
              ["configurations.run", "configurations.restart"].includes(name)
                ? { configuration: config }
                : {}),
              ...(saved && name === "projects.open" ? { project: saved } : {}),
            },
          },
          signal,
        );
        if (!approved)
          fail("PERMISSION_DENIED", "The user declined this operation.");
      }
      guard();
      if (
        config &&
        ["configurations.run", "configurations.restart"].includes(name)
      ) {
        if (
          revision(
            manager()
              .configs.read()
              .find((c) => c.id === config.id),
          ) !== revision(config)
        )
          fail("REVISION_CONFLICT");
        if (
          !needsApproval &&
          client.approvedRevisions?.[config.id] !== revision(config)
        )
          fail(
            "REVISION_CONFLICT",
            "Configuration changed since access was granted. Save its permissions again, or use Ask.",
          );
      }
      if (
        saved &&
        revision(library.read().find((p) => p.id === saved.id)) !==
          revision(saved)
      )
        fail("REVISION_CONFLICT");
      if (d.mutates) {
        const current = await broker.request("snapshot", {}, signal);
        if (current.stamp !== snapshot.stamp)
          fail(
            "REVISION_CONFLICT",
            "Workspace changed while this operation was pending.",
          );
        guard();
        store.saveReceipt({ id: receiptId, fingerprint, status: "pending" });
        receiptStarted = true;
      }
      const request = (action, args) => {
        guard();
        return broker.request(
          action,
          { ...args, stamp: snapshot.stamp },
          signal,
        );
      };
      let result;
      const paged = (items) => ({
        items: items.slice(a.offset, a.offset + a.limit),
        nextOffset:
          a.offset + a.limit < items.length ? a.offset + a.limit : null,
      });
      switch (name) {
        case "terminals.list":
          result = paged(
            snapshot.terminals
              .filter((t) => terminalAllowed(client, t, snapshot))
              .map((t) => ({ ...t, revision: revision(t) })),
          );
          break;
        case "terminals.read":
          result = await request(name, a);
          break;
        case "terminals.create":
          result = await request(name, a);
          break;
        case "terminals.close":
          result = await request(name, a);
          break;
        case "screenshots.capture": {
          const rect = await request("screenshots.rect", a);
          guard();
          result = await capture(rect);
          const after = await request("screenshots.rect", a);
          if (JSON.stringify(after) !== JSON.stringify(rect))
            fail("REVISION_CONFLICT");
          break;
        }
        case "configurations.list":
          result = paged(
            manager()
              .configs.read()
              .filter(
                (c) =>
                  includes(client.scope.configurations, c.id) &&
                  includes(client.scope.hosts, c.host),
              )
              .map(configSummary),
          );
          break;
        case "configurations.create": {
          const c = getService("runs").normalize({
            ...a.configuration,
            id: randomUUID(),
          });
          result = configSummary(manager().configs.upsert(c));
          break;
        }
        case "configurations.run":
          result = runSummary(
            await manager().start(config.id, a.projectId, group?.name || ""),
          );
          break;
        case "configurations.stop":
          result = runSummary(
            await manager().stop(run.id, a.force, { allowEscalation: false }),
          );
          break;
        case "configurations.restart":
          result = runSummary(
            await manager().restart(run.id, { allowEscalation: false }),
          );
          break;
        case "runs.list": {
          const permitted = manager()
            .list()
            .filter(
              (r) =>
                includes(client.scope.configurations, r.configurationId) &&
                includes(client.scope.hosts, r.host) &&
                projectAllowed(client, r.groupId || "", snapshot),
            );
          result = {
            items: (
              await Promise.all(
                permitted
                  .slice(a.offset, a.offset + a.limit)
                  .map((r) => manager().status(r.id)),
              )
            ).map(runSummary),
          };
          result.nextOffset =
            a.offset + a.limit < permitted.length ? a.offset + a.limit : null;
          break;
        }
        case "runs.read": {
          const out = await manager().poll(run.id, a.offset, a.generation);
          result = {
            ...out,
            output: Buffer.from(out.output)
              .subarray(0, 256 * 1024)
              .toString(),
            run: runSummary(out.run),
          };
          break;
        }
        case "projects.list":
          result = paged([
            ...library
              .read()
              .filter(
                (p) =>
                  includes(client.scope.projects, p.id) &&
                  p.tabs.every((t) => includes(client.scope.hosts, t.host)),
              )
              .map((p) => ({
                id: p.id,
                name: p.name,
                layout: p.layout,
                tabs: p.tabs.map((t) => ({
                  host: t.host,
                  directory: t.currentPath,
                  title: t.manualTitle,
                })),
                saved: true,
                revision: revision(p),
              })),
            ...snapshot.projects
              .filter(
                (p) =>
                  projectAllowed(client, p.id, snapshot) &&
                  snapshot.terminals
                    .filter((t) => t.projectId === p.id)
                    .every((t) => terminalAllowed(client, t, snapshot)),
              )
              .map((p) => ({ ...p, saved: false, revision: revision(p) })),
          ]);
          break;
        case "projects.create":
          result = library.upsert(
            normalizeProject({
              id: randomUUID(),
              name: a.name,
              tabs: a.tabs,
              layout: a.layout,
            }),
          );
          result = {
            id: result.id,
            name: result.name,
            revision: revision(result),
          };
          break;
        case "projects.open":
          result = await request(name, { project: saved });
          break;
        case "projects.remove":
          library.remove(saved.id);
          result = { removed: saved.id };
          break;
        case "projects.close":
          result = await request(name, a);
          break;
        case "layout.get":
          result = { ...group, revision: revision(group) };
          break;
        case "layout.set":
          result = await request(name, a);
          break;
        case "processes.list": {
          const data = await getService("processes").list(a.host);
          result = paged(
            data.processes.filter(
              (p) =>
                (!a.query ||
                  String(p.name)
                    .toLowerCase()
                    .includes(a.query.toLowerCase()) ||
                  String(p.pid).includes(a.query)) &&
                (!a.port || p.ports?.includes(a.port)),
            ),
          );
          break;
        }
      }
      if (d.mutates && name.startsWith("configurations."))
        getService("runs")?.changed?.();
      // A revoked client cannot retrieve output from a previously started operation.
      guard();
      if (receiptStarted)
        store.saveReceipt({
          id: receiptId,
          fingerprint,
          status: "completed",
          targetId: result?.id || result?.closed || result?.removed,
        });
      store.log({
        client: client.name,
        tool: name,
        target:
          a.terminalId ||
          a.configurationId ||
          a.runId ||
          a.savedProjectId ||
          a.projectId ||
          "",
        decision: needsApproval ? "approved" : "allowed",
        outcome: "completed",
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      if (receiptStarted)
        store.saveReceipt({
          id: receiptId,
          fingerprint,
          status: "outcome_unknown",
        });
      store.log({
        client: client.name,
        tool: name,
        decision: "denied_or_failed",
        outcome: error.code || "FAILED",
        durationMs: Date.now() - started,
      });
      throw error;
    }
  }
  // Serialize actions, including approvals, so two simultaneous writes cannot race.
  let queue = Promise.resolve();
  return {
    names,
    definitions,
    list(client) {
      return definitions
        .filter((d) => visible(d, client))
        .map((d) => ({
          name: d.name,
          description: d.description,
          inputSchema: zodToJsonSchema(d.schema, { target: "jsonSchema7" }),
          annotations: {
            readOnlyHint: !d.mutates,
            destructiveHint: d.mutates,
            openWorldHint: false,
          },
        }));
    },
    execute(...args) {
      const version = store.data.clients.find((c) => c.id === args[0])?.version;
      const work = queue.then(() => execute(...args, version));
      queue = work.catch(() => {});
      return work;
    },
  };
}
module.exports = { createTools, names, definitions, revision };
