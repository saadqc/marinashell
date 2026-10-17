# JavaScript debugging

Enable **JSDebug**, **Editor**, and **Run Configurations** in **Settings → Plugins**. Python's PyDebug plugin can remain enabled at the same time; each debugger keeps separate breakpoint and watch definitions.

## Set up the adapter

Open **JSDebug → Debugger setup / Attach** and choose **Install verified adapter**. MarinaShell downloads Microsoft's standalone js-debug 1.140.0 from its official release and checks the pinned SHA-256 before extraction. The adapter lives under MarinaShell's user-data directory and is loaded independently of VS Code. Custom adapter and Node executable paths can be saved in the same dialog.

## Node and npm

Create a JavaScript script, ES module, or npm run configuration with its intended Node interpreter, working directory, and environment. Open a `.js`, `.cjs`, `.mjs`, `.jsx`, `.ts`, or `.tsx` source file, click its breakpoint gutter, then choose **Debug JavaScript** beside Run. Right-click a gutter breakpoint to add a JavaScript condition.

Inspect supports stack frames, variables, watches, expression evaluation, stepping, uncaught exceptions, Continue/Pause, Restart Debug, and Stop. Ordinary Run does not add inspector flags or bootstrap code. npm debugging attaches to managed child targets without assigning the same inspector port to every child.

TypeScript must be compiled or run by an appropriate configured runtime. Use source maps to bind breakpoints in original source. The configuration's Environment section accepts optional JSON source-mapping settings: `outFiles`, `sourceMapPathOverrides`, `localRoot`, `remoteRoot`, `skipFiles`, `sourceMaps`, and `autoAttachChildProcesses`. Missing source maps leave breakpoints unbound. For remote external map files, provide a local source/map mirror or accessible map URLs when the local adapter cannot read remote files directly.

The right debugger companion has a collapse toggle. Its preference persists globally across files, projects, and restarts. A new stop reveals it temporarily; Continue restores the preference. Manually collapsing a paused debugger keeps it collapsed until another stop.

## SSH and external attach

Managed SSH configurations publish the Node inspector on remote loopback and forward it through the existing SSH control connection. No public inspector port or manual tunnel is needed. Source files are opened through the selected host's file connection.

For an existing inspector, open **Debugger setup / Attach**, enter its local host or SSH alias, loopback port, and source working directory, then **Attach to Node**. Disconnecting an externally attached process does not terminate it. Restart an external process through its original owner and attach again.

Managed local Node targets retain the existing Run Configurations POSIX-host requirement; native Windows run execution and tmux debug launches remain unsupported. The adapter itself is platform independent and supports custom runtime paths.

## Chrome and Edge

In the same setup dialog, choose Chrome or Edge, enter the application URL and source directory, and optionally provide the browser executable. **Launch browser debugger** uses an isolated temporary profile. **Attach to browser** uses the specified loopback debugging port and can use an application URL to select a target. An attached browser remains running when disconnected. Both modes use the same inspection, breakpoint, and collapse controls as Node.

## Verification

`npm run test:jsdebug` covers real Node/npm/TypeScript, stepping/restart/cleanup, external attach, and SSH forwarding. `npm run test:jsdebug:ui` exercises the real Electron app with both debugger plugins enabled. `npm run test:jsdebug:browser` uses Chrome with an isolated profile; set `JSDEBUG_TEST_BROWSER` for another Chrome executable. Edge uses the adapter's Edge target and requires its own installed browser for device validation.

Tests install the pinned adapter into temporary libraries. Set `JSDEBUG_TEST_ARCHIVE` to a cached verified release archive, or allow the installer to download it. `JSDEBUG_TEST_NODE` selects the Node executable for the Electron fixture.
