# Open a folder in MarinaShell

MarinaShell 0.2.24 and newer accepts one absolute local directory:

```sh
marinashell --open-directory "/path/to/project"
```

For macOS app integrations, use the application launcher with `-n` so arguments reach MarinaShell even when it is already running:

```sh
open -n -a MarinaShell --args --open-directory "/path/to/project"
```

A custom installation can be selected by passing its app bundle path to `-a`. Integrations should pass each argument separately rather than building shell command text. Direct invocation of the application executable also supports the same arguments.

Each request opens a fresh, ungrouped local terminal tab in the requested folder and brings the main window forward. The folder is passed directly to terminal creation as its working directory. Requests arriving during startup or renderer reload wait until the workspace is ready. Relative paths, files, missing directories, and SSH URLs are rejected. This interface does not accept commands to execute.

Islet’s Open in Terminal action can use this interface when MarinaShell is selected as its default terminal. An older running MarinaShell version must be closed and replaced with a version supporting this handoff before using it.
