# Open MarinaShell projects in external editors

Status: implemented, 20 October 2026. Native grouped opening verified in PyCharm, Antigravity IDE, and VS Code on macOS.

Add **Open in editor** to existing projects and groups. A project containing Backend, Frontend, and Worker should open those three directories together in one editor workspace. Reuse the folders already configured in MarinaShell, with automatic editor discovery and editable installation paths in Settings.

## Islet integration

Islet is available in the editor chooser, per-project defaults, and Settings → Editor → External editors. Settings uses one selector and shows installation controls only for the selected editor. Hidden editor overrides are retained, and unavailable editors remain selectable. On macOS, discovery checks system/user Applications folders and the installed `islet` CLI. A custom app bundle or executable can be selected. App bundles launch through their bundled runtime and CLI, so a separate Node installation is unnecessary.

MarinaShell creates a named `.islet-workspace` outside source repositories. Local roots are canonicalized; SSH roots retain their connection alias and absolute remote path. Repeated roots on the same host are deduplicated, while identical paths on different hosts remain separate. Existing workspace preferences are retained, and manual root changes require reconciliation. Launching uses Islet’s `open --new-window --workspace` interface and never opens MarinaShell terminal sessions.

Python run configurations and group defaults can supply each root’s interpreter automatically. Matching uses the connection and most specific workspace root. Conda/mamba and pyenv metadata can resolve named environments through bounded runtime queries; opening the editor does not launch the configured application, install dependencies, read environment files, or run setup scripts. Conflicting Python environments produce a clear dialog. Explicit interpreter choices made in Islet are preserved; generated choices update with MarinaShell configuration changes. Older defaults without a connection are used only for a single-host project.

Islet currently provides an Apple Silicon DMG for macOS 13.5 or newer. Download it from [Islet releases](https://github.com/saadqc/Islet/releases); select the app or its installed launcher in Settings if automatic discovery cannot find it. Missing installations use the same named modal and path-setting actions as other editors.

## Implementation and validation

The feature is available from project options and the project rail context action, grouped terminal context menus, and both saved-project and saved-group libraries. Settings → Editor → External editors includes discovery, installation selection, native path browsing, custom overrides, reset to detection, and a global default. The project editor provides a project-specific default. Missing applications show a named modal; missing folders offer editing and retry. Islet opens local and SSH roots together; other adapters show an explicit explanation for remote folders.

PyCharm uses a MarinaShell-owned aggregate project with a separate named module for each folder. A native integration test confirmed Backend, Frontend, and Worker as three loaded roots, three separate Git repositories, and independent Backend/Worker interpreter references. Generated metadata remains outside the source repositories. PyCharm follows its own project-window preference. Interpreter references are imported when creating modules; interpreters absent from the IDE's SDK table must be selected in the IDE. Module SDK changes made inside the generated project survive future launches and folder membership changes.

Native Antigravity IDE and VS Code development-extension observers confirmed all three named folders in the exact workspace files produced by the implementation. The Antigravity IDE launcher is `antigravity-ide`; the separate Antigravity app is excluded from IDE detection. Regeneration after the native editors exited preserved their workspace files and module settings.

VS Code and Antigravity use `.code-workspace` files. Sublime uses `.sublime-project`; its adapter is covered by generation and launch-argument tests. WebStorm and IntelliJ IDEA have product-specific module types and discovery entries. Native runtime validation of Sublime, WebStorm, IntelliJ IDEA, and the Windows/Linux adapters remains outside the macOS verification completed here.

Automated validation covers stable configured roots after terminal navigation, closed saved-project launch without starting sessions, non-active project targeting, preference preservation, installation overrides, the missing-editor modal, directory browsing, reset, settings reload, responsive layout, comments and user settings in workspace files, folder conflicts, repository mappings, module removal/re-addition, per-module SDK choices, duplicate launches, sender authorization, and literal process arguments.

Validation commands:

- `npm run test:external-editors` — new service and real Electron UI coverage.
- `npm run test:projects` — existing project validation and tunnels.
- `npm run test:navigation` — existing navigation, project creation, restoration, shortcuts, and responsive controls.
- `npm run test:workspace` — existing workspace persistence, run controls, and terminal behavior.
- `git diff --check` — whitespace validation.

Native probes used disposable repositories and isolated IDE profiles. Temporary MarinaShell verification configurations expire after one hour. The implementation adds no dependencies. Existing unrelated run-configuration work is preserved.

## User experience

1. Add **Open in editor →** to the project rail context menu, project options, group context menu, and each saved project or saved group in the library. Saved projects can launch directly without opening MarinaShell terminals first.
2. Show Islet, VS Code, Antigravity IDE, PyCharm, and Sublime Text. Include other detected JetBrains IDEs as separate entries, including WebStorm and IntelliJ IDEA. Each entry shows its availability. Keep unavailable entries selectable so clicking them opens the requested missing-editor modal.
3. Selecting an editor opens all configured folders together. For example, Backend, Frontend, and Worker appear as three roots in one workspace, retaining their display names and order. A single-folder project opens that folder normally; Islet retains a named workspace even for one root.
4. Default to a new editor window for the initial launch. Reopening the same generated workspace should reuse its identity where the editor supports this. Do not attach folders to whichever unrelated editor window happens to be focused.
5. Allow a global default editor and an optional project override. The explicit editor submenu remains available. Changing the default does not immediately launch anything.
6. A missing-editor modal names the editor and offers **Open editor settings**, **Detect again**, and **Cancel**. Distinguish an invalid configured path, an unsupported installed version, and an actual launch failure from an absent installation.

Islet supports mixed local and SSH folders through a managed `.islet-workspace` file. Roots retain their host identity, label, and order; SSH aliases use the system SSH configuration and credentials are never copied into the workspace. Other editor adapters support local folders and list unsupported remote roots instead of omitting them or treating them as local paths.

## Settings and discovery

Extend the existing Editor settings section with a clearly separated **External editors** area. Keep the existing file-opening modes and file associations intact.

For each editor show its name, detected installation or custom path, status, and optional version. Provide an editable path, **Browse**, **Detect again**, and **Use detected path**. The picker accepts macOS application bundles as well as supported launcher executables on each platform. Multiple JetBrains installations can be selected explicitly. If multiple viable versions exist, prefer a stable installation deterministically and show which one was selected.

Discovery order:

1. A user override, if configured. An invalid override is reported and never silently replaced.
2. Installed application locations appropriate to macOS, Windows, or Linux, including user-level locations and JetBrains Toolbox launchers.
3. Known command launchers on the application process PATH and known platform launcher directories. An Electron app launched from the desktop must not depend on an interactive shell having installed a command alias.

Perform discovery asynchronously when the area is first used; cache results for the session. Refresh explicitly and revalidate the selected installation before launch. Do not recursively scan whole disks or start an IDE just to discover it. Unsupported package types can use a validated custom launcher until an adapter supports them.

Store user overrides and the global default in the existing typed Settings structure, under a new external-editor namespace. Keep discovered paths separate from overrides, so an application update can refresh detection without overwriting user intent. Project preferences contain editor IDs, never machine-specific executable paths.

## Folder selection and workspace identity

The launch request resolves a named project or group into a common description: stable ID, display name, ordered folders, folder labels, and host identities.

- A saved project uses its saved folder definitions, even when its terminals are closed or have navigated elsewhere.
- A saved group uses its saved root paths, falling back to its saved directory when no root exists.
- An unsaved live group uses each normal session's configured tree root, falling back to its initial directory. Exclude run-output views and read-only configuration tabs. Persist an initial folder explicitly if the current model cannot distinguish it reliably.
- Preserve configured order. Deduplicate equivalent local directories by normalized filesystem identity, preserving the first label. Keep explicitly configured nested folders; they can have independent editor settings.
- Validate that every selected local root exists and is a directory. Show all invalid roots together and offer to edit the project or retry. Require an explicit **Open available folders** action if partial opening is offered.

Store generated workspaces under `~/.marinashell/editor-workspaces/<project-id-hash>/<editor-id>/`. Use IDs rather than project names to avoid collisions and preserve identity across renames. Use separate files per editor. These are persistent user workspaces, rather than temporary run configurations; their editor session state must survive reopening.

Update generated definitions atomically only when the configured roots change. Modify only MarinaShell-owned folder entries and preserve editor-owned session data and user settings. If a file was changed in a way that makes merging ambiguous, show a conflict choice instead of replacing it. Closing or deleting a MarinaShell project must not delete an open editor's workspace data. Add explicit cleanup later if needed.

## Editor adapters and compatibility

| Editor | Planned integration | Verification required |
| --- | --- | --- |
| VS Code | Generate a named `.code-workspace` with ordered folder entries, then open that exact file through the bundled or configured launcher. | Cold start, existing unrelated window, repeat launch, and workspace-folder changes. |
| Antigravity IDE | Verify the installed IDE's workspace-file and command-line support; use its own launcher and generated workspace if supported. | Distinguish the IDE from the Antigravity app and CLI; do not assume launcher names or flag parity with VS Code. |
| Sublime Text | Generate a `.sublime-project` with folder entries and launch it using its project option. Keep Sublime's companion session file. | Folder names/order and repeated opening of the same project. |
| PyCharm | First verify a supported way to open all folders as one attached project or managed aggregate project. | One window, all roots, independent repositories, existing project configuration, interpreter behavior, and reopen persistence. |
| Other JetBrains IDEs | Reuse discovery and launcher infrastructure, with capabilities declared per product and version. | Verify each product's own module/project behavior before enabling multi-folder launch. |

VS Code documents named multi-root workspace files and notes that `--add` targets the last active window. Use a specific workspace file for predictable project targeting. [VS Code multi-root documentation](https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces)

Sublime documents its JSON project format and its project launch option. [Sublime projects](https://www.sublimetext.com/docs/projects.html), [Sublime command line](https://www.sublimetext.com/docs/command_line.html)

PyCharm documents **Attach** in its project-opening UI; its documented launcher does not establish a generic command for attaching several projects. Treat this as a feasibility gate, rather than opening three independent windows and calling that success. Investigate a MarinaShell-owned aggregate project with external content roots/modules if no supported attachment command exists. Verify per-project settings and interpreters explicitly; aggregate content roots must not be represented as equivalent to independent attached projects without that evidence. Keep generated metadata in the managed workspace directory and avoid rewriting existing repositories' `.idea` files. If this cannot meet the acceptance criteria, report the limitation before choosing a plugin or guided first-time attachment flow. [PyCharm project attachment](https://www.jetbrains.com/help/pycharm/open-projects.html), [PyCharm launcher](https://www.jetbrains.com/help/pycharm/opening-files-from-command-line.html)

Antigravity IDE and the separate Antigravity app use different product metadata. The IDE launcher is `antigravity-ide`; discovery validates the product identifier before selecting it. Google documents a separate newer Antigravity project model, reinforcing the need for product-specific detection. [Antigravity projects](https://www.antigravity.google/docs/projects?tab=cli)

## Code integration

Implement this as a core workspace feature, independent of optional plugins.

| Area | Planned change |
| --- | --- |
| `main/services/externalEditors/` | Editor registry, platform discovery, path validation, capability checks, workspace generation, and process launch adapters. |
| `main/app.js` | Register narrow IPC for detection, browsing, validation, and opening a project workspace. Validate sender and payload before filesystem or process operations. |
| `preload.js` | Expose the narrow editor operations using the existing bridge pattern. |
| `main/constants.js`, `main/services/settingsStore.js` | Defaults, typed setting values, and backward-compatible persistence. |
| `renderer/services/externalEditors.js` | Shared menu/modal controller and launch feedback used by every entry point. |
| `renderer/components/projects.js` | Project rail/options, project editor preference, and saved-library actions. |
| `renderer/components/sessionTabs.js`, `renderer/components/savedGroups.js` | Group actions and launch-folder resolution; retain optional editor metadata when snapshots are saved or restored. |
| `main/services/projects.js` | Validate optional project editor preferences while accepting older saved projects unchanged. |
| `settings.html`, `settings.js`, `renderer/preferences.css` | External-editor settings, native path browsing, status, and rediscovery controls. |

Saved projects already contain `tabs` with host, directory, tree-root, and display-name information. Live groups link back through `savedGroupId`. Reuse those records and avoid introducing a second folder list that can drift from the project setup. Snapshot save currently constructs a new record explicitly, so preference preservation must be implemented there as well as in the project editor.

The main process resolves saved records and validates all launch inputs. Launch an allowlisted adapter with an executable and argument array; never interpolate project names, paths, or settings into a shell command. Handle platform launcher scripts through a constrained adapter. Return structured outcomes such as editor missing, invalid override, missing folders, unsupported capability, or launch failure. A successful process handoff is described as such; only editor inspection can establish that every folder opened correctly.

## Implementation order

1. **Compatibility proof:** test grouped opening using disposable local directories in disposable PyCharm and Antigravity IDE test profiles. Inspect launcher capabilities and confirm the aggregate-project approach if needed. This resolves the main uncertainty before building the full UI. In implementation work, use an existing MarinaShell project configuration where available, with a bounded expiry for temporary configurations.
2. **Shared service and Settings:** implement discovery, override persistence, native picker, validation, and adapter capabilities for macOS, Windows, and Linux. Add workspace generation for VS Code and Sublime, plus the proven PyCharm and Antigravity strategies.
3. **Project and group actions:** connect all entry points to the same service. Add defaults, folder validation, missing-editor modal, unsupported-remote explanation, and preference preservation.
4. **Verification:** run focused service and UI tests, then the existing project, workspace, and navigation regressions. Exercise real grouped opening in installed editors. Validate Windows and Linux adapters on those platforms before claiming support for them.

## Acceptance criteria

- An existing Backend/Frontend/Worker project opens all three roots in one workspace through each supported editor adapter.
- A saved project launches without creating terminals or starting its run configurations.
- Opening the action on a non-active project targets that project, not the active one.
- A terminal `cd` does not change the configured editor roots.
- Reopening preserves workspace identity; changing project membership refreshes its roots predictably.
- Missing or removed editor installations show the requested modal; custom-path settings survive restart and supersede detection.
- Spaces, Unicode, quotes, shell metacharacters, duplicate paths, same-named projects, and application upgrades are handled correctly.
- Missing folders, unavailable launchers, mixed-host projects, and unsupported editor capabilities produce clear, accurate outcomes.
- Workspace generation does not replace existing repository IDE configuration or merge unrelated Git repositories.
- Existing saved projects, file-opening modes, layouts, session restoration, and run controls continue to work.
- Real editor inspection confirms grouped opening, separate repository visibility, repeat-launch behavior, and PyCharm interpreter handling. Generated-file tests alone do not satisfy this requirement.

Remote connections in other editor adapters, attaching into an arbitrary already-open editor window, editor plugins, and exporting workspace files into repositories remain follow-up features. Islet supports local and SSH roots together in one named workspace.
