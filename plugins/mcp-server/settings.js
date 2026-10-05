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
      const toolToggle = button("Check All", () => {
        const on = [...controls.values()].some(s => s.value !== "allow");
        for (const s of controls.values()) s.value = on ? "allow" : "hidden";
        syncToolToggle();
      });
      toolToggle.setAttribute("aria-label", "Check all tool permissions");
      function syncToolToggle() {
        toolToggle.textContent = [...controls.values()].every(s => s.value === "allow") ? "Uncheck All" : "Check All";
      }
      presets.append(
        el("span", "Tool access"),
        toolToggle,
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
          syncToolToggle();
        }),
        button("Ask before changes", () => {
          for (const [name, s] of controls)
            s.value = /\.(list|get)$/.test(name) ? "allow" : "ask";
          syncToolToggle();
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
        select.onchange = syncToolToggle;
        label.append(select);
        grid.append(label);
      }
      syncToolToggle();
      policy.append(grid);
      policy.append(
        el(
          "p",
          "Select the projects and configurations this agent can access. Allow runs the current configuration; Ask prompts before running. Future configuration access is separate from existing selections. Hosts, projects and Kill Port permissions still apply.",
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
      const future = check(
        "Allow agents to access all future configurations",
        client.scope.futureConfigurations === true || client.scope.configurations.includes("*"),
      );
      future.input.setAttribute("aria-label", "Allow agents to access all future configurations");
      future.label.classList.add("mcp-future-access");
      const knownConfigurations = new Map(data.configurations.map(c => [c.id, c.name]));
      const selectedProjects = new Set(client.scope.projects.includes("*")
        ? data.projects.map(p => p.id) : client.scope.projects);
      const selectedConfigurations = new Set([
        ...client.scope.configurations.filter(id => id !== "*"),
        ...data.configurations.filter(c => client.scope.configurations.includes("*") ||
          (client.scope.futureConfigurations === true && !(client.knownConfigurationIds || []).includes(c.id)))
          .map(c => c.id),
      ]);
      const projects = [...data.projects];
      for (const id of selectedProjects)
        if (!projects.some(p => p.id === id)) projects.push({ id, name: `${id} (unavailable)`, configurationIds: [] });
      const projectField = el("fieldset", undefined, "mcp-project-field");
      projectField.append(el("legend", "Projects and configurations"));
      const projectInputs = new Map();
      const configurationInputs = new Map();
      const list = el("div", undefined, "mcp-project-list");
      const allConfigurationIds = new Set([...knownConfigurations.keys(), ...selectedConfigurations]);
      const scopeToggle = button("Check All", () => {
        const on = !allSelected();
        for (const p of projects) on ? selectedProjects.add(p.id) : selectedProjects.delete(p.id);
        for (const id of allConfigurationIds) on ? selectedConfigurations.add(id) : selectedConfigurations.delete(id);
        syncSelections();
      });
      scopeToggle.setAttribute("aria-label", "Check all project and configuration access");
      projectField.append(scopeToggle);
      function allSelected() {
        return projects.every(p => selectedProjects.has(p.id)) &&
          [...allConfigurationIds].every(id => selectedConfigurations.has(id)) &&
          (projects.length > 0 || allConfigurationIds.size > 0);
      }
      function syncSelections() {
        for (const [id, input] of projectInputs) input.checked = selectedProjects.has(id);
        for (const [id, inputs] of configurationInputs)
          for (const input of inputs) input.checked = selectedConfigurations.has(id);
        scopeToggle.textContent = allSelected() ? "Uncheck All" : "Check All";
      }
      function configurationRow(id, project) {
        const row = check(knownConfigurations.get(id) || `${id} (unavailable)`, selectedConfigurations.has(id));
        row.label.classList.add("mcp-config-access");
        row.label.dataset.configurationId = id;
        row.input.setAttribute("aria-label", knownConfigurations.get(id) || id);
        row.input.onchange = () => {
          if (row.input.checked) {
            selectedConfigurations.add(id);
            if (project) selectedProjects.add(project.id);
          } else selectedConfigurations.delete(id);
          syncSelections();
        };
        const inputs = configurationInputs.get(id) || [];
        inputs.push(row.input);
        configurationInputs.set(id, inputs);
        if (!project) row.label.append(el("small", "No project", "mcp-config-note"));
        return row.label;
      }
      const linked = new Set();
      for (const project of projects) {
        const section = el("section", undefined, "mcp-project");
        section.dataset.projectId = project.id;
        const header = el("div", undefined, "mcp-project-header");
        const children = [...new Set(project.configurationIds || [])];
        const group = el("div", undefined, "mcp-project-configurations");
        group.id = `mcp-configurations-${project.id}`;
        const projectCheck = check(project.name, selectedProjects.has(project.id));
        projectCheck.input.setAttribute("aria-label", project.name);
        projectInputs.set(project.id, projectCheck.input);
        projectCheck.input.onchange = () => {
          const on = projectCheck.input.checked;
          on ? selectedProjects.add(project.id) : selectedProjects.delete(project.id);
          for (const id of children) on ? selectedConfigurations.add(id) : selectedConfigurations.delete(id);
          syncSelections();
        };
        const toggle = el("button", "▾", "mcp-project-toggle");
        toggle.type = "button";
        toggle.setAttribute("aria-label", `Toggle ${project.name} configurations`);
        toggle.setAttribute("aria-controls", group.id);
        toggle.setAttribute("aria-expanded", "true");
        toggle.onclick = () => {
          group.hidden = !group.hidden;
          toggle.textContent = group.hidden ? "▸" : "▾";
          toggle.setAttribute("aria-expanded", String(!group.hidden));
        };
        if (!children.length) { toggle.disabled = true; toggle.style.visibility = "hidden"; }
        for (const id of children) { linked.add(id); allConfigurationIds.add(id); group.append(configurationRow(id, project)); }
        header.append(toggle, projectCheck.label, el("small", `${children.length} configuration${children.length === 1 ? "" : "s"}`, "mcp-config-note"));
        section.append(header, group);
        list.append(section);
      }
      for (const id of allConfigurationIds)
        if (!linked.has(id)) list.append(configurationRow(id));
      if (!projects.length && !allConfigurationIds.size) list.append(el("p", "No projects or configurations yet.", "hint"));
      projectField.append(list);
      syncSelections();
      scopeGrid.append(projectField);
      policy.append(future.label, scopeGrid);
      const scratch = check(
        "Allow Scratchpad (ungrouped terminals and runs)",
        client.scope.scratchpad,
      );
      policy.append(
        scratch.label,
        button("Save agent permissions", async () => {
          const requested = {
            id: client.id,
            tools: Object.fromEntries(
              [...controls].map(([k, s]) => [k, s.value]),
            ),
            scope: {
              projects: [...selectedProjects],
              configurations: [...selectedConfigurations],
              futureConfigurations: future.input.checked,
              hosts: hostInputs
                .filter((r) => r.input.checked)
                .map((r) => r.id),
              scratchpad: scratch.input.checked,
            },
          };
          const saved = await call("policy", requested);
          const actual = saved.settings.clients.find(c => c.id === client.id);
          const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
          if (!actual || !Object.entries(requested.tools).every(([name, mode]) => actual.tools[name] === mode) ||
            !["projects", "configurations", "hosts"].every(key => sameSet(actual.scope[key], requested.scope[key])) ||
            actual.scope.futureConfigurations !== requested.scope.futureConfigurations ||
            actual.scope.scratchpad !== requested.scope.scratchpad)
            throw new Error("Saved permissions do not match your selections. Refresh and try again.");
          data = saved;
          await refresh();
          message(`Permissions saved for ${client.name}. Reconnect your agent to refresh its tool list.`);
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
      for (const title of ["Time", "Agent", "Tool", "Outcome", "Details"]) { const th = el("th", title); th.scope = "col"; head.append(th); }
      const thead = el("thead"); thead.append(head); table.append(thead);
      const body = el("tbody");
      for (const row of data.activity) {
        const tr = el("tr");
        for (const text of [new Date(row.time).toLocaleString(), row.client, row.tool, row.outcome, [row.target, row.reason].filter(Boolean).join(": ")]) tr.append(el("td", text));
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
