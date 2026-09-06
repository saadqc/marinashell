const { randomUUID } = require('crypto');
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
const pathExpression = value => String(value).startsWith('~/') ? `"$HOME"/${quote(String(value).slice(2))}` : value === '~' ? '"$HOME"' : quote(value);

// Arguments are parsed as argv, never evaluated as shell source.
function parseArguments(text = '') {
  const result = []; let value = ''; let quoted = ''; let escape = false; let started = false;
  for (const char of String(text)) {
    if (escape) { value += char; escape = false; started = true; continue; }
    if (char === '\\' && quoted !== "'") { escape = true; started = true; continue; }
    if (quoted) { if (char === quoted) quoted = ''; else value += char; started = true; continue; }
    if (char === '"' || char === "'") { quoted = char; started = true; continue; }
    if (/\s/.test(char)) { if (started) { result.push(value); value = ''; started = false; } }
    else { value += char; started = true; }
  }
  if (escape || quoted) throw new Error('Arguments contain an unfinished quote or escape');
  if (started) result.push(value);
  return result;
}
function parseEnv(text) {
  const values = {};
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error(`Invalid environment variable on line ${i + 1}`);
    let value = match[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      const delimiter = value[0];
      let end = -1;
      const findEnd = () => { for (let j = 1; j < value.length; j++) if (value[j] === delimiter && (delimiter === "'" || value[j - 1] !== '\\')) return j; return -1; };
      while ((end = findEnd()) < 0 && i + 1 < lines.length) value += '\n' + lines[++i];
      if (end < 0 || !/^\s*(#.*)?$/.test(value.slice(end + 1))) throw new Error(`Invalid quoted environment value: ${match[1]}`);
      value = value.slice(1, end);
      if (delimiter === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else value = value.replace(/\s+#.*$/, '').trim();
    values[match[1]] = value;
  }
  return values;
}
function normalize(input) {
  const type = ['python', 'javascript', 'shell'].includes(input.type) ? input.type : 'python';
  const modes = type === 'python' ? ['script', 'module'] : type === 'javascript' ? ['script', 'module', 'npm'] : ['script', 'commands'];
  const config = {
    id: input.id || randomUUID(), name: String(input.name || '').trim(), type,
    host: String(input.host || '__local__'), mode: modes.includes(input.mode) ? input.mode : modes[0],
    target: String(input.target || ''), args: String(input.args || ''), cwd: String(input.cwd || '~'),
    interpreter: String(input.interpreter || (type === 'python' ? 'python3' : type === 'javascript' ? 'node' : '/bin/bash')),
    manager: String(input.manager || 'system'), managerPath: String(input.managerPath || ''), environment: String(input.environment || ''),
    envFiles: Array.isArray(input.envFiles) ? input.envFiles.map(String).filter(Boolean) : [],
    env: input.env && typeof input.env === 'object' && !Array.isArray(input.env) ? { ...input.env } : {},
    inheritEnv: input.inheritEnv !== false, sourceFile: String(input.sourceFile || ''),
    multiInstance: Boolean(input.multiInstance), tmux: Boolean(input.tmux), tmuxSession: String(input.tmuxSession || '')
  };
  if (!config.name) throw new Error('Configuration name is required');
  if (!config.target.trim()) throw new Error('Script, module, npm script, or shell commands are required');
  if (!['system', 'conda', 'mamba', 'micromamba', 'pyenv', 'nvm'].includes(config.manager)) throw new Error('Unknown environment manager');
  if (config.manager !== 'system' && !config.environment.trim()) throw new Error('Select an environment or version');
  if (config.tmux && config.host === '__local__') throw new Error('tmux execution is available for SSH only');
  if (config.tmuxSession && !/^[A-Za-z0-9_-]+$/.test(config.tmuxSession)) throw new Error('tmux session names may contain letters, digits, hyphens and underscores');
  for (const [key, value] of Object.entries(config.env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment variable: ${key}`);
    config.env[key] = String(value);
  }
  if (JSON.stringify(config).includes('\\u0000')) throw new Error('Configuration cannot contain null bytes');
  parseArguments(config.args);
  return config;
}
function buildCommand(config, fileEnv = {}) {
  const c = normalize(config);
  const lines = ['#!/usr/bin/env bash', 'set -e', `cd -- ${pathExpression(c.cwd)}`];
  // A clean environment retains only essentials used to locate an interpreter.
  if (!c.inheritEnv) lines.push('for key in $(compgen -e); do case "$key" in HOME|PATH|USER|TMPDIR|SHELL) ;; *) unset "$key" 2>/dev/null || true;; esac; done');
  const exports = Object.entries({ ...fileEnv, ...c.env }).map(([key, value]) => `export ${key}=${quote(value)}`);
  if (c.type === 'shell' && c.sourceFile) {
    // Source in the selected shell, so zsh startup files are never read by bash.
    const shellCode = `set -e\n. ${pathExpression(c.sourceFile)}\n${exports.join('\n')}\n${c.mode === 'commands' ? c.target : `set -- ${parseArguments(c.args).map(quote).join(' ')}\n. ${pathExpression(c.target)}`}`;
    lines.push(`exec ${pathExpression(c.interpreter)} -c ${quote(shellCode)} -- ${parseArguments(c.args).map(quote).join(' ')}`);
    return lines.join('\n');
  }
  if (c.manager === 'nvm') lines.push(`. ${pathExpression(c.managerPath || '~/.nvm/nvm.sh')}`, `nvm use ${quote(c.environment)} >/dev/null`);
  if (c.manager === 'pyenv') lines.push(`export PYENV_VERSION=${quote(c.environment)}`);
  lines.push(...exports);
  let executable = pathExpression(c.interpreter);
  const args = parseArguments(c.args).map(quote);
  let command;
  if (c.type === 'python') command = [executable, '-u', ...(c.mode === 'module' ? ['-m', quote(c.target)] : [pathExpression(c.target)]), ...args].join(' ');
  if (c.type === 'javascript') {
    if (c.mode === 'npm') {
      // Run npm with the selected Node runtime, including an explicit node path.
      const nodeDir = c.interpreter.includes('/') ? `$(dirname ${pathExpression(c.interpreter)})` : '';
      if (nodeDir) lines.push(`export PATH="${nodeDir}:$PATH"`);
      command = ['npm', 'run', quote(c.target), '--', ...args].join(' ');
    } else if (c.mode === 'module') {
      command = [executable, '--input-type=module', '-e', quote('await import(process.argv[1])'), quote(c.target), ...args].join(' ');
    } else command = [executable, pathExpression(c.target), ...args].join(' ');
  }
  if (c.type === 'shell') command = c.mode === 'commands'
    ? `${executable} -c ${quote(c.target)} -- ${args.join(' ')}`
    : `${executable} ${pathExpression(c.target)} ${args.join(' ')}`;
  if (['conda', 'mamba', 'micromamba'].includes(c.manager)) {
    const explicitEnv = Object.entries({ ...fileEnv, ...c.env }).map(([key, value]) => `${key}=${quote(value)}`);
    if (explicitEnv.length) command = `env ${explicitEnv.join(' ')} ${command}`;
    const selector = c.environment.includes('/') ? `-p ${pathExpression(c.environment)}` : `-n ${quote(c.environment)}`;
    command = `${pathExpression(c.managerPath || c.manager)} run ${c.manager === 'micromamba' ? '' : '--no-capture-output '} ${selector} ${command}`;
  } else if (c.manager === 'pyenv') command = `${pathExpression(c.managerPath || '~/.pyenv/bin/pyenv')} exec ${command}`;
  lines.push(`exec ${command}`);
  return lines.join('\n');
}
module.exports = { quote, pathExpression, parseArguments, parseEnv, normalize, buildCommand };
