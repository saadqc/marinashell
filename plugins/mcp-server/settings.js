const api = window.api;
const root = document.getElementById("mcp-controls");
let data;
let selected = "";
let busy = false;
const el = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
};
const error = document.getElementById("mcp-error");
async function call(name, args) {
  const result = await api.invoke(`plugin:mcp-server:${name}`, args);
  if (!result?.ok) throw new Error(result?.error || "Unable to update MCP");
  return result;
}
function button(text, fn) {
  const b = el("button", text);
  b.type = "button";
  b.onclick = async () => {
    b.disabled = true;
    error.textContent = "";
    try {
      await fn();
    } catch (e) {
      error.textContent = e.message;
    } finally {
      b.disabled = false;
    }
  };
  return b;
}
function check(text, checked) {
  const label = el("label", undefined, "mcp-check");
  const input = el("input");
  input.type = "checkbox";
  input.checked = checked;
  label.append(input, document.createTextNode(text));
  return { label, input };
}
function tokenView(token) {
  const box = document.getElementById("mcp-token");
  box.replaceChildren();
  const input = el("input");
  input.type = "password";
  input.readOnly = true;
  input.value = token;
  input.autocomplete = "off";
  box.append(
    el(
      "p",
      "Copy this token now. It is shown only once. Store it in your agent’s private settings.",
    ),
    input,
    button("Copy token", () => api.copyToClipboard(token)),
    button("Dismiss", () => {
      input.value = "";
      token = "";
      box.replaceChildren();
    }),
  );
}
function guide(url) {
  const holder = document.getElementById("mcp-guide");
  holder.replaceChildren();
  const details = el("details");
  details.append(el("summary", "Connect your agent"));
  details.append(
    el(
      "p",
      "1. Pair an agent above and copy its token. 2. Choose its allowed tools and scope, then save. 3. Start the server and add the connection below. Keep MarinaShell running on the same computer as your agent.",
    ),
  );
  const selector = el("select");
  for (const name of ["Codex", "Claude Code", "ZCode"])
    selector.add(new Option(name, name));
  const note = el("p");
  const pre = el("pre");
  const link = el("a", "Official setup guide");
  link.target = "_blank";
  link.rel = "noreferrer";
  function update() {
    if (selector.value === "Codex") {
      note.textContent =
        "Add this to your private Codex config.toml. Set MARINASHELL_MCP_TOKEN in the environment that launches Codex to the paired token.";
      pre.textContent = `[mcp_servers.marinashell]\nurl = "${url}"\nbearer_token_env_var = "MARINASHELL_MCP_TOKEN"\ntool_timeout_sec = 60`;
      link.href = "https://developers.openai.com/codex/mcp";
    } else if (selector.value === "Claude Code") {
      note.textContent =
        "Replace PAIRED_TOKEN and run this once. User scope stores the connection in your private Claude Code settings. Use /mcp to check the connection.";
      pre.textContent = `claude mcp add --transport http --scope user marinashell ${url} --header "Authorization: Bearer PAIRED_TOKEN"`;
      link.href = "https://code.claude.com/docs/en/mcp";
    } else {
      note.textContent =
        "In Settings → MCP, add an HTTP service named MarinaShell. Enter this URL and add the Authorization header under Headers. Replace PAIRED_TOKEN.";
      pre.textContent = `URL: ${url}\nAuthorization: Bearer PAIRED_TOKEN`;
      link.href = "https://zcode.z.ai/en/docs/mcp-services";
    }
  }
  selector.onchange = update;
  update();
  details.append(
    selector,
    note,
    pre,
    button("Copy setup", () => api.copyToClipboard(pre.textContent)),
    link,
    el(
      "p",
      "No tools listed? Save permissions and reconnect the agent. Connection refused? Start the server. Authentication failed? Use the current token; rotating or revoking a token invalidates the old one. Ask requests expire after 55 seconds.",
      "hint",
    ),
  );
  holder.append(details);
}
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const plugins = await api.getPlugins();
    const plugin = plugins.find((p) => p.id === "mcp-server");
    root.replaceChildren();
    if (!plugin?.enabled) {
      root.append(
        el(
          "p",
          "Allow paired agents to use selected terminals, projects and run configurations.",
        ),
        button("Enable MCP extension", () => {
          const toggle = document.querySelector(
            'input[data-plugin-id="mcp-server"]',
          );
          if (!toggle) throw new Error("Open Plugins and enable MCP server.");
          toggle.checked = true;
          toggle.dispatchEvent(new Event("change"));
        }),
      );
      guide("http://127.0.0.1:37651/mcp");
      return;
    }
    data = await call("status");
    guide(data.url);
    const top = el("div", undefined, "mcp-row");
    top.append(
      el("strong", data.state),
      el("code", data.url),
      button(data.state === "running" ? "Stop" : "Start", async () => {
        await call(data.state === "running" ? "stop" : "start");
        busy = false;
        await refresh();
      }),
    );
    root.append(top);
    if (data.error) root.append(el("p", data.error, "mcp-error"));
    const port = el("input");
    port.type = "number";
    port.min = "1024";
    port.max = "65535";
    port.value = data.settings.port;
    port.disabled = data.state === "running";
    port.setAttribute("aria-label", "MCP port");
    const restore = check(
      "Restore server state at startup",
      data.settings.restore,
    );
    const settings = el("div", undefined, "mcp-row");
    settings.append(
      el("span", "Port"),
      port,
      restore.label,
      button("Save server settings", async () => {
        await call("settings", {
          port: Number(port.value),
          restore: restore.input.checked,
        });
        busy = false;
        await refresh();
      }),
    );
    root.append(settings);
    const agentRow = el("div", undefined, "mcp-row");
    const agents = el("select");
    agents.setAttribute("aria-label", "Paired agent");
    for (const c of data.settings.clients) agents.add(new Option(c.name, c.id));
    if (data.settings.clients.some((c) => c.id === selected))
      agents.value = selected;
    selected = agents.value;
    agents.onchange = () => {
      selected = agents.value;
      renderPolicy();
    };
    const name = el("input");
    name.placeholder = "Agent name";
    name.maxLength = 80;
    name.setAttribute("aria-label", "New agent name");
    agentRow.append(
      agents,
      name,
      button("Pair agent", async () => {
        const result = await call("pair", { name: name.value });
        selected = result.id;
        tokenView(result.token);
        busy = false;
        await refresh();
      }),
    );
    root.append(agentRow);
    const policy = el("div", undefined, "mcp-policy");
    root.append(policy);
    function renderPolicy() {
      policy.replaceChildren();
      const client = data.settings.clients.find((c) => c.id === selected);
      if (!client) return;
      const actions = el("div", undefined, "mcp-row");
      actions.append(
        button("Rotate token", async () => {
          const result = await call("rotate", { id: client.id });
          tokenView(result.token);
        }),
        button("Revoke agent", async () => {
          await call("revoke", { id: client.id });
          document.getElementById("mcp-token").replaceChildren();
          busy = false;
          await refresh();
        }),
      );
      policy.append(actions);
      const controls = new Map();
      const presets = el("div", undefined, "mcp-row");
      presets.append(
        el("span", "Tool access"),
        button("Hide all", () => {
          for (const s of controls.values()) s.value = "hidden";
        }),
        button("Metadata only", () => {
          for (const [name, s] of controls)
            s.value = [
              "terminals.list",
              "configurations.list",
              "runs.list",
              "projects.list",
              "layout.get",
            ].includes(name)
              ? "allow"
              : "hidden";
        }),
        button("Ask before changes", () => {
          for (const [name, s] of controls)
            s.value = /\.(list|get)$/.test(name) ? "allow" : "ask";
        }),
      );
      policy.append(presets);
      const grid = el("div", undefined, "mcp-permissions");
      let previousGroup = "";
      for (const name of [...data.tools].sort((a, b) =>
        a.split(".")[0].localeCompare(b.split(".")[0]),
      )) {
        const group = name.split(".")[0];
        if (group !== previousGroup) {
          grid.append(el("h3", group[0].toUpperCase() + group.slice(1)));
          previousGroup = group;
        }
        const label = el(
          "label",
          name
            .replace(/^[^.]+\./, "")
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (c) => c.toUpperCase()),
        );
        label.title = name;
        const select = el("select");
        for (const value of ["hidden", "ask", "allow"])
          select.add(
            new Option(value[0].toUpperCase() + value.slice(1), value),
          );
        select.value = client.tools[name] || "hidden";
        select.setAttribute("aria-label", name);
        controls.set(name, select);
        label.append(select);
        grid.append(label);
      }
      policy.append(grid);
      policy.append(
        el(
          "p",
          "Create + Run permits code execution on allowed hosts. Terminal reads and screenshots may reveal sensitive output. Kill Port permits terminating the process listening on a configured port. Allow for Run is bound to the configuration as it exists when permissions are saved.",
          "hint",
        ),
      );
      const scopes = {};
      const scopeGrid = el("div", undefined, "mcp-scopes");
      const hosts = [
        { id: "__local__", name: "Local" },
        ...(data.hosts || []).map((h) => ({ id: h.alias, name: h.alias })),
      ];
      for (const [key, items] of [
        ["projects", data.projects],
        ["hosts", hosts],
        ["configurations", data.configurations],
      ]) {
        const field = el("fieldset");
        field.append(el("legend", key[0].toUpperCase() + key.slice(1)));
        const options = [
          { id: "*", name: `All ${key}, including future ones` },
          ...items,
        ];
        for (const id of client.scope[key])
          if (!options.some((o) => o.id === id))
            options.push({ id, name: `${id} (unavailable)` });
        scopes[key] = options.map((item) => {
          const c = check(item.name, client.scope[key].includes(item.id));
          field.append(c.label);
          return { id: item.id, input: c.input };
        });
        scopeGrid.append(field);
      }
      policy.append(scopeGrid);
      const scratch = check(
        "Allow Scratchpad (ungrouped terminals and runs)",
        client.scope.scratchpad,
      );
      policy.append(
        scratch.label,
        button("Save agent permissions", async () => {
          await call("policy", {
            id: client.id,
            tools: Object.fromEntries(
              [...controls].map(([k, s]) => [k, s.value]),
            ),
            scope: {
              ...Object.fromEntries(
                Object.entries(scopes).map(([k, rows]) => [
                  k,
                  rows.filter((r) => r.input.checked).map((r) => r.id),
                ]),
              ),
              scratchpad: scratch.input.checked,
            },
          });
          error.textContent = "Permissions saved.";
        }),
      );
    }
    renderPolicy();
    const activity = el("details");
    activity.append(el("summary", "Recent activity"));
    if (!data.activity.length) activity.append(el("p", "No tool calls yet."));
    for (const row of data.activity) {
      activity.append(
        el(
          "p",
          `${new Date(row.time).toLocaleTimeString()} · ${row.client} · ${row.tool} · ${row.outcome}`,
        ),
      );
    }
    root.append(
      activity,
      button("Refresh status", async () => {
        busy = false;
        await refresh();
      }),
    );
  } catch (e) {
    error.textContent = e.message;
  } finally {
    busy = false;
  }
}
api.onPluginsChanged(() => refresh());
refresh();
