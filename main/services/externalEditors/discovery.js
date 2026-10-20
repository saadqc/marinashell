const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { EDITORS } = require('./registry');

async function readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; } }
async function entries(directory) { try { return await fs.readdir(directory, { withFileTypes: true }); } catch { return []; } }
async function executable(file, platform) {
  try { return (await fs.stat(file)).isFile() && (platform === 'win32' || (await fs.access(file, 1), true)); } catch { return false; }
}

async function resolveInstallation(editor, location, { platform = process.platform } = {}) {
  if (typeof location === 'string' && location.startsWith('~/')) location = path.join(os.homedir(), location.slice(2));
  if (typeof location === 'string') location = location.replace(/[\\/]+$/, '');
  if (typeof location !== 'string' || /[\0\r\n]/.test(location) || !path.isAbsolute(location)) return null;
  if (platform === 'darwin' && location.endsWith('.app')) {
    const contents = path.join(location, 'Contents');
    if (editor.family === 'jetbrains') {
      const product = await readJson(path.join(contents, 'Resources/product-info.json'));
      if (!editor.productCodes.includes(product?.productCode)) return null;
      const launch = product.launch?.find(item => item.os === 'macOS' && item.arch === process.arch) || product.launch?.find(item => item.os === 'macOS');
      const file = launch && path.resolve(contents, 'Resources', launch.launcherPath);
      if (file && await executable(file, platform)) return { path: location, executable: file, version: product.version };
    } else if (editor.family === 'code') {
      const product = await readJson(path.join(contents, 'Resources/app/product.json'));
      if (!editor.commands.includes(product?.applicationName)) return null;
      const file = path.join(contents, 'Resources/app/bin', product.applicationName);
      if (await executable(file, platform)) return { path: location, executable: file, version: product.version || '' };
    } else {
      const file = path.join(contents, 'SharedSupport/bin/subl');
      if (await executable(file, platform)) return { path: location, executable: file, version: '' };
    }
    return null;
  }
  // Windows command wrappers need a shell. Prefer the actual application executable.
  if (platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(location)) return null;
  return await executable(location, platform) ? { path: location, executable: location, version: '' } : null;
}

async function candidates(editor, { platform, home, env }) {
  const list = [];
  const add = value => { if (value && !list.includes(value)) list.push(value); };
  if (platform === 'darwin') {
    for (const directory of ['/Applications', path.join(home, 'Applications')]) {
      for (const name of editor.apps) add(path.join(directory, `${name}.app`));
      if (editor.family === 'jetbrains') {
        const names = (await entries(directory)).map(item => item.name).sort().reverse();
        for (const name of names) if (name.endsWith('.app') && editor.apps.some(prefix => name.startsWith(`${prefix} `))) add(path.join(directory, name));
      }
    }
  }
  if (platform === 'win32') {
    for (const base of [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean)) {
      for (const suffix of editor.windows) add(path.join(base, suffix));
      if (editor.family === 'jetbrains') {
        const directory = path.join(base, 'JetBrains');
        for (const item of (await entries(directory)).sort((a, b) => b.name.localeCompare(a.name))) {
          if (editor.apps.some(name => item.name.toLowerCase().startsWith(name.toLowerCase()))) add(path.join(directory, item.name, 'bin', `${editor.commands[1]}.exe`));
        }
      }
    }
  }
  if (platform === 'linux') {
    for (const base of ['/opt', path.join(home, '.local/share')]) {
      for (const item of (await entries(base)).sort((a, b) => b.name.localeCompare(a.name))) {
        if (!editor.commands.some(name => item.name.toLowerCase().startsWith(name.replace(/64|\.sh/g, '')))) continue;
        for (const command of editor.commands) { add(path.join(base, item.name, 'bin', command)); add(path.join(base, item.name, command)); }
      }
    }
  }
  const directories = [...(env.PATH || '').split(path.delimiter), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/snap/bin', path.join(home, '.local/bin'),
    path.join(home, 'Library/Application Support/JetBrains/Toolbox/scripts'), path.join(home, '.local/share/JetBrains/Toolbox/scripts')];
  for (const directory of directories.filter(Boolean)) for (const command of editor.commands) {
    if (platform === 'win32') add(path.join(directory, `${command}.exe`));
    else add(path.join(directory, command));
  }
  return list;
}

function createDiscovery({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  let cache = null;
  async function detected(refresh = false) {
    if (refresh) cache = null;
    if (!cache) cache = Promise.all(EDITORS.map(async editor => {
      const installations = [];
      const seen = new Set();
      for (const candidate of await candidates(editor, { platform, home, env })) {
        const installation = await resolveInstallation(editor, candidate, { platform });
        if (!installation) continue;
        const identity = await fs.realpath(installation.executable);
        if (!seen.has(identity)) { installations.push(installation); seen.add(identity); }
      }
      return { id: editor.id, name: editor.name, family: editor.family, installations };
    })).catch(error => { cache = null; throw error; });
    return cache;
  }
  async function list(overrides = {}, refresh = false) {
    return Promise.all((await detected(refresh)).map(async item => {
      const override = overrides[item.id] || '';
      const selected = override ? await resolveInstallation(EDITORS.find(editor => editor.id === item.id), override, { platform }) : item.installations[0];
      return { ...item, override, path: selected?.path || override, version: selected?.version || '', status: selected ? 'available' : override ? 'invalid-path' : 'not-installed' };
    }));
  }
  return { list, resolve: (editor, location) => resolveInstallation(editor, location, { platform }) };
}
module.exports = { createDiscovery, resolveInstallation };
