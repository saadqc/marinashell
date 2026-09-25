import { modal, button } from "../components/dialog.js";

// Only the main-process broker can send these fixed operations. No eval or channel forwarding.
export function installMcpBridge({
  api,
  state,
  sessionTabs,
  persistenceService,
}) {
  const cancellations = new Map();
  const metadata = (tab) => ({
    id: tab.id,
    projectId: tab.groupId || "",
    host: tab.host || "__local__",
    title: tab.manualTitle || "",
    directory: tab.currentPath,
    readOnly: Boolean(tab.readOnly),
    runId: tab.runId || "",
  });
  const snapshot = () => ({
    terminals: [...state.tabs.values()].map(metadata),
    projects: state.appState.tabGroups.map((group) => ({
      id: group.id,
      savedGroupId: group.savedGroupId || "",
      name: group.name,
      layout: group.layout || "1x1",
      configurationIds: [...(group.configurationIds || [])],
      terminalIds: [...state.tabs.values()]
        .filter((t) => t.groupId === group.id)
        .map((t) => t.id),
    })),
  });
  const stamp = () => JSON.stringify(snapshot());
  api.onMcpCancel(({ id }) => cancellations.get(id)?.());
  api.onMcpRequest(async ({ id, action, args }) => {
    let cancelled = false;
    cancellations.set(id, () => {
      cancelled = true;
    });
    try {
      if (args.stamp && args.stamp !== stamp())
        throw new Error("REVISION_CONFLICT: workspace changed");
      let value;
      const tab = args.terminalId ? state.tabs.get(args.terminalId) : null;
      if (args.terminalId && !tab) throw new Error("TARGET_GONE");
      if (action === "snapshot") value = { ...snapshot(), stamp: stamp() };
      else if (action === "approve") {
        value = await new Promise((resolve) => {
          const view = modal(`${args.client} requests access`);
          const pre = document.createElement("pre");
          pre.style.cssText =
            "white-space:pre-wrap;overflow-wrap:anywhere;max-height:45vh;overflow:auto";
          pre.textContent = `${args.tool}\n\n${JSON.stringify(args.arguments, null, 2)}`;
          view.body.append(pre);
          const finish = (allowed) => {
            resolve(allowed);
            view.close();
          };
          view.footer.append(
            button("Deny", () => finish(false)),
            button("Allow once", () => finish(true)),
          );
          view.dialog.addEventListener("cancel", () => resolve(false));
          cancellations.set(id, () => {
            cancelled = true;
            finish(false);
          });
        });
      } else if (action === "terminals.read") {
        const buffer = tab.term.buffer.active;
        let start = Math.max(0, buffer.length - args.lastN);
        let reset = false;
        if (args.cursor) {
          try {
            const cursor = JSON.parse(args.cursor);
            if (
              cursor.offset > buffer.length ||
              cursor.anchor !==
                buffer.getLine(cursor.offset - 1)?.translateToString(true)
            )
              reset = true;
            else start = cursor.offset;
          } catch {
            reset = true;
          }
        }
        const lines = [];
        let bytes = 0;
        let end = start;
        for (; end < buffer.length && lines.length < args.lastN; end++) {
          const line = buffer.getLine(end)?.translateToString(true) || "";
          const size = new TextEncoder().encode(line).length + 1;
          if (bytes + size > 256 * 1024) break;
          lines.push(line);
          bytes += size;
        }
        value = {
          terminalId: tab.id,
          text: lines.join("\n"),
          reset,
          hasMore: end < buffer.length,
          cursor: JSON.stringify({
            offset: end,
            anchor: buffer.getLine(end - 1)?.translateToString(true),
          }),
        };
      } else if (action === "terminals.create") {
        const created = sessionTabs.createTabState({
          host: args.host,
          groupId: args.projectId || "",
          currentPath: args.directory,
          manualTitle: args.title,
        });
        sessionTabs.renderSessionTabs();
        sessionTabs.updateTerminalGrid();
        persistenceService.persistTabs();
        await sessionTabs.connectTab(created, args.host, {
          restorePath: args.directory,
        });
        value = metadata(created);
      } else if (action === "terminals.close") {
        if (tab.runId)
          throw new Error(
            "Stop and close managed run output in MarinaShell first.",
          );
        await sessionTabs.closeTab(tab.id, { approved: true });
        value = { closed: tab.id };
      } else if (action === "projects.open") {
        value = await sessionTabs.savedGroups.restore(args.project, {
          focus: false,
        });
        persistenceService.persistTabs();
      } else if (action === "projects.close") {
        const members = [...state.tabs.values()].filter(
          (t) => t.groupId === args.projectId,
        );
        if (members.some((t) => t.runId))
          throw new Error("Close managed run output in MarinaShell first.");
        for (const member of members)
          await sessionTabs.closeTab(member.id, { approved: true });
        value = { closed: args.projectId };
      } else if (action === "layout.set") {
        sessionTabs.setGroupLayout(args.projectId, args.layout);
        value = snapshot().projects.find((p) => p.id === args.projectId);
      } else if (action === "screenshots.rect") {
        if (
          document.querySelector("dialog[open]") ||
          [...document.querySelectorAll('input[type="password"]')].some(
            (input) => input.getClientRects().length,
          ) ||
          document.visibilityState !== "visible"
        )
          throw new Error(
            "Capture is unavailable while a dialog is open or the window is hidden.",
          );
        const rect = tab.container.getBoundingClientRect();
        if (
          rect.width < 2 ||
          rect.height < 2 ||
          rect.x < 0 ||
          rect.y < 0 ||
          rect.right > innerWidth ||
          rect.bottom > innerHeight
        )
          throw new Error("Show the terminal before capturing it.");
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        );
        if (!hit || !tab.container.contains(hit))
          throw new Error("Terminal is obscured.");
        value = {
          x: Math.ceil(rect.x),
          y: Math.ceil(rect.y),
          width: Math.floor(rect.width) - 1,
          height: Math.floor(rect.height) - 1,
        };
      } else throw new Error("Unsupported MCP operation");
      if (!cancelled) api.respondMcpRequest({ id, value });
    } catch (error) {
      if (!cancelled) api.respondMcpRequest({ id, error: error.message });
    } finally {
      cancellations.delete(id);
    }
  });
}
