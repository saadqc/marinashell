# MarinaShell v0.2.15

- The Layout dropdown in the terminal pane header opens reliably again — a click could be silently canceled when the menu changed panes mid-press.

# MarinaShell v0.2.14

- Layout changes finally land where you expect: saving an already-open project applies its layout to your live terminals immediately, and the project-settings ellipsis no longer sneaks you into the New-project editor when your session has no project.
- The command palette (⌘K) has a Close button.

# MarinaShell v0.2.13

- Run configurations now group uvicorn and uv servers in their own sections with dedicated icons (plus a "uv run" template), and every configuration lists its projects underneath its name — no more guessing which "Backend" is which, in the editor or the launcher.
- Fixed the interpreter file picker: it opens in the current interpreter's folder, keeps your selection even if the form refreshes while the dialog is open, and never leaks a late pick into another configuration.
- Fixed new projects not showing up in the left project rail (they were rendered below its hidden overflow); the active project now scrolls into view.
- The MCP server accepts desktop agents that send CORS preflights or a single Accept header; authentication and the Host-based DNS-rebinding guard are unchanged.

# MarinaShell v0.2.12

- Agents can authenticate with a fixed password you choose — pair a new agent with your own password or set one on an existing agent; stored encrypted, replacing one invalidates the old credential immediately.
- The agent scope editor nests configurations under their project in a tree (the standalone Configurations block is gone): checking a project selects its whole branch, individual configurations stay toggleable.
- Project→configuration links read from the live workspace, so configurations linked after saving a project no longer appear as unassigned.
