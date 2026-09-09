# Changelog

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
