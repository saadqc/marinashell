# MarinaShell v0.2.24

Includes the compact external-editor selector, Islet integration, and automatic Python environment handoff introduced in v0.2.23.

- Open a local folder in a fresh terminal with `--open-directory`, including from Islet’s **Open in Terminal** action.
- Folder requests reach the existing MarinaShell window when it is already running and wait for the workspace to finish loading when it starts.
- Paths are validated as local directories and passed directly as the terminal’s working directory. Spaces, quotes, and Unicode names are supported.

On macOS, integrations should use `open -n -a MarinaShell --args --open-directory "/path/to/project"` to deliver arguments reliably. Each request creates an independent terminal tab. This handoff accepts local folders only.
