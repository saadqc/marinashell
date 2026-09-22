# Changelog

## v0.2.10 — 2026-09-22

- Fixed the “Settings access only” error when opening Agent access from the Settings navigation. Pairing, token creation, and MCP server controls now remain available after switching sections.
- Moved pairing and token controls above the agent setup guide.
- Retained Settings-only access checks and added a regression test for section navigation.


## v0.2.9 — 2026-09-22

- Redesigned the workspace with compact tabs, project navigation, a unified terminal toolbar, and a clearer run-configuration editor.
- Saved projects restore directories across local and SSH sessions with their split layout. Removed stale group entries and added cleanup in Settings.
- Added independent tunnel profiles and fixed migration from older host-grouped profiles.
- Added a process viewer with name/port filters, usage sorting, normal stop, and confirmed force stop.
- File menus now open files in the editor or an always-on-top Logs viewer with optional continuous following.
- Added port cleanup before run/restart and an optional MCP server with configurable agent permissions and setup guides.
- Added configurable tab navigation, command search, and Editor/Terminal shortcuts. Cmd/Ctrl+E selects Editor, Cmd/Ctrl+T selects Terminal, and Cmd/Ctrl+Alt+T creates a terminal.
- Links require Cmd+click on macOS or Ctrl+click elsewhere. Disconnected sessions reconnect to their existing host and directory.


## v0.2.8 — 2026-09-18

- Launching a run configuration no longer opens a terminal tab; runs show in a status chip and output views open on demand.
- One output view per configuration, shown as compact run tabs in the terminal pane header and hidden from the session-tab strip.
- Terminal links detect absolute file paths (`path:line` supported) and open them in the CodeMirror editor; local files need no terminal session.
- Environment picker filtered by the selected environment manager.
- Stale environment manager paths fall back to `PATH` lookup at launch.
- The configuration dropdown groups configurations under every matching tab group.

## v0.2.7 — 2026-09-18

- Before-run setup scripts (`bash`/`zsh`) apply exported variables to a run; `.autoenv.zsh`-style files work directly.
- Group defaults: save a configuration's paths, interpreter, and env sources per tab group and apply them to new configurations with one click.
- Detect also scans the working directory for project hints and offers them as suggestions.

## v0.2.7 — 2026-09-18

- Run configurations gained **Before run — setup scripts**: pick shell scripts (bash or zsh per row) that run before launch. Only the variables a script exports are applied — captured by snapshotting the environment before and after in the script's own shell, so `source`-based activation files like `.autoenv.zsh` work unchanged. Later scripts override earlier ones; variables edited under Environment variables still win. The launch header reports applied counts or the script's exit status and stderr tail, never values, and a failing script does not block the launch.
- **Group defaults** for run configurations: save a configuration's working directory, interpreter/manager, `.env` files, setup scripts, and environment choice as defaults for a tab group (stored in `~/.marinashell/run-group-defaults.json`, never in the project). New configurations created from a tab of that group are prefilled, and the editor can re-apply saved defaults.
- **Detect** now also offers project suggestions — entry-point directories for the working directory, `.autoenv*`/`.envrc`/`.env` files, and a project-local `.venv` interpreter — as click-to-apply chips.
- A stored conda-family manager name that disagrees with its executable (e.g. micromamba pointing at a mamba binary) now resolves to the binary so the correct wrapper flags are used.

## v0.2.6 — 2026-09-12

- The session tab bar now spans the full window width, above the sidebar and workspace.
- Tabs use smaller text, tighter padding and spacing, and smaller close icons.
- Choose **Scroll horizontally** or **Wrap onto multiple rows** in **Settings → UI → Tab overflow**. Horizontal scrolling is the default and supports the mouse wheel.
- Grouped tabs wrap too, and switching tabs keeps the active tab visible.
- Terminal panes refit when tabs wrap, the sidebar changes size, or a new terminal first renders.
- Updated the README screenshot with fictional demo data and kept personal email addresses out of package metadata.

## v0.2.5 — 2026-09-11

- Restored the original dark blue palette across the workspace, terminal, run configurations, dialogs, settings, and editor.
- Kept the compact layout, JetBrains fonts, configuration icons, detailed launch logging, and saved-group fixes introduced in v0.2.4.

## v0.2.4 — 2026-09-11

- Applied neutral charcoal surfaces throughout the workspace, sidebar, buttons, dialogs, settings, and editor, with PyCharm-style selection accents, compact configuration fields, and bundled JetBrains fonts and configuration icons.
- Run output now starts with the command, working directory, environment/source file paths, environment manager, and resolved interpreter path. Environment variable values are omitted from the launch header.
- Repeated group saves update the existing snapshot. Older snapshots are selectable under one group name, and restoring an already-open snapshot focuses its group.
- Removed empty leftover groups from configuration membership choices and reduced group row spacing.

## v0.2.3 — 2026-09-09

- Fixed Run Configuration output being clipped underneath the status bar, including after resizing the window.

## v0.2.2 — 2026-09-07

- Fixed terminal paste being sent twice when using Cmd/Ctrl+V.

## v0.2.1 — 2026-09-06

Save a project workspace for later, and launch Python, JavaScript, or shell workloads with reusable run configurations across local and SSH hosts.

### Saved group library

- Save and update independent snapshots of a group from its context menu.
- Restore saved groups from the **Saved groups** button beside **New group**, even after closing the original group.
- Preserve group and tab names, tab order and colors, hosts, working directories, grid layout, and configuration links.
- Delete saved snapshots without affecting open groups. Restoring configuration tabs does not automatically start their processes.

### New bundled Run Configurations plugin

- Ships **disabled by default**. Enable **run-configurations** in **Settings → Plugins** to show the configuration toolbar.
- Create configurations from Python script/module, Celery, Uvicorn, Flask, Node.js script/module, npm script, and shell script/command templates.
- Select local or SSH execution, an interpreter, arguments, and a working directory.
- Detect common interpreters, conda/mamba/micromamba environments, pyenv versions, and nvm installations, or enter custom paths.
- Load `.env` files from the execution host, create new `.env` files, or edit variables in a dedicated modal. Explicit variables override values from files.
- Source a custom shell startup file before running shell scripts or commands.
- Duplicate configurations and optionally link them to workspace groups. Libraries are stored under `~/.marinashell/`.

### Run, restart, stop, and reconnect

- Read-only output tabs provide live output, selection, copy, search, and exit status.
- Single-instance configurations focus their existing run; **Allow multiple instances** creates a separate output tab for each launch.
- Restart replaces the selected instance. Stop requests shutdown; pressing Stop again force-kills its managed job.
- Closing a running tab or group asks for confirmation and keeps the output view open until termination is confirmed.
- Persist run identity, process-group information, status, and bounded output logs for recovery. Disconnected or unverifiable runs show **status unknown** instead of being assumed stopped.
- Optional SSH **Run in tmux** is off by default and requires the installed/enabled tmux plugin and tmux on the SSH host. Named sessions are reused with a dedicated window per run, so reconnecting can recover the existing run and output without launching a duplicate.

### Workspace cleanup and reliability

- Removed the old **Commands** and **Transfers** sections from Actions. Port forwarding stays in Actions; file transfers remain available through the file tree and status area.
- Added explicit plugin opt-in support and fixed SSH password prompts appearing behind configuration dialogs.
- Added process, Electron workspace, plugin activation, and isolated SSH/tmux reconnect regression tests.

### Platform and operation notes

- Run configurations currently target **macOS/Linux execution hosts with Bash**. Windows clients can use POSIX SSH hosts; native Windows execution is not supported by this runner.
- Workloads should run in the foreground. Deliberately daemonized processes are outside the managed job.
- tmux persistence covers SSH disconnections, not remote reboots. Ordinary runs are stopped on app quit; tmux runs remain remote until explicitly stopped or their output tab is closed.
- macOS builds use ad-hoc signing and are not notarized, consistent with previous releases.

## v0.2.0 — 2026-09-04

MarinaShell 0.2 turns terminal tabs into project workspaces and adds a first-class editor that works across local and SSH sessions.

### Project workspaces

- Group related terminal tabs under a named project group.
- Switch a group between 1×1, 1×2, 2×1, and 2×2 live terminal grids.
- Drag tabs to reorder them or move them between groups.
- Rename tabs from their context menu and assign per-tab colors.
- Configure automatic tab titles with values such as `<ssh_machine>` and `<current_folder_name[:15]>`.
- Collapse the file and actions sidebar to give terminal grids more room.
- Restore group names, layouts, membership, ordering, colors, custom titles, paths, and the active tab when tab restoration is enabled.

### Inline CodeMirror editor

- New bundled `editor` plugin that can be enabled and selected as the default from Settings.
- Open local and SSH files directly from the Files panel without installing an editor on the remote host.
- Read and save remote files over MarinaShell's existing SFTP connection.
- Detect external file changes before saving and offer explicit reload or overwrite actions.
- Keep unsaved drafts while switching editor files or dock views, with a close warning for dirty documents.
- Work with multiple files using editor tabs and Cmd/Ctrl+S saving.
- Cut, copy, paste, delete, and select all from a clipboard-aware context menu.
- Syntax highlighting and automatic indentation for JavaScript, TypeScript, JSON, YAML, HTML, CSS, Markdown, and Python.
- JavaScript/TypeScript and Python language completions, plus in-document key suggestions for JSON and YAML.
- Inline JSON syntax diagnostics and a visible Suggest action for Ctrl+Space completion.
- Detect and preserve LF, CRLF, and CR line endings. The status bar exposes language, indentation, encoding, file size, and cursor position.
- Safe UTF-8 editing up to 5 MB, with binary-file rejection and atomic replacement where supported.

### Smarter terminal interaction

- Detect and underline web links, `www` addresses, and email addresses in terminal output.
- Open or copy detected links from the terminal context menu.
- Copy selections, select all, and paste through a clipboard-aware terminal menu.
- Standard Edit menu roles provide consistent undo, redo, cut, copy, paste, delete, and select-all shortcuts.

### Reliability and packaging

- Fixed the CodeMirror status bar being obscured in short editor panes.
- Added an Electron browser-level editor regression test covering YAML mode, completion, clipboard actions, indentation, and line-ending behavior.
- Normalized plugin renderer URLs for packaged Windows builds.
- Release builds continue to produce macOS, Windows, and Linux artifacts through the tag-triggered GitHub Actions workflow.

### Upgrade note

Existing installations keep their current file-open preference. To use CodeMirror, open **Settings → Plugins**, enable `editor`, and choose **Use as default**. The existing `*.log` association continues to open logs with `less` unless changed.
