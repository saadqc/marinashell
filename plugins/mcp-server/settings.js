const api = window.api;
const root = document.getElementById("mcp-controls");
const error = document.getElementById("mcp-error");
let data;
let selected = "";
let activeTab = "agents";
let working = false;
let refreshing;
const el = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
};
function message(text, failed = false) {
  error.textContent = text;
  error.classList.toggle("mcp-error", failed);
}
async function call(name, args) {
  const result = await api.invoke(`plugin:mcp-server:${name}`, args);
  if (!result?.ok) throw new Error(result?.error || "Unable to update agent access");
  return result;
}
function button(text, fn, className) {
  const b = el("button", text, className);
  b.type = "button";
  b.onclick = async () => {
    if (working) return;
    working = true;
    b.disabled = true;
    message("");
    try { await fn(); }
    catch (e) { message(e.message, true); }
    finally { working = false; b.disabled = false; }
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
function field(text, input) {
  const label = el("label", text, "mcp-field");
  label.append(input);
  return label;
}
function passwordInput(label) {
  const input = el("input");
  input.type = "password";
  input.maxLength = 128;
  input.minLength = 8;
  input.pattern = "[!-~]{8,128}";
  input.autocomplete = "new-password";
  input.setAttribute("aria-label", label);
  input.title = "8–128 letters, digits or symbols, with no spaces.";
  return input;
}
function tabs() {
  const nav = el("div", undefined, "mcp-tabs");
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-label", "Agent settings");
  const panels = {};
  const buttons = [];
  const entries = [["agents", "Agents"], ["permissions", "Permissions"], ["connection", "Connection"], ["activity", "Activity"]];
  function show(id, focus = false) {
    activeTab = id;
    for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== id;
    for (const b of buttons) {
      const on = b.dataset.tab === id;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
  }
  for (const [index, [id, title]] of entries.entries()) {
    const b = el("button", title);
    b.type = "button";
    b.dataset.tab = id;
    b.id = `mcp-tab-${id}`;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", `mcp-panel-${id}`);
    b.onclick = () => show(id);
    b.onkeydown = event => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % entries.length;
      if (event.key === "ArrowLeft") next = (index + entries.length - 1) % entries.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = entries.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      show(entries[next][0], true);
    };
    const panel = el("div", undefined, "mcp-panel");
    panel.id = `mcp-panel-${id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", b.id);
    panels[id] = panel;
    buttons.push(b);
    nav.append(b);
  }
  root.append(nav, ...Object.values(panels));
  show(activeTab);
  return { panels, show };
}
function connection(panel, url) {
  panel.append(el("h3", "Server settings"));
  const port = el("input");
  port.type = "number";
  port.min = "1024";
  port.max = "65535";
  port.value = data.settings.port;
  port.disabled = data.state === "running";
  port.setAttribute("aria-label", "MCP port");
  const restore = check("Restore server state at startup", data.settings.restore);
  const settings = el("div", undefined, "mcp-row");
  settings.append(field("Port", port), restore.label,
    button("Save server settings", async () => {
      if (!port.reportValidity()) return;
      await call("settings", { port: Number(port.value), restore: restore.input.checked });
      await refresh();
      message("Server settings saved.");
    }));
  panel.append(settings, el("p", "Stop the server before changing the port. Keep MarinaShell running on the same computer as your agent.", "hint"));
  const guide = el("div");
  guide.id = "mcp-guide";
  guide.append(el("h3", "Connect an agent"), el("p", "Add an HTTP MCP server in your agent’s settings. Copy a credential from the Agents tab and use it as the bearer token."));
  const pre = el("pre", `URL: ${url}\nAuthorization: Bearer <token or password>`);
  guide.append(pre, button("Copy connection details", () => api.copyToClipboard(pre.textContent)),
    el("p", "Connection refused: start the server. Authentication failed: copy the current credential. No tools listed: save the agent’s Permissions and reconnect. Rotating a token or setting a password immediately invalidates the previous credential.", "hint"));
  panel.append(guide);
}
async function load() {
  try {
    const plugins = await api.getPlugins();
    const plugin = plugins.find(p => p.id === "mcp-server");
    if (!plugin?.enabled) {
      root.replaceChildren(el("p", "Enable agent access to create agents and connect them to MarinaShell."),
        button("Enable agent access", () => {
          const toggle = document.querySelector('input[data-plugin-id="mcp-server"]');
          if (!toggle) throw new Error("Open Plugins and enable MCP server.");
          toggle.checked = true;
          toggle.dispatchEvent(new Event("change"));
          message("Enabling agent access…");
        }));
      return;
    }
    data = await call("status");
    root.replaceChildren();
    if (!data.settings.clients.some(c => c.id === selected)) selected = data.settings.clients[0]?.id || "";
    const top = el("div", undefined, "mcp-server-bar");
    const state = el("strong", data.state === "running" ? "Server running" : `Server ${data.state}`);
    state.className = data.state === "running" ? "mcp-running" : "";
    top.append(state, el("code", data.url), button("Copy URL", () => api.copyToClipboard(data.url)),
      button(data.state === "running" ? "Stop server" : "Start server", async () => {
        await call(data.state === "running" ? "stop" : "start");
        await refresh();
      }));
    root.append(top);
    if (data.error) root.append(el("p", data.error, "mcp-error"));
    const { panels, show } = tabs();
    const form = el("form", undefined, "mcp-create-form");
    const name = el("input");
    name.type = "text";
    name.required = true;
    name.maxLength = 80;
    name.placeholder = "e.g. Development agent";
    name.autocomplete = "off";
    name.setAttribute("aria-label", "Agent name");
    const password = passwordInput("Optional password");
    password.placeholder = "Leave blank to generate a token";
    const create = button("Create agent", async () => {
      if (!form.reportValidity()) return;
      const result = await call("pair", { name: name.value, password: password.value || undefined });
      selected = result.id;
      password.value = "";
      await refresh();
      message("Agent created. Copy its credential, then choose its tools and scope in Permissions.");
    }, "mcp-primary");
    form.onsubmit = event => { event.preventDefault(); create.click(); };
    form.append(field("Agent name", name), field("Password (optional)", password), create);
    panels.agents.append(form, el("p", "Leave the password blank to generate a token, or use 8–128 characters with no spaces. Credentials stay encrypted and can be copied again later.", "hint"));
    const holder = el("div", undefined, "mcp-table-wrap");
    const table = el("table", undefined, "mcp-agent-table");
    const caption = el("caption", `Agents (${data.settings.clients.length})`);
    const head = el("thead");
    const headings = el("tr");
    for (const text of ["Agent name", "Access", "Token / password", "Actions"]) {
      const th = el("th", text); th.scope = "col"; headings.append(th);
    }
    head.append(headings);
    const body = el("tbody");
    for (const client of data.settings.clients) {
      const row = el("tr");
      row.dataset.agentId = client.id;
      const title = el("th", client.name); title.scope = "row";
      const access = Object.values(client.tools).filter(mode => mode !== "hidden").length;
      const hasScope = client.scope.scratchpad || client.scope.projects.length || client.scope.configurations.length;
      const accessCell = el("td");
      accessCell.append(el("span", access ? `${access} ${access === 1 ? "tool" : "tools"} enabled` : "No tools enabled"));
      if (access && (!hasScope || !client.scope.hosts.length)) accessCell.append(el("small", "Scope incomplete"));
      const credential = el("td");
      const token = el("div", undefined, "mcp-credential");
      const masked = el("code", "••••••••••••");
      masked.setAttribute("aria-label", "Credential hidden");
      token.append(masked, button("Copy", async () => {
        const result = await call("credential", { id: client.id });
        await api.copyToClipboard(result.token);
        message(`Credential copied for ${client.name}.`);
      }));
      credential.append(token, el("small", client.credentialType === "password" ? "Custom password" : client.credentialType === "token" ? "Generated token" : "Saved credential"));
      const actions = el("td");
      const actionRow = el("div", undefined, "mcp-agent-actions");
      const editRow = el("tr"); editRow.hidden = true;
      const editCell = el("td"); editCell.colSpan = 4; editRow.append(editCell);
      actionRow.append(button("Permissions", () => {
        selected = client.id;
        agents.value = selected;
        renderPolicy();
        show("permissions", true);
      }), button("Rotate", async () => {
        await call("rotate", { id: client.id });
        await refresh();
        message(`Token rotated for ${client.name}. Copy it and update your agent’s connection.`);
      }), button("Set password", () => {
        editCell.replaceChildren();
        const passwordForm = el("form", undefined, "mcp-password-form");
        const value = passwordInput(`New password for ${client.name}`); value.required = true;
        const save = button("Save password", async () => {
          if (!passwordForm.reportValidity()) return;
          await call("password", { id: client.id, password: value.value });
          value.value = "";
          await refresh();
          message(`Password updated for ${client.name}. Update your agent’s connection.`);
        }, "mcp-primary");
        passwordForm.onsubmit = event => { event.preventDefault(); save.click(); };
        passwordForm.append(field(`New password for ${client.name}`, value), save, button("Cancel", () => { value.value = ""; editRow.hidden = true; }));
        editCell.append(passwordForm, el("p", "Use 8–128 letters, digits or symbols, with no spaces. Saving invalidates the current credential.", "hint"));
        editRow.hidden = false;
        value.focus();
      }), button("Revoke", () => {
        editCell.replaceChildren(el("p", `Revoke ${client.name}? Its credential will stop working.`),
          button("Revoke agent", async () => {
            await call("revoke", { id: client.id });
            await refresh();
            message(`Agent ${client.name} revoked.`);
          }, "mcp-danger"), button("Cancel", () => { editRow.hidden = true; }));
        editRow.hidden = false;
      }));
      actions.append(actionRow);
      row.append(title, accessCell, credential, actions);
      body.append(row, editRow);
    }
    if (!data.settings.clients.length) {
      const row = el("tr"); const cell = el("td", "No agents yet. Create your first agent above.", "mcp-empty");
      cell.colSpan = 4; row.append(cell); body.append(row);
    }
    table.append(caption, head, body); holder.append(table); panels.agents.append(holder);
    const agents = el("select");
    agents.setAttribute("aria-label", "Agent permissions");
    for (const c of data.settings.clients) agents.add(new Option(c.name, c.id));
    agents.value = selected;
    agents.onchange = () => { selected = agents.value; renderPolicy(); };
    panels.permissions.append(field("Agent", agents));
    const policy = el("div", undefined, "mcp-policy");
    panels.permissions.append(policy);
    function renderPolicy() {
      policy.replaceChildren();
      const client = data.settings.clients.find(c => c.id === selected);
      if (!client) { policy.append(el("p", "Create an agent in the Agents tab to configure permissions.")); return; }
      policy.append(el("p", "Choose tool access and the hosts, projects or Scratchpad this agent can use. Save permissions when you’re done.", "hint"));
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
      const scopeGrid = el("div", undefined, "mcp-scopes");
      const hosts = [
        { id: "__local__", name: "Local" },
        ...(data.hosts || []).map((h) => ({ id: h.alias, name: h.alias })),
      ];
      const hostField = el("fieldset");
      hostField.append(el("legend", "Hosts"));
      const hostOptions = [
        { id: "*", name: "All hosts, including future ones" },
        ...hosts,
      ];
      for (const id of client.scope.hosts)
        if (!hostOptions.some((o) => o.id === id))
          hostOptions.push({ id, name: `${id} (unavailable)` });
      const hostInputs = hostOptions.map((item) => {
        const c = check(item.name, client.scope.hosts.includes(item.id));
        hostField.append(c.label);
        return { id: item.id, input: c.input };
      });
      scopeGrid.append(hostField);
      // Projects tree: every project carries its run configurations, so the
      // standalone Configurations block is gone. The project checkbox selects
      // or clears its whole branch; individual configurations stay toggleable.
      const projectField = el("fieldset");
      projectField.append(el("legend", "Projects"));
      const allProjects = check(
        "All projects, including future ones",
        client.scope.projects.includes("*"),
      );
      projectField.append(allProjects.label);
      const allConfigurations = check(
        "All configurations, including future ones",
        client.scope.configurations.includes("*"),
      );
      projectField.append(allConfigurations.label);
      const knownConfigurations = new Map(
        data.configurations.map((c) => [c.id, c.name]),
      );
      const linked = new Set(
        data.projects.flatMap((p) => p.configurationIds || []),
      );
      const branches = [
        ...data.projects.map((p) => ({
          id: p.id,
          name: p.name,
          children: [...new Set(p.configurationIds || [])],
          project: true,
        })),
        {
          id: "__unassigned__",
          name: "Unassigned configurations",
          children: [
            ...data.configurations
              .filter((c) => !linked.has(c.id))
              .map((c) => c.id),
            ...client.scope.configurations.filter(
              (id) =>
                id !== "*" &&
                !knownConfigurations.has(id) &&
                !linked.has(id),
            ),
          ],
          project: false,
        },
        ...client.scope.projects
          .filter(
            (id) => id !== "*" && !data.projects.some((p) => p.id === id),
          )
          .map((id) => ({
            id,
            name: `${id} (unavailable)`,
            children: [],
            project: true,
          })),
      ];
      const selectedProjects = new Set(
        client.scope.projects.filter((id) => id !== "*"),
      );
      const selectedConfigurations = new Set(
        client.scope.configurations.filter((id) => id !== "*"),
      );
      const projectInputs = new Map();
      const configurationInputs = new Map();
      const tree = el("div", undefined, "mcp-tree");
      function refreshTree() {
        for (const [id, rows] of configurationInputs) {
          const on =
            allConfigurations.input.checked || selectedConfigurations.has(id);
          for (const input of rows) {
            input.checked = on;
            input.disabled = allConfigurations.input.checked;
            input.indeterminate = false;
          }
        }
        for (const [id, row] of projectInputs) {
          const all = row.children.every((cid) =>
            selectedConfigurations.has(cid),
          );
          if (row.project) {
            const inScope = selectedProjects.has(id);
            row.input.checked = inScope && all;
            row.input.indeterminate =
              row.children.length > 0 && inScope !== all;
          } else {
            row.input.checked = row.children.length > 0 && all;
            row.input.indeterminate =
              !row.input.checked &&
              row.children.some((cid) => selectedConfigurations.has(cid));
          }
        }
      }
      for (const branch of branches) {
        const row = el("div", undefined, "mcp-tree-row");
        const label = el("label", undefined, "mcp-tree-label");
        const input = el("input");
        input.type = "checkbox";
        input.setAttribute("aria-label", branch.name);
        label.append(input, document.createTextNode(branch.name));
        const arrow = el("button", "▾", "mcp-tree-arrow");
        arrow.type = "button";
        arrow.setAttribute("aria-label", `Toggle ${branch.name} configurations`);
        const childBox = el("div", undefined, "mcp-tree-children");
        for (const childId of branch.children) {
          const childLabel = el("label", undefined, "mcp-tree-label");
          const child = el("input");
          child.type = "checkbox";
          child.setAttribute(
            "aria-label",
            knownConfigurations.get(childId) || childId,
          );
          childLabel.append(
            child,
            document.createTextNode(
              knownConfigurations.get(childId) || `${childId} (unavailable)`,
            ),
          );
          child.onchange = () => {
            if (child.checked) selectedConfigurations.add(childId);
            else selectedConfigurations.delete(childId);
            refreshTree();
          };
          childBox.append(childLabel);
          const rows = configurationInputs.get(childId) || [];
          rows.push(child);
          configurationInputs.set(childId, rows);
        }
        if (branch.children.length) {
          arrow.onclick = () => {
            childBox.hidden = !childBox.hidden;
            arrow.textContent = childBox.hidden ? "▸" : "▾";
          };
        } else {
          arrow.style.visibility = "hidden";
        }
        row.append(arrow, label);
        input.onchange = () => {
          const turnOn = input.indeterminate ? true : input.checked;
          if (turnOn) {
            if (branch.project) selectedProjects.add(branch.id);
            for (const childId of branch.children)
              selectedConfigurations.add(childId);
          } else {
            selectedProjects.delete(branch.id);
            for (const childId of branch.children)
              selectedConfigurations.delete(childId);
          }
          refreshTree();
        };
        projectInputs.set(branch.id, {
          input,
          children: branch.children,
          project: branch.project,
        });
        tree.append(row, childBox);
      }
      projectField.append(tree);
      allConfigurations.input.onchange = refreshTree;
      refreshTree();
      scopeGrid.append(projectField);
      policy.append(scopeGrid);
      const scratch = check(
        "Allow Scratchpad (ungrouped terminals and runs)",
        client.scope.scratchpad,
      );
      policy.append(
        scratch.label,
        button("Save agent permissions", async () => {
          data = await call("policy", {
            id: client.id,
            tools: Object.fromEntries(
              [...controls].map(([k, s]) => [k, s.value]),
            ),
            scope: {
              projects: [
                ...(allProjects.input.checked ? ["*"] : []),
                ...[...selectedProjects],
              ],
              configurations: [
                ...(allConfigurations.input.checked ? ["*"] : []),
                ...[...selectedConfigurations],
              ],
              hosts: hostInputs
                .filter((r) => r.input.checked)
                .map((r) => r.id),
              scratchpad: scratch.input.checked,
            },
          });
          await refresh();
          message("Permissions saved. Reconnect your agent to refresh its tool list.");
        }),
      );
    }
    renderPolicy();
    connection(panels.connection, data.url);
    panels.activity.append(el("h3", "Recent activity"));
    if (!data.activity.length) panels.activity.append(el("p", "No tool calls yet."));
    else {
      const table = el("table", undefined, "mcp-agent-table");
      const head = el("tr");
      for (const title of ["Time", "Agent", "Tool", "Outcome"]) { const th = el("th", title); th.scope = "col"; head.append(th); }
      const thead = el("thead"); thead.append(head); table.append(thead);
      const body = el("tbody");
      for (const row of data.activity) {
        const tr = el("tr");
        for (const text of [new Date(row.time).toLocaleString(), row.client, row.tool, row.outcome]) tr.append(el("td", text));
        body.append(tr);
      }
      table.append(body);
      const wrap = el("div", undefined, "mcp-table-wrap"); wrap.append(table); panels.activity.append(wrap);
    }
    root.append(button("Refresh status", refresh, "mcp-refresh"));
  } catch (e) { message(e.message, true); throw e; }
}
function refresh() {
  if (refreshing) return refreshing;
  refreshing = load().finally(() => { refreshing = null; });
  return refreshing;
}
api.onPluginsChanged(() => refresh().catch(() => {}));
refresh().catch(() => {});
