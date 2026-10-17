# Debugger Git and run configuration improvements

Status: implementation authorized by the user on 2026-10-17. Implementation, regression checks, and macOS package verification are complete. Public release v0.2.20 was authorized by the user on 2026-10-17. Platform build and asset verification belongs to the tagged Release workflow.

Add a collapsible debugger companion, a Git plugin with a shared CodeMirror diff viewer and GitHub pull requests, a JavaScript debugger plugin, and run configuration expiry and filters. Preserve existing Python debugging, local and SSH execution, project layouts, and saved configuration identities.

## Existing integration points

| Area | Current implementation | Required extension |
| --- | --- | --- |
| Debugger companion | `plugins/editor/renderer.source.js` creates `aside.mse-debug-companion` and mounts the debug provider whenever available. | Persistent collapse preference and temporary reveal on a new debugger stop. |
| Debug provider | `renderer/services/debugIntegration.js` holds one provider; Editor enables gutters and debug saves for Python filenames only. | Provider registry, language support predicates, session ownership, and normalized stop notifications. |
| Python debugging | `plugins/pydebug/` supplies DAP transport, session management, breakpoint persistence, inspection, and run actions. | Preserve behavior while extracting only reusable debugger infrastructure. |
| Run lifecycle | `plugins/run-configurations/main.js` routes debug stop/restart specifically through PyDebug. | Resolve the debugger that owns a run, including JavaScript sessions. |
| Configuration storage | `configuration.js` normalizes an explicit field list; `manager.js` uses the atomic JSON library store. | Trusted origin and creation metadata, expiry policy, and a single configuration lifecycle service. |
| Project membership | Live tab groups contain `configurationIds`; saved projects have their own persisted definitions. MCP additionally recovers unique host/directory matches. | Shared membership queries and consistent removal across live and saved projects. |
| Configuration dialog | `plugins/run-configurations/editor.js` groups entries by type and supports project membership checkboxes. The launcher already filters by the active project. | Project dropdown and origin filter in the management dialog, plus expiry fields. |
| Plugin navigation | `renderer/index.js` supplies view and terminal-action registration; `dockLayout.js` supports connection/type restrictions. | Repository-aware visibility and a terminal context-menu contribution hook. |
| Terminal context menu | `sessionTabs.js` builds the menu using the clicked terminal ID. | Git Diff action scoped to that terminal, including when another terminal has focus. |
| Settings | `main/services/settingsStore.js`, `main/constants.js`, `settings.html`, and `settings.js`. | Debugger visibility, GitHub CLI executable path, and MCP expiry default. |

No Git diff viewer, GitHub PR integration, or JavaScript debugger exists in the inspected plugin code. CodeMirror is already bundled for Editor; `@codemirror/merge` must be added for the proposed diff viewer.

## Proposed behavior

### 1. Collapsible debugger companion

- Add a collapse chevron to the right debugger panel. When collapsed, retain a narrow accessible Debugger toggle and give the editor the freed width.
- Save the user's collapsed/expanded preference globally, across files, projects, editor panes, windows, and application restarts. Keep expanded as the initial value for existing users.
- A new breakpoint hit temporarily reveals the relevant debugger and source location even when the saved preference is collapsed. Do the same for an explicit Pause, step stop, or enabled exception stop so inspection remains usable.
- Temporary reveal does not overwrite the saved preference. On Continue or session end, return to the saved state. Opening a file or receiving an ordinary status refresh does not reveal the panel.
- If the user collapses the panel while paused, respect that action until a different stop occurs. Deduplicate using debugger ID, session ID, and stop sequence/generation; polling the same pause must not reopen it.
- Reveal only the editor context associated with the stopped session. Other editor panes retain the global preference without being forced open for an unrelated session.
- Keep breakpoint synchronization and the session running while the companion is collapsed. Remounting the panel must preserve selected session, inspection tab, and watches.
- Add a narrow settings update operation that merges this field and broadcasts it. Avoid saving a stale full settings snapshot from each editor pane.

### 2. Git plugin and diff interface

Ship a bundled optional `git` plugin, initially disabled, following the existing optional plugin convention. Once enabled, its left tool icon appears for the selected connected terminal only when that terminal's current directory is inside a Git worktree. A clean repository still shows the plugin and an empty changes state.

Entry points:

1. Select the Git tool on the left. It opens on **Diff**, using the selected terminal's host and directory.
2. Right-click a terminal pane and choose **Git Diff**. Open the same view using the clicked terminal's context, regardless of which terminal was previously active.

Hide both entry points outside a repository. Update detection on terminal selection, directory changes, reconnection, plugin activation, and refresh. Until detection succeeds, hide Git actions; distinguish an actual non-repository result from a disconnected host or failed command. An already open view whose repository disappears shows an explanatory empty/error state.

Layout:

```text
Git   host / repository   current branch           Refresh
Diff | Pull Requests       Compare: Working changes / branch

Changed files             Unified | Split      Previous | Next
Staged                    path/to/selected-file      change 2 of 5
  file.ts       +12 -4     [CodeMirror diff]
Unstaged
  other.py       +3 -1
Untracked
  new-file.js   +20 -0
```

- Show changed files only, with file status and green additions/red deletions. List a path in both staged and unstaged groups when it has changes in both; each row opens the corresponding comparison.
- Default to working changes: unstaged, staged, and untracked groups. Unstaged compares index to working tree; staged compares HEAD to index; untracked compares an empty file to its content. Provide an optional combined tracked comparison against HEAD, clearly labeled.
- Selecting a file shows read-only CodeMirror content with syntax highlighting, old/new line numbers, red/green changed lines, and visible `+`/`-` markers. Split aligns old/new content; Unified interleaves deleted and added lines.
- Preserve selected file and approximate hunk position when toggling Unified/Split. Save the view-mode preference globally.
- Add Previous and Next icon buttons with accessible labels and keyboard commands. Navigate changed hunks in the selected file, scroll them into view, show the current hunk count, and disable at boundaries. File selection remains explicit.
- Collapse long unchanged sections. Load file contents on demand rather than loading every changed file at once.
- Handle additions, deletions, renames, spaces, Unicode, newline-containing paths, CRLF, missing final newline, executable-bit changes, binary files, submodules, conflicts, and empty files. Show status/metadata rather than inventing line counts where text diffs do not apply.
- Conflicted files get a clear unresolved badge and read-only comparison; a three-way merge editor is outside this initial scope.
- Bound content size, command output, and diff computation. Large files show an explicit load/fallback state without freezing the UI or silently truncating a displayed diff.

Branch comparison:

- Add a searchable list of local and remote tracking branches. Changing the comparison branch never checks it out.
- Default branch mode to changes introduced by the current branch since its merge base with the selected branch, equivalent to `base...HEAD`. Clearly label that comparison and exclude uncommitted changes from it.
- Offer a separately labeled direct tip-to-tip comparison if needed; do not silently change the meaning of branch comparison.
- Keep uncommitted changes available by selecting Working changes. Refresh remote refs through an explicit Fetch action; ordinary diff viewing must not fetch.
- Show clear states for detached HEAD, an unborn branch, missing refs, and unrelated histories.

### 3. Git operations

Place repository actions inside the Git plugin. Initial scope: stage/unstage selected files or all files, commit with a message, fetch, pull with fast-forward-only behavior, push with an explicit target/upstream, and create/switch branches.

- Show repository, host, current branch, selected paths, and operation result. Stage/unstage only the intended paths; commits use the index and never silently stage additional work.
- Serialize writes per host/worktree and refresh status after each operation. Block duplicate submissions while an operation is pending.
- Use argument arrays for local Git execution. For SSH execution, use one reviewed argument-quoting/encoding helper, including option termination and literal path handling; never interpolate raw branch names or filenames into shell source.
- Bind mutations to the repository context and status snapshot that the user saw; revalidate before applying and reject stale contexts.
- Discard changes, if exposed, requires a specific file list and explicit destructive confirmation. Force push, hard reset, clean, automatic stash, conflict resolution, and history rewriting are outside the first version.
- Preserve normal Git hooks, signing, and credential behavior. Surface failures and unsupported interactive prompts instead of hiding them or retrying a mutation automatically.

### 4. GitHub pull requests and project accounts

- Detect `gh` on the execution host's PATH and add an executable-path override in global settings. Support separate overrides by host so a macOS executable path is not sent to SSH Linux.
- Without a usable CLI, keep Git diffs and Git operations available; explain how to enable PR features inside the Git plugin. Missing authentication is a separate actionable state.
- Add a Pull Requests tab with list/search, current-branch PR lookup, PR details, and changed files. Reuse the exact Unified/Split diff component and hunk controls.
- Resolve the chosen remote explicitly, including forks and GitHub Enterprise hosts. Show PR number, title, state, base/head branches, author, and URL.
- Display PR file contents from immutable base/merge-base/head revisions. Fetch missing objects explicitly into isolated refs or retrieve bounded content through GitHub; viewing a PR must not check out its branch or replace working files.
- Treat incomplete/truncated patches as incomplete. Use the complete revision contents for comparisons and make unavailable/binary/oversized content explicit.
- Create PRs through an in-app form with title, description, base, head, repository, account, and draft option. Preview the branch diff using the same component. Query for an existing PR before creation and reconcile uncertain outcomes before retrying.
- Require a published head branch or an explicit Push action before creation. Pass explicit base/head/repository arguments and disable CLI prompts so creating a PR does not unexpectedly push or fork.
- Add **Open PR in browser** and **Open selected branch in browser**, using encoded URLs for the correct host, repository, and branch. Branch links can work without `gh` when the remote identifies a supported browser URL; disable links for unpublished branches. Validate HTTP/HTTPS targets before calling the existing external-browser API.
- List authenticated accounts on the relevant host. Save the selected account at project level, further scoped by execution host and GitHub hostname. Use the saved project identity where available so it survives closing/reopening the project.
- Default to the CLI's active account until the user selects an override. Resolve the selected account's credential only in the main process and supply it to that command's environment. Keep credentials out of renderer payloads, logs, JSON settings, and process arguments.
- Avoid `gh auth switch` as the implementation for project selection: it changes the host's active account globally. Prefer account-specific token resolution and per-process authentication. Report inherited-token overrides and unsupported CLI capabilities explicitly rather than showing a misleading account selection.
- Account selection controls GitHub CLI/API operations. Git SSH identity and commit author remain separate; HTTPS Git operations may use the selected account through a deliberate credential bridge without rewriting global Git configuration.

### 5. JavaScript debugger plugin

Ship a separate optional `jsdebug` plugin, initially disabled, requiring Editor and Run Configurations like PyDebug. Use Microsoft's standalone `vscode-js-debug` DAP adapter rather than building an independent inspector implementation.

- Support managed Node.js scripts, ES modules, and npm scripts with the configured Node runtime/environment, locally and over SSH.
- Provide launch debugging and explicit attach to an existing loopback Node inspector. Attach disconnects from an external process without killing it; Stop on a managed launch stops only the owned run.
- Support breakpoints in JavaScript and TypeScript, conditional breakpoints, source maps, variables/scopes, call stack, watches, console evaluation, Continue/Pause, stepping, Restart Debug, and Stop according to adapter capabilities.
- Map compiled files back to original source with configurable source-map/output patterns and local/remote roots. Clearly mark unbound breakpoints and unavailable sources; do not imply TypeScript can run without its configured build/runtime.
- Resolve and install a pinned adapter version with a visible setup/status flow, a custom adapter path, integrity verification, and license notices. Validate packaged-app execution outside development `node_modules`; remote Node debugging should use managed forwarding and need not install the adapter remotely when local adapter/remote inspector attachment works.
- Use loopback endpoints, dynamic ports, and existing SSH forwarding. Do not expose inspector or DAP ports on public interfaces.
- Keep plain Run behavior identical. Do not add inspector flags or `NODE_OPTIONS` to normal executions. For npm child processes, handle inspector-port ownership deliberately instead of giving every Node child the same port.
- Route both Python and JavaScript controls by the owning debugger. Both plugins must remain enabled together without overwriting one another's provider, breakpoints, or stopped-session state.
- Share the collapse/reveal behavior from section 1. Generalize Editor's current Python-only document save and gutter predicates to the owning provider's supported documents.
- Add browser JavaScript debugging as a separate delivery step within this feature: launch or attach Chrome/Edge with a URL, source/web root mapping, and a user-configurable browser path. Preserve the same inspection UI. Ordinary Node/npm debugging must be complete before browser launch integration; browser support is a distinct acceptance gate, not implied by debugging a frontend development server.
- Before implementation expands, prove standalone DAP initialization, attach, a breakpoint hit, npm child targeting, source maps, and SSH transport. The existing DAP client rejects reverse requests; handle required `startDebugging` child sessions and any `runInTerminal` integration through validated owned-run APIs, rather than forwarding arbitrary reverse commands.
- Keep tmux debug launches unsupported initially, consistent with PyDebug, and explain the limitation in the configuration UI.

### 6. Run configuration expiry and filters

Add these persisted fields, owned by the main-process configuration service:

| Field | Meaning |
| --- | --- |
| `createdAt` | Immutable UTC creation time for new configurations. |
| `createdVia` | `ui`, `mcp`, or `unknown`; shown as the read-only Created via MCP field. |
| `expiresAt` | Absolute UTC expiry or null for Never. |
| `expiryDurationMs` | Selected duration for display and explicit renewal. |

- Add **Expiry: Never / 15 minutes / 1 hour / 3 hours / Custom** to creation/editing. Display remaining time and the exact local expiry time.
- Proposed defaults: manual creation uses Never; MCP creation uses one hour, configurable in global settings. MCP callers may request Never or another supported duration explicitly. Existing MCP clients may omit the new optional field and receive the default.
- Stamp origin server-side on the real creation path. An MCP client cannot claim UI origin or forge creation/expiry timestamps. Ordinary edits preserve origin and creation time.
- Count expiry from creation; ordinary edits and runs do not reset it. Changing expiry or choosing Renew explicitly sets a new expiry from the current time. Keep permanently clears it. Show that result before saving.
- UI duplication creates a new UI-origin configuration with fresh timestamps; do not copy immutable provenance from the source.
- Add a project dropdown above the configuration tree: **All projects**, each available project, and **Unassigned**. Default to the current project when opening from that project; otherwise All projects. Include saved projects, not just currently open terminal groups.
- Add a **Created via MCP** filter with **All / MCP only / Exclude MCP**. Combine it with the project filter and existing type grouping. Show an MCP badge and expiry status in list rows.
- Preserve unsaved drafts when filters change: prompt only if changing selection would discard edits. New configurations inherit the selected project; All projects does not imply assignment to every project.
- Keep the toolbar launcher and sidebar consistent with the same membership and expiry rules. An optional Show expired control in management exposes retained expired entries that still own active runs.
- Expiry retires saved definitions, not running processes. Immediately exclude expired configurations from new launch choices and reject new UI/MCP launches and restarts until renewed. Allow existing runs to continue, inspect, stop, and close normally.
- Retain the definition while a run/debug session is active or its status is uncertain. Remove it after all owned runs have definitively ended. Preserve run records and output history.
- Cleanup runs at startup, on a lightweight main-process timer, and before relevant reads/launches. Use absolute timestamps so expiry also works after sleep or while the app was closed.
- Centralize configuration reads/writes and retirement. Current UI and MCP paths access `manager.configs` directly; all must adopt the lifecycle service so expiry cannot be bypassed through an older code path.
- Serialize cleanup against save/start/restart, recheck expiry at launch, and emit change events. Remove retired IDs from live groups, saved projects, selected configuration state, and derived MCP projections. Make partial multi-file cleanup retryable and idempotent on restart.
- Preserve MCP request receipts so replaying an old create request cannot recreate a configuration after expiry. Extend list summaries with origin/expiry and optional filters, while retaining existing scopes, revision checks, and idempotency behavior.
- Legacy configurations remain Never with origin unknown. Existing timestamps do not prove MCP origin; do not guess or bulk-delete old entries. The filter becomes reliable for new creations after this change.

## Architecture and file boundaries

| Component | Proposed changes |
| --- | --- |
| `plugins/editor/renderer.source.js`, `editor.css`, `debugging.js` | Companion collapse controls, provider-aware gutters/saves, and shared read-only diff mounting. |
| New `plugins/editor/diff.js` and `renderer/services/diffIntegration.js` | CodeMirror split/unified implementation owned by the Editor bundle; Git consumes a DOM factory and plain data. Keep CodeMirror classes/extensions inside one bundle. |
| `renderer/services/debugIntegration.js` and a shared main debugger registry | Register providers by ID, select by document/session, normalize stop events, and resolve run ownership. |
| `plugins/pydebug/` | Adapt to shared registry; retain Python bootstrap, validation, path handling, and persistence compatibility. Extract generic DAP framing without creating a dependency on enabled PyDebug. |
| New `plugins/jsdebug/` | Manifest, main/renderer, adapter setup, Node/browser session management, breakpoint/watch store, and styles. |
| New `plugins/git/` | Manifest, host-aware Git service, GitHub CLI service, diff snapshot/model, renderer, and styles. Git does not require the Run Configurations plugin. |
| Shared host-command service | Reuse existing local/SSH control-channel patterns with bounded execution and correct argument handling. Keep Git independent of run management; retain compatibility wrappers where needed. |
| `renderer/index.js`, `components/dockLayout.js`, `components/sessionTabs.js` | Generic availability predicates and terminal context-menu contributions. Every invocation carries the exact terminal context. |
| `plugins/run-configurations/configuration.js`, `manager.js`, `main.js`, new lifecycle module | Metadata validation, trusted stamping, expiry, launch guards, and cleanup. |
| `plugins/run-configurations/editor.js`, `renderer.js`, `style.css` | Project/origin filtering, expiry fields/badges, and debugger-neutral run controls. |
| `plugins/mcp-server/tools.js`, `main.js`, `projectConfigurations.js`, `renderer/services/mcpBridge.js` | New create/list contract, shared membership, expiry enforcement, summaries, receipts, and debugger-neutral run operations. |
| Project/state/library services | Persist account choices and reconcile removed configuration links in live and saved projects. |
| `main/constants.js`, settings UI/store, `preload.js` | Global settings, narrow updates, capability/path checks, and namespaced events. |
| `package.json`, lockfile, build scripts | CodeMirror merge dependency, adapter distribution strategy, test commands, and bundling. Regenerate `renderer.mjs` from source. |

Git IPC exchanges repository context, immutable comparison IDs, file summaries, old/new content or bounded patch data, and operation results. A comparison identifies host, worktree root, mode, and resolved base/head/index/worktree snapshots. Reject stale asynchronous responses after tab, account, branch, or project changes.

Debug IPC carries debugger/session IDs and stop generation; keep Python and JavaScript payloads normalized at the integration boundary without forcing their launch implementations to be identical. No live sockets, adapter handles, evaluated variables, or credentials are persisted.

Persistence changes are additive JSON changes under MarinaShell's existing application-data directory. No project source files, databases, or external cloud migrations are required. Keep old configurations and project IDs stable, normalize missing metadata lazily, and validate new enum/date/duration values. Back up affected libraries before the first migration; older application versions may drop unknown fields when saving, so document that downgrade limitation.

## Delivery order

1. **Debugger collapse:** implement global preference, reveal lifecycle, and Python UI regression coverage. This can ship independently.
2. **Configuration lifecycle:** add trusted metadata and expiry service, safe cleanup, project/origin filters, MCP contract, and migration coverage.
3. **Git diff:** add repository discovery and navigation hooks, CodeMirror viewer, changed-file sidebar, split/unified modes, hunk navigation, and branch comparisons for local and SSH hosts.
4. **Git operations:** add explicit stage/unstage, commit, fetch, fast-forward pull, push, and branch actions on the shared service.
5. **GitHub:** add CLI path/settings, per-project account selection, PR viewing/creation, and browser links using the established diff viewer.
6. **JavaScript Node debugger:** complete the adapter feasibility check, shared provider/run registry, local Node/npm/source maps, then SSH and attach flows. Retest Python with both plugins enabled.
7. **Browser JavaScript debugger:** add Chrome/Edge launch/attach and validate source mapping against a real frontend fixture.
8. **Integration and packaging:** run focused regressions, exercise the real desktop app, build a local package, and verify plugin/adapter assets. A published release is a separate action.

## Acceptance and verification

| Area | Required evidence |
| --- | --- |
| Collapse | Toggle survives file/project switches and restart; new breakpoint reveals; Continue restores preference; manual collapse during a pause remains respected; multiple panes do not reveal unrelated sessions. |
| Configuration lifecycle | Controlled-clock tests cover 15m/1h/3h/custom/Never, offline/sleep expiry, legacy records, active/unknown runs, renewal, save/cleanup/start races, and repeatable link removal. |
| Configuration filters | All/project/unassigned plus MCP include/exclude combinations work with duplicate names, multiple memberships, saved/closed projects, unsaved drafts, and expired active runs. |
| MCP | Origin cannot be spoofed; optional expiry is backward compatible; list filters respect grants; expired launch/restart fails clearly; a replayed create receipt never resurrects a retired definition. |
| Git discovery | Both entry points resolve the same repository; right-click targets the clicked pane; parent directories, worktrees, nested repositories, SSH, clean repos, non-Git directories, and disconnections behave correctly. |
| Diff viewer | Temporary repositories verify staged/unstaged/untracked and branch snapshots; split/unified show matching content and counts; Previous/Next reach the expected hunks; edge-case paths/binary/rename/conflict/large-file states work. |
| Git operations | Isolated repositories verify intended index/commit changes, hooks/signing errors, dirty branch switching, stale snapshots, failed fast-forward pull, failed push, and repeated-click prevention. No tests mutate the user's repositories. |
| GitHub | Stubbed CLI covers discovery/path errors, accounts, host/fork selection, truncated content, failed/uncertain creation, and URLs. Explicit test-repository validation confirms PR display and two projects using different accounts concurrently without changing global CLI identity. |
| Node debugging | Real local and SSH fixtures hit breakpoints in JS and source-mapped TS, inspect frames/variables, step/restart/stop, target npm children, preserve an externally attached process, and exercise both debugger plugins together. |
| Browser debugging | A real Chrome/Edge fixture loads a frontend, binds mapped source breakpoints, pauses/steps, and cleans up only an owned browser session. |
| Packaging | Packaged desktop app loads both new plugins, resolves the adapter outside development paths, and runs a real breakpoint and Git diff session. |

Extend existing editor, PyDebug, PyDebug UI, run, SSH-run, MCP, navigation, docking, workspace, and plugin-activation checks as their contracts change. Add focused Git/diff, expiry, and JavaScript-debugger suites. Run `git diff --check` for the finished implementation. Prefer existing MarinaShell project/run configurations for application validation; use a new terminal in that project when no suitable configuration exists.

## Decisions to validate during implementation

The one-hour MCP default, optional-plugin defaults, return-to-collapsed behavior after Continue, and initial Git-operation scope are proposed choices. They make this plan actionable without deleting existing configurations or requiring more decisions before implementation starts.

Resolve technical feasibility early: standalone js-debug reverse requests and child targeting, remote source-map paths, Windows adapter/runtime packaging, account-specific CLI credentials on each host, and complete PR content for forks. A failed spike must produce a concrete alternative before the dependent feature is marked complete.

## Primary references

- [CodeMirror merge API](https://codemirror.net/docs/ref/#merge): `MergeView`, `unifiedMergeView`, and next/previous chunk navigation.
- [Git diff documentation](https://git-scm.com/docs/git-diff): staged/working/branch comparisons, machine-readable line counts, and NUL-delimited paths.
- [Microsoft JavaScript debugger](https://github.com/microsoft/vscode-js-debug): standalone DAP adapter and supported targets.
- [GitHub CLI authentication switch](https://cli.github.com/manual/gh_auth_switch), [account-specific token lookup](https://cli.github.com/manual/gh_auth_token), and [environment](https://cli.github.com/manual/gh_help_environment): global account switching versus per-command authentication.
- [GitHub CLI PR creation](https://cli.github.com/manual/gh_pr_create) and [PR diffs](https://cli.github.com/manual/gh_pr_diff): explicit head/base/repository selection and diff retrieval.

## Implementation verification on 2026 10 17

Implemented the delivery phases in order. All 23 commands in the full regression batch passed, with no skipped tests. This includes existing Python/debugpy/Uvicorn, environment setup, SSH/tmux runs, editor, MCP permissions, workspace/navigation/docking, terminal reconnect, plugin activation, SSH configuration, and project/tunnel checks. New tests cover expiry and provenance, Git/diff/GitHub, standalone Node/npm/TypeScript debugging, external Node attach, SSH inspector forwarding, real Chrome launch/attach, and both debugger plugins together in Electron.

The Git UI also passed actual SSH discovery, Unicode file paths, counts, and content reads. GitHub PR creation uses CLI fixtures. Read-only live checks verified two authenticated accounts making concurrent requests with isolated project settings and fetched complete content for public microsoft/vscode-js-debug PR 2437. No PRs or global GitHub account settings were changed. Edge's adapter target is implemented but this machine's real browser validation uses Chrome. Windows/Linux builds remain CI validation work.

A repository SSH host alias was discovered during a read-only live GitHub check and is resolved through the execution host's effective SSH configuration before API requests.

Live CLI verification also caught and fixed SSH host-alias handling and the unsupported combination of gh --slurp with --jq. The regression fixture now covers compact paginated file lists and effective SSH host resolution.

The delivered macOS arm64 preview package is at `release/feature-preview-20261017/MarinaShell.app`. The package passed `codesign --verify --deep --strict`. Isolated Electron tests loaded the packaged app.asar resources for both Git and JSDebug, including actual SSH Git reads and a JavaScript breakpoint with the packaged executable used as the adapter's Node runtime. The existing installed application was not replaced.

Final follow-up checks passed for Git edge cases (including broken symlinks and oversized files), PR-tab navigation, the Git refresh race found during follow-up testing, Node ES modules, and safe child-target initialization. All recorded implementation test jobs have finished; no test process remains intentionally running.

Final package comparison verified 134 packaged source/assets byte for byte against the working tree. Production package metadata and runtime dependencies also match; electron-builder intentionally removes development scripts, devDependencies, and build configuration. The delivered copy passed code-signature verification after copying.
