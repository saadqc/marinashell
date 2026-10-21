'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const tar = require('tar');
const { hashFile } = require('../main/services/updater/security');
const { validateBundle, extractArchive } = require('../main/services/updater/mac');
const config = require('../main/services/updater/config');
async function find(directory, predicate) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (predicate(file, entry)) return file;
    if (entry.isDirectory() && !entry.name.endsWith('.app')) { const result = await find(file, predicate); if (result) return result; }
  }
}
async function treeManifest(root) {
  const rows = [];
  async function walk(directory) { for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name), stat = await fs.lstat(file);
    const row = { path: path.relative(root, file), mode: stat.mode & 0o777, type: item.isSymbolicLink() ? 'link' : item.isDirectory() ? 'directory' : 'file' };
    if (item.isSymbolicLink()) row.link = await fs.readlink(file);
    else if (item.isDirectory()) await walk(file);
    else Object.assign(row, await hashFile(file));
    rows.push(row);
  } }
  await walk(root); return rows.sort((a, b) => a.path.localeCompare(b.path));
}
async function packageUpdate({ root = path.resolve(__dirname, '..'), output, platform = process.platform, arch = process.arch }) {
  const { version } = require(path.join(root, 'package.json'));
  const target = `${platform}-${arch}`;
  if (!['darwin-arm64', 'win32-x64', 'linux-x64'].includes(target)) throw new Error(`Unsupported update target: ${target}`);
  const directory = path.join(root, 'release', `MarinaShell-${version}`);
  await fs.mkdir(output, { recursive: true });
  let name, kind;
  if (target === 'darwin-arm64') {
    const app = await find(directory, (file, entry) => entry.isDirectory() && path.basename(file) === config.appName);
    if (!app) throw new Error('Packaged macOS app not found.');
    await validateBundle(app, config, version);
    name = `MarinaShell-${version}-darwin-arm64.app.tar.gz`; kind = 'app-tar-gz';
    await tar.c({ cwd: path.dirname(app), file: path.join(output, name), gzip: true, portable: true, noMtime: true }, [path.basename(app)]);
    const verifyDirectory = await fs.mkdtemp(path.join(output, '.verify-'));
    try {
      const restored = await extractArchive(path.join(output, name), verifyDirectory, config);
      await validateBundle(restored, config, version);
      const assert = require('node:assert/strict');
      assert.deepEqual(await treeManifest(restored), await treeManifest(app), 'Archived application differs from packaged application');
    } finally { await fs.rm(verifyDirectory, { recursive: true, force: true }); }
  } else {
    const original = await find(directory, file => target.startsWith('win32') ? /MarinaShell Setup .*\.exe$/.test(file) : file.endsWith('.AppImage'));
    if (!original) throw new Error('Packaged installer not found.');
    name = target.startsWith('win32') ? `MarinaShell.Setup.${version}.exe` : `MarinaShell-${version}.AppImage`;
    kind = target.startsWith('win32') ? 'nsis' : 'appimage'; await fs.copyFile(original, path.join(output, name));
  }
  const artifact = { name, kind, ...await hashFile(path.join(output, name)) };
  const metadata = { version, platform: target, artifact };
  await fs.writeFile(path.join(output, `updater-${target}.json`), JSON.stringify(metadata, null, 2) + '\n');
  return metadata;
}
if (require.main === module) {
  const at = process.argv.indexOf('--out-dir');
  const output = path.resolve(at >= 0 ? process.argv[at + 1] : 'updater-artifacts');
  packageUpdate({ output }).then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { packageUpdate, treeManifest };
