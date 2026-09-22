# MarinaShell MCP server plugin — implementation plan

Status: implemented as the first bundled version. The approved design below remains the architectural reference.

## Delivered version

Settings → Agent access includes pairing, encrypted credentials, rotation/revocation, per-agent permissions and scopes, Start/Stop, restore-state control, metadata-only activity history, and a collapsible guide for Codex, Claude Code and ZCode. The plugin starts disabled with no exposed tools. Enabling or disabling this main-process extension preserves live terminals without reloading the workspace. Agent-created configurations and runs update the existing sidebar immediately.

The HTTP server uses `@modelcontextprotocol/sdk` 1.30.0 in stateless Streamable HTTP mode, supporting the SDK's negotiated protocol versions through 2025-11-25. It binds only 127.0.0.1, checks Host/Origin and bearer authentication, and limits request size, concurrency and duration. It does not implement the newer 2026 transport revision.

Implemented tools: terminals list/read/create/close; screenshots capture; configurations list/create/run/stop/restart; runs list/read; projects list/create/open/remove/close; layout get/set; processes list. Configuration updates and arbitrary pane trees remain follow-on work. Configuration creation accepts the core command/interpreter/port fields; richer environment and setup-script editing stays in the existing app editor.

Screenshots intentionally support a visible terminal rectangle only, with before/after visibility checks. Whole-workspace capture is not exposed. Closing managed run output tabs stays in the app, and project close refuses active managed runs. MCP Stop cannot inherit the UI's second-click force escalation; force termination requires both the explicit argument and permission. Restart additionally requires Run and Stop.

Write receipts survive restart and contain a request fingerprint, status and resulting target ID, not output or credentials. Duplicate IDs report `ALREADY_REQUESTED`; pending/interrupted writes report their uncertain status and are not automatically retried. No terminal input or arbitrary shell-exec tool is exposed. Automatic approval requests expire after 55 seconds; Stop/revocation cancels pending approval and broker responses. An already-dispatched connection or job operation may finish after cancellation and must be reconciled by listing state.

Validation uses real SDK clients for discovery/authentication/tool calls and a real isolated Electron app for encrypted pairing, restored local directories/layout, terminal reads, run creation/launch/output/stop, local approval, rotation and extension disable/re-enable. Platform-specific SSH behavior continues through the existing session/run adapters. Direct qualification in installed ZCode, Codex and Claude clients, remote SSH MCP workflows, and Windows/Linux packaged execution remain outside the local macOS validation; guide syntax was checked against their official documentation.

Guide sources: [Codex MCP](https://developers.openai.com/codex/mcp), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [ZCode MCP](https://zcode.z.ai/en/docs/mcp-services).

## Product behavior

An optional bundled `mcp-server` extension gives LLM clients controlled access to MarinaShell's projects, terminals, configurations, and layouts. Settings is the only place that can start the server or change its permissions. The extension is disabled initially.

Settings → Extensions → MCP server contains:

- Start / Stop, actual status (Stopped, Starting, Running, Stopping, Error), endpoint, last error, and connected/recent client activity.
- “Restore server state at startup.” When enabled, Start saves the desired running state and Stop saves the desired stopped state. Exiting MarinaShell stops the listener without changing that preference. The server runs only while the app runs.
- Port, loopback endpoint, client credentials, Copy connection configuration, Rotate credential, and revoke-client controls.
- A permissions table grouped into Terminals, Screenshots, Configurations, Projects, Layout, and Processes. Each tool has **Hidden**, **Ask**, or **Allow**. Hidden tools are omitted from discovery and rejected if called directly. Ask requests a local approval for that specific operation. Allow runs within the saved scope without repeated prompts.
- Scope selectors: allowed projects, local/SSH hosts, configurations, and whether ungrouped Scratchpad sessions are included. Newly added objects are excluded unless the user explicitly selects an “all” scope.
- An activity list showing client, tool, target, decision, timestamp, duration, and outcome. Terminal contents, screenshots, environment values, and tokens are not stored in the activity log.

Defaults: no exposed tools. Provide an optional “Read-only metadata” preset enabling list operations only. Reading terminal contents and screenshots remain separate choices because they reveal more than metadata. An “Ask before changes” preset is available, but the user can grant Allow explicitly.

## Tool contract

Every tool uses stable IDs, JSON schemas, bounded results, and typed errors. List results use pagination; object mutations carry a revision and a caller-provided idempotency key. Tools never select a target solely from whatever tab happens to be active.

| Tool | Inputs / result | Permission and behavior |
|---|---|---|
| `terminals.list` | Optional project/host; IDs, title, host alias, connection state, project ID | Metadata only; scope-filtered |
| `terminals.read` | Terminal ID, cursor or last N lines; text, next cursor, truncation flag | Saved scrollback only; default 500 lines, max 5,000 / 256 KB; no keystroke capture |
| `terminals.create` | Allowed host, project ID, directory, title | Creates/connects a session; handles SSH authentication in the local app |
| `terminals.close` | Terminal ID | Applies existing close/active-run rules; cannot silently force-stop jobs |
| `screenshots.capture` | Terminal/pane ID or allowed workspace; bounded PNG | App surfaces only; explicit screenshot permission and scope checks |
| `configurations.list` | Optional project/host; configuration summaries and revisions | No environment values or secret contents |
| `configurations.create` | Validated configuration schema, project links | Saves only, does not launch; permission clearly states this can define executable commands |
| `configurations.update` | ID, expected revision, patch | Optional follow-on tool; separately controlled from create/run |
| `configurations.run` | ID, expected revision, idempotency key | Launches through existing run manager; returns run ID immediately |
| `configurations.stop` | Run ID, optional force flag | Force stop is a separate permission; never implicit on timeout |
| `configurations.restart` | Run ID, expected configuration revision | Stop then launch through existing manager, same policy as run |
| `runs.list` / `runs.read` | Run filters / run ID and cursor | Scoped status and bounded output, separately controlled |
| `projects.list` | Saved/open filter; stable saved and live project IDs | Metadata only |
| `projects.create` | Name, directories/hosts, split layout | Validates and saves; does not open connections |
| `projects.open` | Saved project ID | Restores saved sessions/splits; requires connect permission for each host |
| `projects.remove` | Saved project ID and expected revision | Deletes the saved setup only; keeps live sessions and files |
| `projects.close` | Live project ID | Separate action; active-run stop requires appropriate permission/approval |
| `layout.get` | Live project or workspace ID | Returns validated structure and terminal IDs |
| `layout.set` | Target ID, expected revision, supported split layout | Reuses existing group layouts (1×1, 2×1, 1×2, 2×2); arbitrary pane trees are a later version |
| `processes.list` | Allowed host, name/port filter, sort, pagination | Optional adapter to the process-list collector; read-only |

Do not expose arbitrary IPC, JavaScript evaluation, OS screenshots, file-system access, credential retrieval, or a generic shell-exec tool in the first version. A future `terminals.write` tool needs its own broad execution permission; terminal text is not a trustworthy command boundary.

## Permission enforcement

The Electron main process owns the policy and validates it for both discovery and every execution. Renderer UI visibility is not authorization. Resolve target IDs to current objects before execution; reject stale, closed, cross-host, or out-of-scope IDs.

Composite actions check all implied capabilities. Opening a project can connect hosts. Restarting can kill a port if the saved configuration enables that option. Closing a project can stop a run. The approval view shows those effects explicitly. For allowlisted existing configurations, approval is bound to the configuration revision: changes to commands, setup scripts, host, directory, environment files, or port cleanup invalidate that approval. Granting unrestricted configuration creation plus execution is explicitly presented as code execution on those hosts; it cannot be made safe merely by hiding a generic shell tool.

Permission edits apply immediately to new calls and are checked again before queued actions execute. Revocation cancels queued/uncommitted work. Already-started runs are not killed just because access was revoked. Request-local Ask approvals expire, bind to the exact arguments/client/revision, and cannot be created or approved by another MCP tool. App-local settings remain the policy authority.

Terminal output and tool results are untrusted content, never permission instructions. Screenshot targets must exclude disallowed terminals/panes, password dialogs, settings credentials, and unrelated app windows. If clipping cannot reliably enforce the scope, deny the capture rather than return the full workspace.

## Architecture and repository integration

Create `plugins/mcp-server/{package.json,main.js,server.js,policy.js,tools/,settings.js}`. Use the official TypeScript SDK, pinned to a tested version. Bundle renderer assets through the existing plugin pipeline; do not introduce a frontend framework.

Use a lifecycle-owned local HTTP server in the main process. It calls a narrow application-services layer rather than invoking arbitrary `ipcMain` handlers. Extract/share existing operations:

- `main/services/sessionManager.js`: connection metadata and lifecycle.
- `plugins/run-configurations/manager.js`: run/start/stop/restart and the independent configuration store. Reuse the active manager instance; never create a second manager that loses run ownership.
- `main/app.js` saved-group handlers and `main/services/projects.js`: saved project validation/library operations.
- `renderer/components/savedGroups.js`, `sessionTabs.js`, and `dockLayout.js`: live project restoration, xterm scrollback, layout changes. Add a typed main↔renderer request broker with request IDs, deadlines, cancellation, allowed operations, and renderer-instance identity. Never accept arbitrary function names or code.
- `plugins/screenshot/main.js`: extract a reusable capture service with scope-aware rectangles. Do not route through screenshot download/copy dialogs.
- `main/services/settingsStore.js`: versioned nonsecret MCP preferences and permission schema. Add a dedicated settings section and validated main-process updates. Existing plugin enable/disable and shutdown hooks must stop the listener without duplicate activation.

Objects that require a renderer return `UI_UNAVAILABLE` during reload/closing and resume only once a new renderer announces readiness. Reads do not focus tabs. Capturing a hidden terminal may require a bounded offscreen render or an explicit focus option; do not silently change the user's active workspace.

## Transport and credentials

Proposed endpoint: `http://127.0.0.1:37651/mcp`, configurable port; no network/LAN binding in v1. A port collision leaves status Error and does not silently choose another port. Authenticate every request with a per-client high-entropy credential kept in OS-protected storage, not settings JSON or logs. Validate Origin and Host, bound body sizes and screenshot sizes, cap concurrent requests, and use constant-time token verification.

Implement Streamable HTTP using the SDK version's supported protocol revisions. The July 2026 transport differs from older session-based implementations; publish the supported versions and test a current client plus the intended older-client compatibility path. Avoid handwritten JSON-RPC transport code. The localhost/Origin/authentication choices follow the [official transport guidance](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).

Treat bearer pairing as the private local-client deployment mechanism, not a claim of a complete public OAuth authorization server. If general remote MCP clients or LAN access are added later, add TLS and the appropriate MCP authorization flow separately.

SDK tool declarations should carry accurate schemas, descriptions, output shapes, and annotations; policy remains authoritative regardless of annotations. Reference: [official tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

## Saved lifecycle and failures

Persist a versioned record with extension enablement, restore-state preference, desired running state, port, client IDs/credential references, tool permissions, scope IDs, and audit retention. Actual bound/running state is runtime-only.

State flow: Stopped → Starting → Running → Stopping → Stopped, with Error reporting bind/auth/configuration failures. Start/Stop are idempotent and serialized. App shutdown first stops accepting calls, drains bounded reads, cancels queued writes, closes the listener, and leaves user terminals/jobs governed by their existing lifecycle. Re-enabling an extension must not duplicate listeners or handlers. Crash recovery does not replay write operations; durable idempotency records distinguish committed outcomes from interrupted requests.

Use typed errors such as `PERMISSION_DENIED`, `APPROVAL_REQUIRED`, `TARGET_GONE`, `REVISION_CONFLICT`, `UI_UNAVAILABLE`, `DEPENDENCY_DISABLED`, `AUTH_REQUIRED`, and `TIMEOUT`. Redact error details that could include credentials. Long operations return operation/run IDs and expose bounded status polling.

## Delivery milestones and acceptance

1. **Service boundaries and settings:** schema migration, desired/actual lifecycle state, persistent Start/Stop, loopback listener, credentials, connection snippet, port-conflict handling. Verify restart/disable/re-enable/quit and no secret values in settings or logs.
2. **Read tools:** scoped lists, bounded terminal/run reads, layouts, process snapshots. Test hidden-tool direct calls, unknown IDs, pagination, disconnected SSH, PID/tab reuse, renderer reload, missing plugins, and oversized reads.
3. **Write tools:** existing run manager integration, configuration/project saves, project open/close, layout set, request-local approval and idempotency. Test duplicate network retries do not create duplicate sessions, projects, or processes; validate every implied effect and configuration revision change.
4. **Screenshots and client qualification:** scoped capture, blocked credential dialogs, image limits, SDK conformance, current and selected compatible clients, Windows/macOS/Linux packaging. Verify Stop revokes access, permission changes apply immediately, and background work does not change user focus unexpectedly.

Completion means the settings controls, persisted state, permission enforcement, all agreed tools, and a real LLM-client session work together. A listening HTTP port alone is not completion.
