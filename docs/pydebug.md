# Python debugging in MarinaShell

PyDebug adds a debugger to the CodeMirror editor and existing Python run configurations. It supports local macOS/Linux and ordinary SSH configurations on POSIX hosts.

## Start debugging

1. Enable **PyDebug**, **Editor**, and **Run Configurations** in **Settings → Plugins**. PyDebug ships disabled.
2. Install `debugpy` in the configuration's selected Python environment. For SSH, install it on that SSH host. Python 3.9 or newer and debugpy 1.8.x are required; 1.8.17 is the tested version. Preflight reports the resolved interpreter when installation is needed. For example:

   ```bash
   /path/to/selected/python -m pip install debugpy==1.8.17
   ```

3. Open a Python file and click its breakpoint gutter. Right-click the gutter to edit the Python condition. Alternatively, open **PyDebug** from the sidebar or **PyDebug: Breakpoints** from command search, then **Add** a source path and line.
4. Select a saved Python script/module configuration and click **Debug** beside **Run**. Stop any ordinary run of that configuration first. Debug saves its open Python buffers through the editor's conflict checks before launching.
5. Trigger the application action. A breakpoint stop activates the matching source editor inside MarinaShell, scrolls to and highlights the execution line, and shows the debugger panel beside it.

Expand Locals/Globals and nested values in **Inspect**; choose a thread or stack frame to change scope. Use **Watches** for saved expressions and **Console** for explicit evaluation in the selected frame. Continue, Pause, Step over/into/out, Restart Debug, and Stop are in the panel. **Break on uncaught exceptions** can be enabled while connected. Run output stays in the existing Configurations workspace.

## Breakpoints and source changes

The central **Breakpoints** tab provides Add, Edit, Remove, individual enable/disable, and scoped bulk actions. Its project and host filters determine which definitions the bulk actions affect. Definitions survive app restart and do not modify Python source.

An empty condition always stops; an expression such as `case_id == "CASE-123"` stops when true. Conditions use Python's debugger evaluation rules. With the tested debugpy version, invalid syntax skips that stop and reports an adapter warning in PyDebug; a name unavailable in the frame silently skips the stop. Conditions and console expressions can execute Python code.

Markers move with editor edits and synchronize after saving. Without reload, the running code still uses the previous source. PyDebug marks that mismatch and hides the execution highlight until **Restart Debug**. Dirty unrelated buffers are preserved. Selecting a different paused session changes inspection without repeatedly switching focus between simultaneous stops.

## SSH

The selected remote interpreter launches debugpy on remote loopback. MarinaShell carries debugger traffic through its authenticated SSH control connection, using internal forwarding; the Tunnels plugin and manual port setup are unnecessary. Source reads/saves use that host's SFTP connection. Breakpoints are scoped by host and project, including when two hosts have the same file path.

The SSH server must allow forwarding and SFTP. Connection loss invalidates live values and attempts owned-run cleanup. If the remote process cannot be checked, PyDebug reports disconnected/unknown; reconnect and Stop before launching a replacement. No live debugger session is restored after app restart.

## First-version limits

- One process per debug session; Python threads and async code are supported. Different configurations may run concurrently.
- Recognized Uvicorn module launches disable reload only for Debug and require one worker. Saved arguments and ordinary Run remain intact. Generic targets must keep their application logic in the launched process.
- tmux, subprocess/multiprocessing debugging, containers/path mappings, externally launched attach sessions, native Windows targets, hit counts, logpoints, hover values, and variable editing are outside this version.
- Closing an editor/output view keeps the run alive. Stop, project close, plugin disable, and app quit use the existing managed process ownership and teardown.
- Watch definitions persist; evaluated values, console history, stack frames, and debugger references stay in memory. The debugger has no MCP interface.

## Verification

The tests use isolated libraries and a real loopback SSH/SFTP server; they do not change your saved projects or Python environments. Prepare an isolated test interpreter, then run:

```bash
python3 -m venv /tmp/marinashell-pydebug-test-env
/tmp/marinashell-pydebug-test-env/bin/python -m pip install debugpy==1.8.17 uvicorn==0.37.0
npm run test:pydebug
npm run test:pydebug:ui
```

Set `PYDEBUG_TEST_PYTHON` to use another prepared interpreter. The integration suite covers real local/SSH debugging, conditional hits and invalid expressions, stack/scopes/values, watches, stepping, uncaught exceptions, stale frame rejection, restart/stop, lost transport, forwarding denial, missing dependencies, cancellation cleanup, and an actual Uvicorn HTTP request. The Electron suite exercises pointer breakpoints, automatic source activation, condition editing, bulk enable/disable, watch/console evaluation, editing/saving/remapping on Restart Debug, remote SFTP read/save, debug-preserving restart, and disable cleanup. Existing run, editor, plugin activation, navigation, workspace, SSH, and docking regression suites also passed during implementation. `npm run pack` succeeded on macOS arm64, and the packaged debugger/editor/SSH files were compared with the working tree.

Acceptance used isolated fixtures, including Uvicorn and loopback SSH/SFTP; external application services and SSH hosts were not restarted for verification.

## Implementation

PyDebug's DAP client runs in Electron main; CodeMirror provides gutters/decorations and an editor companion slot. Run Configurations owns launch/output/termination. A private Python bootstrap uses `debugpy.listen(("127.0.0.1", 0))`, atomically publishes the bound port inside the owned run directory, waits for attachment, and runs the original script/module. This avoids selecting a port and then racing another listener before attachment. Existing interpreter/environment preparation runs once and is reused by preflight and launch.
