# Changelog

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
