# MarinaShell v0.2.28

Open a terminal's current folder directly in your preferred external editor.

- Added **Open in Editor** to terminal and terminal-tab context menus.
- Uses the global default editor selected in MarinaShell settings. If no default is configured, the editor picker opens.
- Opens only that terminal's current folder, including its SSH location when the selected editor supports it. The action does not open all folders from the saved project or use the project's editor override.
- Keeps the existing **Open project in editor…** action for opening the complete project.

Local folder launches and single-folder SSH handoff to Islet are covered by the real Electron workflow. Existing saved workspaces, settings and update safeguards are preserved.

This release retains the macOS updater compatibility fix from v0.2.27. The macOS preview is ad-hoc signed and not notarized. Windows and Linux installers are published by the same release workflow after their platform checks pass.
