'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { newer, releaseURL, verifyManifest, decodeEnvelope, fetchToFile, verifyArtifact } = require('./security');
const defaultConfig = require('./config');
class UpdateService extends EventEmitter {
  constructor({ version, cache, packaged, platform = process.platform, arch = process.arch, config = defaultConfig, download = fetchToFile, install, openInstaller, prepareRestart }) {
    super(); Object.assign(this, { version, cache, packaged, config, download, install, openInstaller, prepareRestart });
    this.target = `${platform}-${arch}`; this.preferences = { automaticChecks: true, automaticDownload: true };
    this.state = { status: packaged ? 'idle' : 'development', currentVersion: version, version: '', notes: '', progress: 0, error: '', canInstall: platform === 'darwin' && arch === 'arm64', preferences: this.preferences };
    this.preferenceSave = Promise.resolve();
    this.operation = null; this.pending = null; this.restarting = false;
  }
  snapshot() { return structuredClone(this.state); }
  set(patch) { Object.assign(this.state, patch, { preferences: this.preferences }); this.emit('change', this.snapshot()); return this.snapshot(); }
  async init() {
    await fs.mkdir(this.cache, { recursive: true, mode: 0o700 }); await fs.chmod(this.cache, 0o700);
    const saved = await fs.readFile(path.join(this.cache, 'preferences.json'), 'utf8').then(JSON.parse).catch(() => ({}));
    for (const key of Object.keys(this.preferences)) if (typeof saved[key] === 'boolean') this.preferences[key] = saved[key];
    this.set({});
    if (this.packaged && this.config.publicKey) {
      this.startupTimer = setTimeout(() => { if (this.preferences.automaticChecks) this.check().catch(() => {}); }, 15000); this.startupTimer.unref();
      this.timer = setInterval(() => { if (this.preferences.automaticChecks) this.check().catch(() => {}); }, 6 * 60 * 60 * 1000); this.timer.unref();
    }
    return this.snapshot();
  }
  stop() { clearTimeout(this.startupTimer); clearInterval(this.timer); }
  async configure(patch) {
    for (const key of Object.keys(this.preferences)) if (typeof patch?.[key] === 'boolean') this.preferences[key] = patch[key];
    const file = path.join(this.cache, 'preferences.json');
    const saved = JSON.stringify(this.preferences);
    this.preferenceSave = this.preferenceSave.catch(() => {}).then(async () => { await fs.writeFile(file + '.tmp', saved, { mode: 0o600 }); await fs.rename(file + '.tmp', file); });
    await this.preferenceSave;
    this.set({}); return this.snapshot();
  }
  check() {
    if (this.operation) return this.operation;
    if (this.restarting || this.state.status === 'ready') return Promise.resolve(this.snapshot());
    if (!this.packaged) return Promise.resolve(this.set({ status: 'development', error: 'Updates are available in the installed application.' }));
    this.operation = this.performCheck().catch(error => this.set({ status: 'error', error: error.message })).finally(() => { this.operation = null; });
    return this.operation;
  }
  async performCheck() {
    this.set({ status: 'checking', error: '', progress: 0 });
    releaseURL(this.config.feed, this.config.repository);
    const directory = await fs.mkdtemp(path.join(this.cache, 'check-'));
    try {
      const metadata = path.join(directory, 'latest.json');
      await this.download(this.config.feed, metadata, { limit: 512 * 1024, timeout: 60000 });
      const { bytes, signature } = decodeEnvelope(await fs.readFile(metadata));
      const manifest = verifyManifest(bytes, signature, this.config.publicKey, this.config.repository);
      if (!newer(manifest.version, this.version)) { await this.clearPending(); return this.set({ status: 'current', version: '', notes: '' }); }
      const artifact = manifest.platforms[this.target];
      if (!artifact) { await this.clearPending(); return this.set({ status: 'unsupported', version: '', notes: '', error: 'This release has no update package for this platform.' }); }
      if (this.pending?.directory) await fs.rm(this.pending.directory, { recursive: true, force: true });
      this.pending = { manifest, artifact, bytes, signature, directory };
      this.set({ status: 'available', installerKind: artifact.kind, version: manifest.version, notes: manifest.notes || '', error: '' });
      if (this.preferences.automaticDownload) await this.performDownload();
      return this.snapshot();
    } finally { if (this.pending?.directory !== directory) await fs.rm(directory, { recursive: true, force: true }); }
  }
  async clearPending() { const previous = this.pending; this.pending = null; if (previous?.directory) await fs.rm(previous.directory, { recursive: true, force: true }); }
  update() {
    if (this.operation) return this.operation;
    if (this.state.status === 'ready' || this.restarting) return Promise.resolve(this.snapshot());
    if (!this.pending) return this.check();
    this.operation = this.performDownload().catch(error => this.set({ status: 'error', error: error.message })).finally(() => { this.operation = null; });
    return this.operation;
  }
  async performDownload() {
    const pending = this.pending;
    if (!pending) throw new Error('Check for updates first.');
    verifyManifest(pending.bytes, pending.signature, this.config.publicKey, this.config.repository);
    const extension = pending.artifact.kind === 'app-tar-gz' ? '.app.tar.gz' : this.target.startsWith('win32') ? '.exe' : '.AppImage';
    const file = path.join(pending.directory, 'update' + extension);
    await fs.unlink(file).catch(() => {});
    this.set({ status: 'downloading', progress: 0, error: '' });
    try {
      await this.download(pending.artifact.url, file, { limit: pending.artifact.size, expectedSize: pending.artifact.size, onProgress: received => this.set({ progress: Math.min(99, Math.floor(received / pending.artifact.size * 100)) }) });
      await verifyArtifact(file, pending.artifact);
      pending.file = file; this.set({ status: 'ready', progress: 100 });
    } catch (error) { await fs.unlink(file).catch(() => {}); throw error; }
  }
  async restart() {
    if (this.restarting || this.operation || this.state.status !== 'ready' || !this.pending?.file) return this.snapshot();
    this.restarting = true;
    try {
      const pending = this.pending;
      verifyManifest(pending.bytes, pending.signature, this.config.publicKey, this.config.repository);
      await verifyArtifact(pending.file, pending.artifact);
      if (pending.artifact.kind !== 'app-tar-gz') {
        await this.openInstaller(pending.file, pending.artifact.kind); return this.snapshot();
      }
      const approved = await this.prepareRestart();
      if (!approved) return this.snapshot();
      this.set({ status: 'installing', error: '' });
      await this.install(pending);
      return this.snapshot();
    } catch (error) { return this.set({ status: 'ready', error: error.message }); }
    finally { this.restarting = false; }
  }
}
module.exports = { UpdateService };
