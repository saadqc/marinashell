# MarinaShell v0.2.12

- Agents can authenticate with a fixed password you choose — pair a new agent with your own password or set one on an existing agent; stored encrypted, replacing one invalidates the old credential immediately.
- The agent scope editor nests configurations under their project in a tree (the standalone Configurations block is gone): checking a project selects its whole branch, individual configurations stay toggleable.
- Project→configuration links read from the live workspace, so configurations linked after saving a project no longer appear as unassigned.
