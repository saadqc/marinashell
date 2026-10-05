# MarinaShell v0.2.18

- Added the optional PyDebug plugin for local and SSH Python script/module configurations. Debug beside Run provides CodeMirror breakpoints, Python conditions, a central breakpoint manager, variables, call stacks, watches, console evaluation, stepping, and uncaught-exception stops. A breakpoint activates and highlights the matching source automatically.
- Debug sessions allocate available loopback ports on the execution host and use internal SSH forwarding for remote traffic. Stop and Restart Debug preserve managed process ownership; restart saves edited Python buffers and follows moved breakpoints. Different configurations can debug concurrently; each configuration has one active debug instance.
- PyDebug requires Editor, Run Configurations, Python 3.9+, and debugpy 1.8.x in the selected environment (tested: 1.8.17). Recognized Uvicorn module launches disable reload only for Debug and require one worker; ordinary Run and saved arguments retain their behavior. Subprocess, tmux, and native Windows debug targets are outside this version; Windows clients can debug POSIX SSH hosts.
- Terminal tabs can dock into shared panes or split a pane by dragging onto its centre/edge anchors. Resizable arrangements, pane members, standalone tabs, order, and focus save automatically and restore with projects. Failed saves show Unsaved with Retry.
- Configuration output has its own Configurations workspace with temporary docking, separate from shell terminals. Closing an output view keeps its run alive; Stop and project close retain process checks.
- Removed the terminal context menu's Create on right / Create below options. Use the new-terminal control and drag docking to arrange sessions.
- Corrected SSH editor timestamp handling so switching to a debugger's SFTP connection preserves save-conflict checks.

See the [PyDebug setup and usage guide](https://github.com/saadqc/marinashell/blob/v0.2.18/docs/pydebug.md). Enable PyDebug in Settings → Plugins; it ships disabled.
