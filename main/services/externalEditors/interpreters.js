const fs = require('fs/promises');
const path = require('path');
const { failure } = require('./workspaces');
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const expression = value => value.startsWith('~/') ? `"$HOME"/${quote(value.slice(2))}` : value === '~' ? '"$HOME"' : quote(value);
const valid = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\0\r\n]/.test(value);
const absolute = value => valid(value) && path.posix.isAbsolute(value);
const within = (directory, root) => directory === root || directory.startsWith(root.endsWith('/') ? root : root + '/');
const selection = c => JSON.stringify([c.cwd || '', c.interpreter || 'python3', c.manager || 'system', c.managerPath || '', c.environment || '']);

function createInterpreterHandoff({ getConfigurations = () => [], getDefaults = () => [], command } = {}) {
  return async function forProject(project, folders, groupIds = [project.id]) {
    const ids = new Set([...(project.configurationIds || []), ...project.tabs.map(tab => tab.configurationId).filter(Boolean)]);
    const configurations = getConfigurations().filter(c => c.type === 'python' && (!ids.size || ids.has(c.id)) && !(c.expiresAt && Date.parse(c.expiresAt) <= Date.now()));
    const defaults = getDefaults().filter(c => groupIds.includes(c.id));
    const hosts = new Set(folders.map(folder => folder.hostId));
    const cache = new Map();
    async function query(host, text) {
      if (!command) throw new Error('Runtime discovery unavailable');
      return String(await command(host, text, { timeoutMs: 10000 })).trim();
    }
    async function canonical(host, directory) {
      if (!valid(directory)) return null;
      if (host === '__local__' && path.isAbsolute(directory)) {
        try { return await fs.realpath(directory); } catch { return null; }
      }
      if (absolute(directory)) return path.posix.normalize(directory);
      if (directory === '~' || directory.startsWith('~/')) {
        const resolved = await query(host, `cd -- ${expression(directory)} && pwd -P`);
        return absolute(resolved) ? resolved : null;
      }
      return null;
    }
    return async folder => {
      const host = folder.hostId === 'local' ? '__local__' : folder.hostId.slice(4);
      const fail = () => failure('INTERPRETER_UNRESOLVED', `The configured Python environment for “${folder.name}” could not be resolved. Choose an absolute Python interpreter in its run configuration, or enable runtime discovery. Setup scripts and environment files are not executed when opening an editor.`);
      try {
        const candidates = [];
        for (const c of configurations) {
          if (c.host !== host) continue;
          const cwd = await canonical(host, c.cwd);
          const owner = cwd && folders.filter(root => root.hostId === folder.hostId && within(cwd, root.path)).sort((a, b) => b.path.length - a.path.length)[0];
          if (owner === folder) candidates.push(c);
        }
        if (!candidates.length) for (const d of defaults) {
          // Legacy defaults have no host/type. Never spread those across mixed hosts.
          const python = d.type === 'python' || (!d.type && (['conda', 'mamba', 'micromamba', 'pyenv'].includes(d.manager) || /^python(?:\d+(?:\.\d+)*)?(?:\.exe)?$/.test(path.posix.basename(d.interpreter || ''))));
          if (!python || (d.host && d.host !== host)) continue;
          const cwd = await canonical(host, d.cwd);
          const owner = cwd && folders.filter(root => root.hostId === folder.hostId && within(cwd, root.path)).sort((a, b) => b.path.length - a.path.length)[0];
          if (owner !== folder) continue;
          if (!d.host && hosts.size !== 1) throw failure('INTERPRETER_CONFLICT', 'These older group defaults do not identify their connection. Save the Python defaults again before opening a mixed-host project in Islet.');
          candidates.push(d);
        }
        const selections = [...new Map(candidates.map(c => [selection(c), c])).values()];
        if (!selections.length) return undefined;
        async function resolveSelection(c) {
          const key = host + '\0' + selection(c);
          if (cache.has(key)) return cache.get(key);
          let interpreter = c.interpreter || 'python3';
          if (![interpreter, c.managerPath || 'unused', c.environment || 'unused'].every(valid) || interpreter.startsWith('-') || c.managerPath?.startsWith('-')) throw fail();
          const manager = c.manager || 'system';
          if (!absolute(interpreter) && !absolute(c.environment) && ((c.setupScripts || []).length || (c.envFiles || []).length || Object.keys(c.env || {}).some(key => ['PATH', 'PYENV_ROOT', 'PYENV_VERSION', 'MAMBA_ROOT_PREFIX', 'CONDA_ENVS_PATH'].includes(key)))) throw fail();
          if (!absolute(interpreter) && ['conda', 'mamba', 'micromamba'].includes(manager)) {
            if (!valid(c.environment)) throw fail();
            let prefix = c.environment;
            if (prefix === '~' || prefix.startsWith('~/')) prefix = await canonical(host, prefix);
            if (!prefix) throw fail();
            if (!absolute(prefix)) {
              const data = JSON.parse(await query(host, `runmgr=${expression(c.managerPath || manager)}; command -v "$runmgr" >/dev/null 2>&1 || runmgr=$(command -v ${quote(manager)}) || exit 127; "$runmgr" env list --json`));
              const matches = [...new Set((data.envs || []).filter(p => absolute(p) && path.posix.basename(p) === c.environment))];
              if (matches.length !== 1) throw fail();
              prefix = matches[0];
            }
            interpreter = path.posix.join(prefix, 'bin', /^python[\d.]*$/.test(interpreter) ? interpreter : 'python');
          } else if (!absolute(interpreter) && manager === 'pyenv') {
            if (!valid(c.environment) || c.environment.startsWith('-')) throw fail();
            const prefix = await query(host, `${expression(c.managerPath || '~/.pyenv/bin/pyenv')} prefix ${quote(c.environment)}`);
            if (!absolute(prefix)) throw fail();
            interpreter = path.posix.join(prefix, 'bin', /^python[\d.]*$/.test(interpreter) ? interpreter : 'python');
          } else if (!['system', 'conda', 'mamba', 'micromamba', 'pyenv'].includes(manager)) throw fail();
          if (host === '__local__' && path.isAbsolute(interpreter)) {
            await fs.access(interpreter, fs.constants.X_OK);
            if (!(await fs.stat(interpreter)).isFile()) throw fail();
          } else {
            const resolved = await query(host, `cd -- ${expression(c.cwd)} && p=$(command -v ${expression(interpreter)}) && [ -f "$p" ] && [ -x "$p" ] && case "$p" in /*) ;; *) p="$PWD/$p";; esac && printf '%s' "$p"`);
            if (!absolute(resolved)) throw fail();
            interpreter = resolved;
          }
          if (!absolute(interpreter)) throw fail();
          cache.set(key, interpreter);
          return interpreter;
        }
        const resolved = [...new Set(await Promise.all(selections.map(resolveSelection)))];
        for (const interpreter of resolved.slice(1)) {
          let same = false;
          if (path.posix.dirname(interpreter) === path.posix.dirname(resolved[0])) {
            same = host === '__local__'
              ? await fs.realpath(interpreter) === await fs.realpath(resolved[0])
              : await query(host, `[ ${quote(interpreter)} -ef ${quote(resolved[0])} ] && printf same || true`) === 'same';
          }
          if (!same) throw failure('INTERPRETER_CONFLICT', `More than one Python environment is configured for “${folder.name}”. Make its run configurations use the same interpreter before opening it in Islet.`);
        }
        return resolved[0];
      } catch (error) {
        if (error.code === 'INTERPRETER_CONFLICT' || error.code === 'INTERPRETER_UNRESOLVED') throw error;
        throw fail(); // Do not expose environment-manager output or configured secrets.
      }
    };
  };
}
module.exports = { createInterpreterHandoff };
