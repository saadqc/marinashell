const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { createHash, randomUUID } = require('crypto');

const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 20);
const xml = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const unxml = text => text.replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[entity]));
const label = text => String(text).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 80) || 'Project';
const failure = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
async function read(file) { try { return await fs.readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function atomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, value, { mode: 0o600 }); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}

// Tokenize JSON with comments so only the managed folders array needs replacing.
function workspaceJson(source) {
  const tokens = [];
  const pattern = /\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g;
  for (const match of source.matchAll(pattern)) {
    if (/^\s|^\/\//.test(match[0]) || match[0].startsWith('/*')) continue;
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  const clean = tokens.filter((token, index) => !(token.text === ',' && /^[}\]]$/.test(tokens[index + 1]?.text))).map(token => token.text).join(' ');
  const value = JSON.parse(clean);
  if (!value || Array.isArray(value) || !Array.isArray(value.folders)) throw new Error('Invalid folders array');
  let depth = 0; const ranges = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (depth === 1 && token.text === '"folders"' && tokens[i + 1]?.text === ':' && tokens[i + 2]?.text === '[') {
      let balance = 0;
      for (let j = i + 2; j < tokens.length; j++) {
        if (tokens[j].text === '[') balance++;
        if (tokens[j].text === ']' && --balance === 0) { ranges.push([tokens[i + 2].start, tokens[j].end]); break; }
      }
    }
    if (token.text === '{' || token.text === '[') depth++;
    if (token.text === '}' || token.text === ']') depth--;
  }
  if (ranges.length !== 1) throw new Error('Ambiguous folders array');
  return { value, range: ranges[0] };
}

async function resolveFolders(project) {
  const tabs = project.tabs.filter(tab => !tab.readOnly && !tab.runOutput);
  const remote = tabs.filter(tab => tab.host !== '__local__');
  if (remote.length) throw failure('REMOTE_UNSUPPORTED', 'External editor workspaces currently support local folders. This project includes remote folders:', { folders: remote.map(tab => `${tab.manualTitle || 'Folder'} · ${tab.host || 'No connection'} · ${tab.currentPath || ''}`) });
  const folders = [], missing = [], identities = new Set();
  for (const tab of tabs) {
    const directory = (tab.initialPath || (project.kind === 'project' ? tab.currentPath : tab.treeRootPath || tab.currentPath)) || '';
    try {
      if (typeof directory !== 'string' || !path.isAbsolute(directory) || /[\0\r\n]/.test(directory) || !(await fs.stat(directory)).isDirectory()) throw new Error('Invalid folder');
      const real = await fs.realpath(directory);
      if (!identities.has(real)) { folders.push({ name: String(tab.manualTitle || path.basename(directory)), path: real }); identities.add(real); }
    } catch { missing.push(directory || '(No folder configured)'); }
  }
  if (missing.length) throw failure('MISSING_FOLDERS', 'These project folders are missing or unavailable. Edit the saved setup or restore the folders, then try again.', { folders: missing });
  if (!folders.length) throw failure('NO_FOLDERS', 'This group has no local project folders to open.');
  return folders;
}

async function sourceSdk(directory) {
  const idea = path.join(directory, '.idea');
  try {
    for (const item of (await fs.readdir(idea)).filter(name => name.endsWith('.iml')).slice(0, 32)) {
      const content = await read(path.join(idea, item));
      const explicit = content?.match(/<orderEntry\b(?=[^>]*\btype="jdk")[^>]*\/>/)?.[0];
      if (explicit) return explicit;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const misc = await read(path.join(idea, 'misc.xml')) || '';
  const manager = misc.match(/<component\b[^>]*name=["']ProjectRootManager["'][^>]*>/)?.[0] || '';
  const name = manager.match(/\bproject-jdk-name=["']([^"']*)["']/)?.[1];
  const type = manager.match(/\bproject-jdk-type=["']([^"']*)["']/)?.[1];
  if (name && type) return `<orderEntry type="jdk" jdkName="${xml(unxml(name))}" jdkType="${xml(unxml(type))}" />`;
  return '<orderEntry type="inheritedJdk" />';
}

async function gitRoots(folders) {
  const roots = new Set();
  for (const folder of folders) {
    let directory = folder.path;
    while (true) {
      try { await fs.stat(path.join(directory, '.git')); roots.add(directory); break; } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return [...roots];
}

async function vcsUpdate(idea, roots, oldRoots) {
  const old = await read(path.join(idea, 'vcs.xml'));
  const mapping = directory => `<mapping directory="${xml(directory)}" vcs="Git" />`;
  if (old === null) return `<project version="4"><component name="VcsDirectoryMappings">${roots.map(mapping).join('')}</component></project>\n`;
  const section = old.match(/<component\b[^>]*name="VcsDirectoryMappings"[^>]*(?:\/>|>[\s\S]*?<\/component>)/);
  if (!section) throw failure('WORKSPACE_CONFLICT', 'The IDE repository mappings were changed. Open the existing project to review them.', { canUseExisting: true });
  const userRoots = new Set();
  const retained = section[0].replace(/<mapping\b[^>]*\/>/g, entry => {
    const directory = unxml(entry.match(/\bdirectory="([^"]*)"/)?.[1] || '');
    if ((oldRoots.includes(directory) || roots.includes(directory)) && !/\bvcs="Git"/.test(entry)) throw failure('WORKSPACE_CONFLICT', 'An IDE repository mapping was changed. Open the existing project to review it.', { canUseExisting: true });
    if (!oldRoots.includes(directory)) userRoots.add(directory);
    return oldRoots.includes(directory) ? '' : entry;
  });
  const mappings = roots.filter(directory => !userRoots.has(directory)).map(mapping).join('');
  const updated = retained.endsWith('/>') ? `<component name="VcsDirectoryMappings">${mappings}</component>` : retained.replace('</component>', `${mappings}</component>`);
  return old.replace(section[0], updated);
}

async function prepareWorkspace({ root, editor, project, folders, useExisting = false }) {
  const directory = path.join(root, hash(project.id), editor.id);
  const manifestFile = path.join(directory, 'marinashell.json');
  const previousText = await read(manifestFile);
  let previous;
  try { previous = previousText && JSON.parse(previousText); } catch { throw failure('WORKSPACE_CONFLICT', 'The saved editor workspace metadata has changed. Restore its metadata before opening it.'); }
  const manifest = previous || { version: 1, filename: `${label(project.name)}.${editor.family === 'sublime' ? 'sublime-project' : 'code-workspace'}` };
  // Metadata is local data, but never allow it to redirect writes outside its workspace.
  if (manifest.version !== 1 || typeof manifest.filename !== 'string' || path.basename(manifest.filename) !== manifest.filename) throw failure('WORKSPACE_CONFLICT', 'Invalid editor workspace metadata.');
  const target = editor.family === 'jetbrains' ? directory : path.join(directory, manifest.filename);
  const conflict = message => { throw failure('WORKSPACE_CONFLICT', message, { canUseExisting: true }); };
  if (useExisting) {
    if (!(await fs.stat(target)).isDirectory() && editor.family === 'jetbrains') throw failure('WORKSPACE_CONFLICT', 'The existing project is unavailable.');
    return { target, directory, existing: true };
  }
  const membership = JSON.stringify(folders);
  if (editor.family !== 'jetbrains') {
    const old = await read(target);
    let next;
    if (old !== null) {
      let parsed;
      try { parsed = workspaceJson(old); } catch { conflict('The workspace file cannot be safely updated. Open the existing workspace to review its folders, or cancel.'); }
      if (JSON.stringify(parsed.value.folders) !== JSON.stringify(manifest.folders)) conflict('The folders were changed in the editor. Open that existing workspace, or cancel and reconcile its folders with MarinaShell.');
      next = old.slice(0, parsed.range[0]) + JSON.stringify(folders, null, 2) + old.slice(parsed.range[1]);
      if (JSON.stringify(parsed.value.folders) === membership) next = old;
    } else {
      if (previous) conflict('The generated workspace file was removed. Restore it before reopening this workspace.');
      next = JSON.stringify({ folders }, null, 2) + '\n';
    }
    if (next !== old) await atomic(target, next);
  } else {
    const idea = path.join(directory, '.idea');
    const modulesFile = path.join(idea, 'modules.xml');
    const oldModules = await read(modulesFile);
    if (previous && !oldModules) conflict('The grouped IDE project was changed or removed. Restore it before opening.');
    if (!previous && oldModules) conflict('An existing IDE project occupies this workspace. Review it before opening.');
    const knownModules = [...(manifest.modules || []), ...(manifest.retiredModules || [])];
    for (const module of knownModules) {
      if (typeof module.file !== 'string' || path.basename(module.file) !== module.file || !module.file.endsWith('.iml')) conflict('Invalid module metadata.');
    }
    const usedNames = new Set(knownModules.map(module => module.file.toLowerCase()));
    const modules = folders.map(folder => {
      let file = knownModules.find(module => module.path === folder.path)?.file;
      if (!file) {
        file = `${label(folder.name)}.iml`;
        if (usedNames.has(file.toLowerCase())) file = `${label(folder.name)}-${hash(folder.path)}.iml`;
        usedNames.add(file.toLowerCase());
      }
      return { ...folder, file };
    });
    if (previous && oldModules) {
      const actual = [...oldModules.matchAll(/\bfilepath="([^"]+)"/g)].map(match => path.basename(unxml(match[1]))).sort();
      const expected = (manifest.modules || []).map(item => item.file).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) conflict('The IDE module list was edited. Open the existing project to review it, or cancel.');
      for (const module of manifest.modules || []) {
        if (typeof module.file !== 'string' || path.basename(module.file) !== module.file || !module.file.endsWith('.iml')) conflict('Invalid module metadata.');
        const content = await read(path.join(idea, module.file));
        const roots = [...(content || '').matchAll(/<content\b[^>]*\burl="([^"]+)"/g)].map(match => unxml(match[1]));
        if (roots.length !== 1 || roots[0] !== pathToFileURL(module.path).href) conflict('The IDE content roots were edited. Open the existing project to review them, or cancel.');
      }
    }
    const changed = !previous || JSON.stringify(manifest.folders) !== membership;
    const oldRepositories = manifest.vcsRoots || await gitRoots(manifest.folders || folders);
    const repositories = changed ? await gitRoots(folders) : oldRepositories;
    const vcs = changed ? await vcsUpdate(idea, repositories, oldRepositories) : null;
    const additions = [];
    for (const module of modules) {
      const file = path.join(idea, module.file);
      if (manifest.modules?.some(item => item.path === module.path)) continue;
      const existing = await read(file);
      if (existing !== null) {
        const roots = [...existing.matchAll(/<content\b[^>]*\burl="([^"]+)"/g)].map(match => unxml(match[1]));
        if (knownModules.some(item => item.path === module.path) && roots.length === 1 && roots[0] === pathToFileURL(module.path).href) continue;
        conflict('An untracked IDE module exists in this workspace. Review it before opening.');
      }
      let sdk = editor.id === 'webstorm' ? '<orderEntry type="inheritedJdk" />' : await sourceSdk(module.path);
      if (editor.id === 'idea' && sdk.includes('Python SDK')) sdk = '<orderEntry type="inheritedJdk" />';
      additions.push({ file, content: `<?xml version="1.0" encoding="UTF-8"?>\n<module type="${editor.moduleType}" version="4"><component name="NewModuleRootManager"><content url="${xml(pathToFileURL(module.path).href)}" />${sdk}<orderEntry type="sourceFolder" forTests="false" /></component></module>\n` });
    }
    for (const { file, content } of additions) await atomic(file, content);
    const definition = `<?xml version="1.0" encoding="UTF-8"?>\n<project version="4"><component name="ProjectModuleManager"><modules>${modules.map(module => `<module fileurl="file://$PROJECT_DIR$/.idea/${xml(module.file)}" filepath="$PROJECT_DIR$/.idea/${xml(module.file)}" />`).join('')}</modules></component></project>\n`;
    if (changed) {
      await atomic(modulesFile, definition);
      // IDE-owned workspace.xml, misc.xml, and module SDK choices are retained.
      await atomic(path.join(idea, 'vcs.xml'), vcs);
    }
    await atomic(path.join(idea, '.name'), project.name);
    manifest.modules = modules;
    manifest.retiredModules = knownModules.filter(module => !modules.some(active => active.path === module.path));
    manifest.vcsRoots = repositories;
  }
  manifest.folders = folders;
  await atomic(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  return { target, directory };
}
module.exports = { prepareWorkspace, resolveFolders, atomic, failure, hash, workspaceJson };
