# MarinaShell v0.2.27

Fixes macOS update installation failing with **Invalid package …/app.asar** after a successful download.

- Extracts application files outside Electron's virtual ASAR filesystem, retaining archive path/link limits, checksum verification and code-signature validation.
- Ships an unpacked macOS application so the existing v0.2.25 updater can install this release. Windows and Linux packaging is unchanged.
- Includes v0.2.26's recovery of run controls after execution-host restarts.
- Release checks now exercise extraction inside Electron, legacy update-package compatibility, packaged application startup/native terminals, and packed-app replacement/rollback.

If v0.2.26 installation already failed, **quit MarinaShell normally and reopen it**, then choose **Check for Updates** to download v0.2.27. When it is ready, choose **Restart and Update**. The normal reopen clears the failed pending update from memory. Your saved configuration and workspace data are preserved.
