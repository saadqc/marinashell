# MarinaShell v0.2.17

- Agent permissions show expandable projects with their configurations, a separate future-configuration checkbox, and Check All / Uncheck All controls. Removed the two global project/configuration entries and the Unassigned pseudo-project.
- Saved permission selections now determine actual MCP access. Run=Allow no longer requires an invisible approval snapshot; expected revisions, Ask approvals, host/project scope, and port-cleanup permissions remain enforced. Future access covers newly created configurations without granting existing unchecked configurations.
- Configurations with missing project links are grouped under the unique matching host and directory. Failed MCP activity entries now show their target and reason.
- Configuration output appears in the top tab strip. Different runs open separate output tabs without replacing existing shell or output tabs; reopening the same run focuses its own tab.
