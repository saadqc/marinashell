# MarinaShell v0.2.22

- Added **Islet** to project/group editor actions, global defaults, and per-project preferences.
- Detect Islet app bundles and installed launchers automatically, or choose a custom path in **Settings → Editor → External editors**. Missing installations show the Islet-specific setup dialog.
- Open named workspaces containing local and SSH folders together. Folder labels, order, and host identities are preserved without copying credentials or starting terminal sessions.
- Preserve Islet workspace preferences and report conflicts when its roots were edited independently. App bundles use their bundled runtime and CLI.

Islet currently provides an Apple Silicon DMG for macOS 13.5 or newer. Other editor adapters retain their existing local-folder behavior. MarinaShell’s normal macOS, Windows, and Linux packages are included.
