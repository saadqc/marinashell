# MarinaShell v0.2.26

Run configurations recover after an execution-host restart instead of leaving Run, Debug, Restart, and Stop disabled indefinitely.

- Runs from a verified previous host boot are marked ended, preserving their output and allowing a fresh launch.
- Stale single-instance locks from those runs are released when launching again.
- Unknown runs show an explanation and a **Check status** action directly in the sidebar, including when their output pane is closed.
- Runs whose process ownership cannot be verified on the current boot remain protected against duplicate launches and unsafe process signals.

Update from **Check for Updates** in MarinaShell v0.2.25 or later. On Apple silicon macOS, download the update and choose **Restart and Update** when ready. Existing configurations, run history, and workspace settings are preserved.
