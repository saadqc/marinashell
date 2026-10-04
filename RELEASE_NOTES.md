# MarinaShell v0.2.16

- Settings now use dedicated tabs. Agent access has a simple name and optional password form, an agent table, copyable credentials, token rotation, and manual password replacement without selecting an AI tool.
- Added a three-pane terminal layout with two panes on the left and one full-height pane on the right. Tab dragging also changes terminal order using left-to-right row order.
- Terminal context menus can create a new terminal on the right or below the clicked pane, inheriting its connection and directory. Custom splits and tab order survive saving and reopening groups.
- Open in editor and Tail last 500 lines require a selected, existing file. Empty, stale, missing, or inaccessible selections do nothing.
- Local Bash and Zsh startup no longer types setup scripts into the terminal. Settings offer Errors only (quiet), Info, or Debug startup messages while preserving shell profile output and errors.
- Fixed a queued terminal resize running after the terminal was closed.
