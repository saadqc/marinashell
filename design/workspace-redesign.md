# MarinaShell workspace redesign

Reference: [Beekeeper Studio's interface](https://www.beekeeperstudio.io/features/easy-to-use). The useful cues are a stable sidebar, clearly selected work tabs, subdued charcoal surfaces, and contextual controls. This is an original MarinaShell implementation using its existing Electron, xterm, CodeMirror, Lucide, and CSS stack.

## Audit and direction

The previous UI put session controls across the entire window, plugin selectors beside duplicate split controls, and run controls on another toolbar. Files and port forwarding were hidden behind generic Files/Actions buttons. Plugin commands had no usable command surface. Runtime sidebar plugins duplicated selection logic. Repeated tool navigation recreated views. Closing a pane beside a nested split could leave an incomplete layout.

The replacement assigns each surface a distinct purpose:

- Header: app identity, Open menu (Connect to, Open project, New project), command/session search, sidebar toggle, settings.
- Unified left rail: open projects and Scratchpad above a divider, workspace tools below, and Extensions at the bottom. Selecting a project restores its active session and split layout.
- Tool rail: registered workspace views, plus extension discovery. tmux and screenshot actions stay in the terminal header because they operate on the terminal.
- Sidebar: selected project/session context and Files. Bookmarks, recents, and connection selectors are removed. Tunnels is an independent tool extension.
- Session strip: selected project’s terminal tabs, close controls, and new session. Beekeeper core-tabs geometry: 33.6px height (2.4 × 14px), 200px maximum width, 6px upper corners, 20px close targets, 11.9px text, and no active stripe.
- Pane toolbar: one Terminal header containing Layout and terminal actions. The duplicate content toolbar is removed.
- Beneath Files: run configuration dropdown and launch controls, plus an active-jobs list with green status dots. Inactive configurations remain selectable but are not listed.
- Footer: compact connection and resource status.

Shared palette tokens live in `renderer/theme.css`; extracted structural styles in `renderer/base.css`; shell composition in `renderer/workspace.css`. Settings and plugin surfaces use the same surface family. The visual direction favors predictable geometry, low motion, and moderate density (variance 3, motion 2, density 7). Existing bundled fonts, icon assets, terminal colors, group colors, and semantic statuses are retained where they carry meaning.

## Behavior

Command search supports plugin commands, sessions, tools, keyboard navigation, empty results, and focus restoration. Connection-dependent tools remain gated. New-session connection actions show loading and retryable errors. Sidebar plugins use the same selection logic as built-ins. Tool DOM/controllers are retained per pane during navigation and disposed when that pane is closed or the layout reset. Nested split closure preserves the remaining subtree. Session tabs support arrow, Home, and End navigation.

Persisted groups, tab titles/colors/order, connection preferences, and saved locations retain their existing schema. The existing saved-group library now also stores named project directories. Existing tunnel profiles migrate once to `tunnel-profiles.json`; deleting profiles does not reimport them.

Projects reconnect directories independently, so one failed SSH host does not block the others. Read-only configuration tabs never auto-execute. Tunnel profiles use dedicated SSH control sessions, validate port mappings, reject listener collisions, and can opt into starting when their SSH host connects. Terminal URL/file links and OSC8 hyperlinks require Command+click on macOS or Ctrl+click elsewhere.

Tab reference: [Beekeeper core-tabs.scss](https://github.com/beekeeper-studio/beekeeper-studio/blob/master/apps/studio/src/assets/styles/app/core-tabs.scss).

## Verification

- `npm run test:projects`: project validation, tunnel persistence/start/stop/retry, duplicate starts, remote/local port mapping, and real listener collision.
- `npm run test:navigation`: mixed-host project creation/reopen/splits, duplicate-open prevention, tunnel profile UI, modifier-click links, command execution, focus, empty search, extensions, settings, sidebar plugins, connection failure/retry, tool gating, retained view state, nested splits, responsive control bounds.
- `npm run test:workspace`: saved groups, configuration editing, run output, paste, tab overflow/wrap, persisted settings, resizing, sidebar collapse.
- `npm run test:editor`, `npm run test:runs`, `npm run test:ssh-config`, `npm run test:plugin-activation`.
- `npm run pack`: macOS ARM64 application package.
- `scripts/capture-demo.js --redesign`: real renderer and bundled plugin UI with synthetic data; normal/narrow workspace, search, editor, and Docker error-state captures under ignored `design/validation/`.

Live remote SSH/Docker/tmux operations and Windows/Linux packaging were not exercised by this UI redesign. Screenshots contain demonstration data only.
