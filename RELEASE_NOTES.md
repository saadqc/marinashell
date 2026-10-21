# MarinaShell v0.2.25

MarinaShell can now check for updates, download them automatically, and ask when you want to restart.

- **Check for Updates** in the application menu and Settings.
- **Update** when a release is available, download progress, and **Restart and Update / Later** once it is verified.
- Separate settings for automatic checks and automatic downloads.
- Signed update metadata and verified downloads, with no paid Apple Developer membership required.
- On Apple silicon macOS, install after an explicit restart confirmation, preserve workspace state, block unsaved editor content, and roll back if the new app fails to complete startup. Terminal sessions can be interrupted by restarting; the confirmation explains this.
- Windows downloads a verified installer and offers **Open Installer**. Linux offers **Show Download** for its verified AppImage, which can then be replaced manually.

Install this version manually once to enable future in-app updates. The usual DMG, Windows installers, and Linux packages remain available; the additional archive, signatures, and JSON files are consumed by the updater.

The macOS application remains ad-hoc signed and not notarized. Gatekeeper may require approval in Privacy & Security. Update signatures authenticate the release independently of Apple's publisher verification.
