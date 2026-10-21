# Application updates

Installed applications check after startup and periodically while running. Automatic checks and downloads are enabled initially and configurable independently. The application menu and Settings also provide a manual check. Available updates expose an Update action; a verified download offers a restart prompt. Choosing Later keeps the running application unchanged. Ordinary quit does not install an update.

## Trust and installation

MarinaShell uses Electron. Its updater authenticates the signed payload in `latest.json` with a pinned Ed25519 public key, then verifies the selected artifact's size and SHA-256 digest. Only HTTPS URLs for the official repository and GitHub's asset redirects are accepted. The private signing key is never bundled with the application.

Apple silicon macOS uses a complete ad-hoc-signed app archive. The updater validates archive paths and internal links, the application identifier and version, architecture, and the app's code signature. It stages the new app next to the installed app, waits for approved shutdown, replaces the bundle, and restores the previous app if startup is not acknowledged. Installation requires a writable application directory; move the app out of its DMG before updating. macOS may still require explicit Gatekeeper approval because the app is not notarized.

Restart is explicit. Unsaved editor buffers must be resolved first; workspace persistence must complete. The restart dialog warns about terminal sessions. Windows offers Open Installer for its verified downloaded installer. Linux offers Show Download for its verified AppImage and manual replacement.

## Release publishing

CI builds all three platforms and produces validated per-platform updater metadata. A separate publication job verifies the complete asset set, signs the combined manifest using the `UPDATER_SIGNING_PRIVATE_KEY` Actions secret, and verifies uploaded asset digests before publishing the versioned release. Only then does it advance the `updater` release's `latest.json` asset. The payload and its signature travel together in one envelope, so interrupted uploads cannot mix signatures from different releases. Artifact URLs point to immutable versioned releases. Older publication jobs cannot roll back the feed.

Keep a secure backup of the private signing key. Losing it prevents existing installations from accepting updates signed with a replacement key; any key rotation must be delivered through a release trusted by the existing key. The public key lives in `main/services/updater/config.js`.

The first updater-enabled version must be installed manually. Update metadata is public and contains only release information; it carries no local project paths, environment variables, credentials, or user configuration.
