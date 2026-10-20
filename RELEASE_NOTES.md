# MarinaShell v0.2.23

- External editor settings now use one selector. View and change only the selected editor’s path, installation status, and detected installations; saved paths for other editors are preserved. Islet remains available in the list even when it is not installed.
- Opening an Islet workspace automatically selects Python interpreters from matching run configurations or group defaults, scoped to each folder and connection. Named conda/mamba environments and pyenv versions can be resolved through runtime discovery.
- Interpreter choices made in Islet are preserved. MarinaShell-managed choices update when configurations change, and conflicting environments show a clear explanation.

Opening an editor does not run setup scripts, read environment files, or install dependencies. Environments defined only through those hooks need an explicit interpreter path. Islet currently provides an Apple Silicon DMG for macOS 13.5 or newer; MarinaShell includes its normal macOS, Windows, and Linux packages.
