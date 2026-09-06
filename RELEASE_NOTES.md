## Saved groups and Run Configurations

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
