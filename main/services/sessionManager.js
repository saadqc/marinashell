const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec: execChildProcess } = require('child_process');
const pty = require('node-pty');
const SftpClient = require('ssh2-sftp-client');
require('ssh2');
const tunnelService = require('./tunnelService');
const { Client: SshClient } = require('ssh2');

const OSC7_PREFIX = '\u001b]7;file://';
const OSC7_BEL = '\u0007';
const OSC7_ST = '\u001b\\';
const MAX_PASSWORD_ATTEMPTS = 3;
const PASSWORD_PROMPT_REGEX = /(password:|passphrase[^:]*:)/i;
const WINDOWS_PROMPT_REGEX = /(?:^|[\r\n])\s*(?:PS\s+)?([A-Za-z]:\\[^\r\n>]*)>\s?/g;
const METRICS_INTERVAL_MS = 2000;
const METRICS_TIMEOUT_MS = 8000;
const METRICS_MARKERS = ['__MS_STAT__', '__MS_MEM__', '__MS_NET__', '__MS_DF__', '__MS_DF_ALL__'];

function normalizePosixCwd(value) {
  const cwd = String(value || '').trim();
  if (!cwd) return '/';
  // Only accept POSIX-like paths for remote `sh -c` commands.
  if (cwd.startsWith('/')) return cwd;
  return '/';
}

function buildSshMetricsCommand(cwd) {
  const safeCwd = normalizePosixCwd(cwd);
  const dfCwdPart = [
    `cd ${shellQuote(safeCwd)} 2>/dev/null && df -P -B1 . 2>/dev/null`,
    'df -P -B1 / 2>/dev/null',
    'true'
  ].join(' || ');
  return [
    'sh -c',
    shellQuote([
      'echo __MS_STAT__',
      'cat /proc/stat 2>/dev/null || true',
      'echo __MS_MEM__',
      'cat /proc/meminfo 2>/dev/null || true',
      'echo __MS_NET__',
      'cat /proc/net/dev 2>/dev/null || true',
      'echo __MS_DF__',
      dfCwdPart,
      'echo __MS_DF_ALL__',
      'df -P -B1 2>/dev/null || true'
    ].join('; '))
  ].join(' ');
}

function buildLocalDfCommand(cwd) {
  const target = String(cwd || '').trim() || os.homedir();
  // `-P` is portable; `-k` works on macOS + Linux and makes parsing easier.
  return `df -P -k ${shellQuote(target)} 2>/dev/null`;
}

function buildLocalDfAllCommand(cwd) {
  const target = String(cwd || '').trim() || os.homedir();
  const script = [
    'echo __MS_DF__',
    `df -P -k ${shellQuote(target)} 2>/dev/null || true`,
    'echo __MS_DF_ALL__',
    'df -P -k 2>/dev/null || true'
  ].join('; ');
  return ['sh -c', shellQuote(script)].join(' ');
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
}

function readSetting(settings, category, subcategory, field, fallback) {
  const node = settings && settings[category] && settings[category][subcategory]
    ? settings[category][subcategory][field]
    : null;
  if (node && Object.prototype.hasOwnProperty.call(node, 'value')) {
    return node.value;
  }
  return fallback;
}

function stripWrappingQuotes(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitArgs(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return [];
  }
  const args = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) {
    args.push(current);
  }
  return args;
}

function splitPathList(value) {
  return String(value || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildHostKey(hostConfig) {
  if (!hostConfig) return '';
  const host = hostConfig.hostName || hostConfig.alias || '';
  const user = hostConfig.user || process.env.USER || '';
  const port = hostConfig.port ? Number(hostConfig.port) : 22;
  return `${user}@${host}:${port}`;
}

function isAuthError(err) {
  if (!err) return false;
  if (err.level && String(err.level).toLowerCase().includes('authentication')) {
    return true;
  }
  const message = String(err.message || '').toLowerCase();
  return message.includes('authentication')
    || message.includes('permission denied')
    || message.includes('all configured authentication methods failed')
    || message.includes('auth fail');
}

function parseMarkedSections(stdout) {
  const text = String(stdout || '');
  const markers = METRICS_MARKERS;
  const sections = new Map();
  for (let i = 0; i < markers.length; i += 1) {
    const marker = markers[i];
    const start = text.indexOf(marker);
    if (start === -1) continue;
    const contentStart = start + marker.length;
    const end = i < markers.length - 1 ? text.indexOf(markers[i + 1], contentStart) : text.length;
    const chunk = end === -1 ? text.slice(contentStart) : text.slice(contentStart, end);
    sections.set(marker, chunk.trim());
  }
  return sections;
}

function parseProcStatCpu(section) {
  const lines = String(section || '').split(/\r?\n/);
  const cpuLine = lines.find((line) => line.startsWith('cpu '));
  if (!cpuLine) return null;
  const parts = cpuLine.trim().split(/\s+/).slice(1).map((v) => Number(v));
  if (parts.length < 4 || parts.some((v) => !Number.isFinite(v))) return null;
  const idle = parts[3] || 0;
  const iowait = parts[4] || 0;
  const idleAll = idle + iowait;
  const total = parts.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
  return { total, idle: idleAll };
}

function parseMemInfo(section) {
  const lines = String(section || '').split(/\r?\n/);
  let totalKb = null;
  let availKb = null;
  for (const line of lines) {
    const parts = line.split(':');
    if (parts.length < 2) continue;
    const key = parts[0].trim();
    const rest = parts.slice(1).join(':').trim();
    const value = Number(rest.split(/\s+/)[0]);
    if (!Number.isFinite(value)) continue;
    if (key === 'MemTotal') totalKb = value;
    if (key === 'MemAvailable') availKb = value;
  }
  if (totalKb == null) return null;
  return {
    memTotal: totalKb * 1024,
    memAvailable: availKb != null ? availKb * 1024 : null
  };
}

function parseNetDev(section) {
  const lines = String(section || '').split(/\r?\n/);
  let rx = 0;
  let tx = 0;
  for (const line of lines) {
    if (!line.includes(':')) continue;
    const [ifaceRaw, rest] = line.split(':', 2);
    const iface = (ifaceRaw || '').trim();
    if (!iface || iface === 'lo') continue;
    const fields = String(rest || '').trim().split(/\s+/);
    const rxBytes = Number(fields[0]);
    const txBytes = Number(fields[8]);
    if (Number.isFinite(rxBytes)) rx += rxBytes;
    if (Number.isFinite(txBytes)) tx += txBytes;
  }
  if (!Number.isFinite(rx) || !Number.isFinite(tx)) return null;
  return { rxBytes: rx, txBytes: tx };
}

function parseDfLinePortable(line, unitBytes) {
  const tokens = String(line || '').trim().split(/\s+/).filter(Boolean);
  // We support both Linux and macOS `df -P` output.
  // Strategy: find the first 3 integer tokens (blocks, used, available) and take the last token as mount.
  if (tokens.length < 6) return null;
  const mount = tokens[tokens.length - 1] || '';
  let firstNumIdx = -1;
  const nums = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (/^\d+$/.test(tokens[i])) {
      if (firstNumIdx === -1) firstNumIdx = i;
      nums.push(Number(tokens[i]));
      if (nums.length >= 3) break;
    }
  }
  if (nums.length < 3 || firstNumIdx === -1) return null;
  const filesystem = tokens.slice(0, firstNumIdx).join(' ');
  const total = nums[0] * unitBytes;
  const used = nums[1] * unitBytes;
  const available = nums[2] * unitBytes;
  const capacity = tokens.find((t) => /^\d+%$/.test(t)) || '';
  if (!Number.isFinite(total) || !Number.isFinite(used)) return null;
  return {
    filesystem,
    total,
    used,
    available: Number.isFinite(available) ? available : null,
    capacity,
    mount
  };
}

function parseDfList(section, unitBytes) {
  const lines = String(section || '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const body = lines.filter((line) => !String(line).trim().toLowerCase().startsWith('filesystem'));
  const entries = [];
  for (const line of body) {
    const parsed = parseDfLinePortable(line, unitBytes);
    if (!parsed || !parsed.mount) continue;
    entries.push(parsed);
  }
  return entries;
}

function parseDfSingle(section, unitBytes) {
  const list = parseDfList(section, unitBytes);
  return list.length ? list[0] : null;
}

function getDefaultLocalShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  if (process.env.SHELL) {
    return process.env.SHELL;
  }
  if (process.platform === 'darwin') {
    return '/bin/zsh';
  }
  return '/bin/bash';
}

function getDefaultLocalShellArgs(shellPath) {
  if (process.platform === 'win32') {
    return [];
  }
  const base = path.basename(shellPath || '').toLowerCase();
  const normalized = base.endsWith('.exe') ? base.slice(0, -4) : base;
  if (normalized === 'zsh' || normalized === 'bash') {
    return ['-l'];
  }
  return [];
}

function getMacBrewEntries() {
  const entries = [];
  if (fs.existsSync('/opt/homebrew/bin')) {
    entries.push('/opt/homebrew/bin');
  }
  if (fs.existsSync('/opt/homebrew/sbin')) {
    entries.push('/opt/homebrew/sbin');
  }
  if (fs.existsSync('/usr/local/bin')) {
    entries.push('/usr/local/bin');
  }
  if (fs.existsSync('/usr/local/sbin')) {
    entries.push('/usr/local/sbin');
  }
  return entries;
}

function shouldInjectMacPaths(settings) {
  return Boolean(readSetting(settings, 'shell', 'local', 'injectMacPaths', true));
}

function getLocalPathPrependEntries(settings) {
  const entries = [];
  if (process.platform === 'darwin' && shouldInjectMacPaths(settings)) {
    entries.push(...getMacBrewEntries());
  }
  const configured = readSetting(settings, 'shell', 'local', 'pathPrepend', '');
  const normalized = String(configured || '').trim();
  if (normalized && normalized.toLowerCase() !== 'auto') {
    entries.push(...splitPathList(normalized));
  }
  return mergePathEntries(entries, []);
}

function buildLocalBootstrapScript(settings) {
  if (process.platform === 'win32') {
    return '';
  }
  const prependEntries = getLocalPathPrependEntries(settings);
  if (!prependEntries.length) {
    return '';
  }
  const quotedEntries = prependEntries.map((entry) => shellQuote(entry)).join(' ');
  return [
    '__marinashell_prepend_path() {',
    '  local entry',
    `  for entry in ${quotedEntries}; do`,
    '    case ":$PATH:" in',
    '      *":$entry:"*) ;;',
    '      *) PATH="$entry:$PATH";;',
    '    esac',
    '  done',
    '  export PATH',
    '}',
    '__marinashell_prepend_path'
  ].join('\n');
}

function readLines(filepath) {
  try {
    return fs.readFileSync(filepath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    return [];
  }
}

function getMacPathEntries() {
  const entries = [];
  for (const line of readLines('/etc/paths')) {
    entries.push(line);
  }
  try {
    const extraFiles = fs.readdirSync('/etc/paths.d').sort();
    for (const filename of extraFiles) {
      const fullPath = path.join('/etc/paths.d', filename);
      for (const line of readLines(fullPath)) {
        entries.push(line);
      }
    }
  } catch (err) {
  }
  return entries;
}

function mergePathEntries(primary, extra) {
  const seen = new Set();
  const merged = [];
  for (const entry of primary) {
    if (entry && !seen.has(entry)) {
      seen.add(entry);
      merged.push(entry);
    }
  }
  for (const entry of extra) {
    if (entry && !seen.has(entry)) {
      seen.add(entry);
      merged.push(entry);
    }
  }
  return merged;
}

function buildLocalEnv(shellPath, settings) {
  const env = { ...process.env };
  if (process.platform === 'darwin') {
    const baseEntries = String(env.PATH || '')
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const systemEntries = getMacPathEntries();
    const brewEntries = shouldInjectMacPaths(settings) ? getMacBrewEntries() : [];
    const merged = mergePathEntries([...brewEntries, ...baseEntries], systemEntries);
    if (merged.length) {
      env.PATH = merged.join(path.delimiter);
    }
  }
  if (shellPath) {
    env.SHELL = shellPath;
  }
  return env;
}

function parseOsc7Payload(payload) {
  const slashIndex = payload.indexOf('/');
  const pathPart = slashIndex >= 0 ? payload.slice(slashIndex) : '/';
  if (!pathPart) {
    return '/';
  }
  try {
    return decodeURIComponent(pathPart);
  } catch (err) {
    return pathPart;
  }
}

function consumeOsc7Sequences(session, data) {
  session.osc7Buffer += data;
  const paths = [];
  let index = session.osc7Buffer.indexOf(OSC7_PREFIX);
  while (index !== -1) {
    const start = index + OSC7_PREFIX.length;
    const belIndex = session.osc7Buffer.indexOf(OSC7_BEL, start);
    const stIndex = session.osc7Buffer.indexOf(OSC7_ST, start);
    let end = -1;
    let endLength = 0;
    if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) {
      end = belIndex;
      endLength = 1;
    } else if (stIndex !== -1) {
      end = stIndex;
      endLength = 2;
    }
    if (end === -1) {
      break;
    }
    const payload = session.osc7Buffer.slice(start, end);
    const pathValue = parseOsc7Payload(payload);
    if (pathValue) {
      paths.push(pathValue);
    }
    session.osc7Buffer = session.osc7Buffer.slice(end + endLength);
    index = session.osc7Buffer.indexOf(OSC7_PREFIX);
  }

  if (session.osc7Buffer.length > 4096) {
    session.osc7Buffer = session.osc7Buffer.slice(-4096);
  }

  return paths;
}

function detectPasswordPrompt(session, data) {
  if (!session || !data) return false;
  if (session.authWindowUntil && Date.now() > session.authWindowUntil) {
    if (!session.pendingPassword && !session.passwordPromptPromise && !session.awaitingPassword) {
      return false;
    }
  }
  session.promptBuffer = `${session.promptBuffer || ''}${data}`;
  if (session.promptBuffer.length > 512) {
    session.promptBuffer = session.promptBuffer.slice(-512);
  }
  if (PASSWORD_PROMPT_REGEX.test(session.promptBuffer)) {
    session.promptBuffer = '';
    return true;
  }
  return false;
}

function detectWindowsPromptCwd(session, data) {
  if (!session || !data) return null;
  const cleaned = stripAnsi(data);
  session.cwdBuffer = `${session.cwdBuffer || ''}${cleaned}`;
  if (session.cwdBuffer.length > 1024) {
    session.cwdBuffer = session.cwdBuffer.slice(-1024);
  }
  let match = null;
  let lastPath = null;
  while ((match = WINDOWS_PROMPT_REGEX.exec(session.cwdBuffer)) !== null) {
    lastPath = match[1];
  }
  if (lastPath) {
    session.cwdBuffer = '';
    return lastPath;
  }
  return null;
}

function injectPromptTracking(session, settings) {
  if (!session || !session.ptyProcess) {
    return;
  }
  const parts = [];
  const localBootstrap = session.sessionType === 'local'
    ? buildLocalBootstrapScript(settings)
    : '';
  if (localBootstrap) {
    parts.push(localBootstrap);
  }
  parts.push(' __marinashell_pwd() { printf "\\033]7;file://%s%s\\007" "${HOSTNAME:-localhost}" "$PWD"; }; if [ -n "$ZSH_VERSION" ]; then precmd_functions+=(__marinashell_pwd); else export PROMPT_COMMAND="__marinashell_pwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"; fi');
  session.ptyProcess.write(`${parts.join('\n')}\n`);
}

function createSessionManager({ sendToRenderer, logDebug, getSettings, requestPassword, passwordStore }) {
  const sessions = new Map();

  function getSession(tabId) {
    if (!tabId) {
      return null;
    }
    if (!sessions.has(tabId)) {
      sessions.set(tabId, {
        ptyProcess: null,
        sftpClient: null,
        listCache: new Map(),
        osc7Buffer: '',
        promptBuffer: '',
        cwdBuffer: '',
        lastCwd: '',
        hostConfig: null,
        sessionType: null,
        passwordPromptPromise: null,
        passwordAttempts: 0,
        awaitingPassword: false,
        pendingPassword: null,
        lastPassword: null,
        rememberPassword: false,
        hostKey: '',
        authWindowUntil: 0,
        tunnelClient: null,
        activeTunnels: new Set(),
        disconnecting: false,
        metricsTimer: null,
        metricsInFlight: false,
        metricsPrev: null
      });
    }
    return sessions.get(tabId);
  }

  function send(channel, payload) {
    if (typeof sendToRenderer === 'function') {
      sendToRenderer(channel, payload);
    }
  }

  function getLocalExecContext() {
    const settings = typeof getSettings === 'function' ? getSettings() : null;
    const commandSetting = readSetting(settings, 'shell', 'local', 'command', '');
    const normalizedCommand = stripWrappingQuotes(commandSetting);
    const useDefault = !normalizedCommand || normalizedCommand.toLowerCase() === 'auto';
    let shell = useDefault ? getDefaultLocalShell() : normalizedCommand;
    // `child_process.exec` expects a shell path (no args). If misconfigured, fall back.
    if (/\s/.test(shell)) {
      shell = getDefaultLocalShell();
    }
    const env = buildLocalEnv(shell, settings);
    return { shell, env };
  }

  function execLocalCommand(command, timeoutMs) {
    const { shell, env } = getLocalExecContext();
    return new Promise((resolve) => {
      execChildProcess(
        command,
        {
          shell,
          env,
          timeout: timeoutMs > 0 ? timeoutMs : undefined,
          maxBuffer: 10 * 1024 * 1024
        },
        (err, stdout, stderr) => {
          if (!err) {
            resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: 0 });
            return;
          }
          const code = typeof err.code === 'number' ? err.code : 1;
          const out = stdout || '';
          const errOut = stderr || (err && err.message ? String(err.message) : '');
          resolve({ stdout: out, stderr: errOut, exitCode: code });
        }
      );
    });
  }

  function getMetricsClient(session) {
    if (session && session.sftpClient && session.sftpClient.client && typeof session.sftpClient.client.exec === 'function') {
      return session.sftpClient.client;
    }
    if (session && session.tunnelClient && typeof session.tunnelClient.exec === 'function') {
      return session.tunnelClient;
    }
    return null;
  }

  function execWithClient(client, command, timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer = null;
      let stdout = '';
      let stderr = '';
      let exitCode = null;
      let streamRef = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };

      client.exec(command, (err, stream) => {
        if (err) {
          cleanup();
          reject(err);
          return;
        }
        streamRef = stream;

        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            cleanup();
            try {
              streamRef && typeof streamRef.close === 'function' ? streamRef.close() : streamRef.destroy();
            } catch (e) { }
            reject(new Error('Remote command timed out'));
          }, timeoutMs);
        }

        stream.on('data', (chunk) => { stdout += chunk.toString(); });
        if (stream.stderr && typeof stream.stderr.on === 'function') {
          stream.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        }
        stream.on('exit', (code) => { exitCode = code; });
        stream.on('close', () => {
          cleanup();
          resolve({ stdout, stderr, exitCode });
        });
        stream.on('error', (streamErr) => {
          cleanup();
          reject(streamErr);
        });
      });
    });
  }

  function stopMetrics(tabId) {
    const session = getSession(tabId);
    if (!session) return;
    if (session.metricsTimer) {
      clearInterval(session.metricsTimer);
      session.metricsTimer = null;
    }
    session.metricsInFlight = false;
    session.metricsPrev = null;
    send('ssh:metrics', { tabId, connected: false });
  }

  async function pollMetrics(tabId) {
    const session = getSession(tabId);
    if (!session) return;
    if (session.disconnecting) return;
    if (!session.hostConfig || (session.sessionType !== 'ssh' && session.sessionType !== 'local')) return;
    if (session.metricsInFlight) return;

    session.metricsInFlight = true;
    try {
      const now = Date.now();
      const payload = { tabId, connected: true };

      if (session.sessionType === 'ssh') {
        const client = getMetricsClient(session);
        if (!client) return;
        const cmd = buildSshMetricsCommand(session.lastCwd);
        const { stdout } = await execWithClient(client, cmd, METRICS_TIMEOUT_MS);
        const sections = parseMarkedSections(stdout);

        const cpu = parseProcStatCpu(sections.get('__MS_STAT__'));
        const mem = parseMemInfo(sections.get('__MS_MEM__'));
        const net = parseNetDev(sections.get('__MS_NET__'));
        const disk = parseDfSingle(sections.get('__MS_DF__'), 1);
        const disksAll = parseDfList(sections.get('__MS_DF_ALL__'), 1);

        payload.host = session.hostConfig.hostName || session.hostConfig.alias || '';
        payload.user = session.hostConfig.user || process.env.USER || '';

        if (mem && mem.memTotal != null) {
          payload.memTotal = mem.memTotal;
          if (mem.memAvailable != null) {
            payload.memUsed = Math.max(0, mem.memTotal - mem.memAvailable);
          }
        }

        if (disk && disk.total != null) {
          payload.diskTotal = disk.total;
          payload.diskUsed = disk.used;
          if (disk.mount) payload.diskMount = disk.mount;
          if (disk.filesystem) payload.diskFs = disk.filesystem;
        }

        if (disksAll && disksAll.length) {
          payload.disks = disksAll.map((d) => ({
            filesystem: d.filesystem || '',
            mount: d.mount || '',
            total: d.total,
            used: d.used,
            available: d.available
          }));
        }

        if (cpu && cpu.total != null && cpu.idle != null) {
          if (session.metricsPrev && session.metricsPrev.cpuTotal != null && session.metricsPrev.cpuIdle != null) {
            const totalDelta = cpu.total - session.metricsPrev.cpuTotal;
            const idleDelta = cpu.idle - session.metricsPrev.cpuIdle;
            if (totalDelta > 0) {
              payload.cpuPct = Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
            }
          }
        }

        if (net && Number.isFinite(net.rxBytes) && Number.isFinite(net.txBytes)) {
          if (session.metricsPrev && session.metricsPrev.netAt && Number.isFinite(session.metricsPrev.rxBytes) && Number.isFinite(session.metricsPrev.txBytes)) {
            const dt = (now - session.metricsPrev.netAt) / 1000;
            if (dt > 0) {
              payload.rxBps = Math.max(0, (net.rxBytes - session.metricsPrev.rxBytes) / dt);
              payload.txBps = Math.max(0, (net.txBytes - session.metricsPrev.txBytes) / dt);
            }
          }
        }

        session.metricsPrev = {
          cpuTotal: cpu ? cpu.total : null,
          cpuIdle: cpu ? cpu.idle : null,
          rxBytes: net ? net.rxBytes : null,
          txBytes: net ? net.txBytes : null,
          netAt: now
        };
      } else {
        // Local session: best-effort metrics. CPU/mem from Node, disk via `df`.
        payload.host = os.hostname();
        payload.user = process.env.USER || process.env.USERNAME || '';

        try {
          const totalMem = os.totalmem();
          const freeMem = os.freemem();
          if (Number.isFinite(totalMem) && totalMem > 0) {
            payload.memTotal = totalMem;
            payload.memUsed = Math.max(0, totalMem - (Number.isFinite(freeMem) ? freeMem : 0));
          }
        } catch (err) { }

        try {
          const cpus = os.cpus();
          if (Array.isArray(cpus) && cpus.length) {
            let total = 0;
            let idle = 0;
            for (const cpu of cpus) {
              const times = cpu && cpu.times ? cpu.times : null;
              if (!times) continue;
              total += (times.user || 0) + (times.nice || 0) + (times.sys || 0) + (times.idle || 0) + (times.irq || 0);
              idle += (times.idle || 0);
            }
            if (session.metricsPrev && session.metricsPrev.cpuTotal != null && session.metricsPrev.cpuIdle != null) {
              const totalDelta = total - session.metricsPrev.cpuTotal;
              const idleDelta = idle - session.metricsPrev.cpuIdle;
              if (totalDelta > 0) {
                payload.cpuPct = Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
              }
            }
            session.metricsPrev = { ...(session.metricsPrev || {}), cpuTotal: total, cpuIdle: idle, netAt: now };
          }
        } catch (err) { }

        if (process.platform !== 'win32') {
          try {
            const cwd = session.lastCwd || os.homedir();
            const cmd = buildLocalDfAllCommand(cwd);
            const { stdout } = await new Promise((resolve) => {
              execChildProcess(cmd, { timeout: METRICS_TIMEOUT_MS }, (error, out, _err) => {
                if (error) return resolve({ stdout: '' });
                resolve({ stdout: out || '' });
              });
            });
            const sections = parseMarkedSections(stdout);
            const disk = parseDfSingle(sections.get('__MS_DF__'), 1024);
            const disksAll = parseDfList(sections.get('__MS_DF_ALL__'), 1024);
            if (disk && disk.total != null) {
              payload.diskTotal = disk.total;
              payload.diskUsed = disk.used;
              if (disk.mount) payload.diskMount = disk.mount;
              if (disk.filesystem) payload.diskFs = disk.filesystem;
            }
            if (disksAll && disksAll.length) {
              payload.disks = disksAll.map((d) => ({
                filesystem: d.filesystem || '',
                mount: d.mount || '',
                total: d.total,
                used: d.used,
                available: d.available
              }));
            }
          } catch (err) { }
        }
      }

      send('ssh:metrics', payload);
    } catch (err) {
      send('ssh:metrics', {
        tabId,
        connected: true,
        host: session.sessionType === 'local'
          ? os.hostname()
          : (session.hostConfig && (session.hostConfig.hostName || session.hostConfig.alias) ? (session.hostConfig.hostName || session.hostConfig.alias) : ''),
        user: session.sessionType === 'local'
          ? (process.env.USER || process.env.USERNAME || '')
          : (session.hostConfig && session.hostConfig.user ? session.hostConfig.user : (process.env.USER || ''))
      });
    } finally {
      session.metricsInFlight = false;
    }
  }

  function startMetrics(tabId) {
    const session = getSession(tabId);
    if (!session) return;
    if (session.sessionType !== 'ssh' && session.sessionType !== 'local') return;
    stopMetrics(tabId);
    session.metricsTimer = setInterval(() => {
      pollMetrics(tabId).catch(() => { });
    }, METRICS_INTERVAL_MS);
    pollMetrics(tabId).catch(() => { });
  }

  async function exec(tabId, command, options = {}) {
    const session = getSession(tabId);
    if (!session) throw new Error('Invalid tab');
    const timeoutMs = options.timeoutMs === undefined ? 20000 : Number(options.timeoutMs);
    if (session.sessionType === 'local') {
      return execLocalCommand(command, timeoutMs);
    }
    if (!session.hostConfig) {
      throw new Error('Not connected');
    }

    if (!session.tunnelClient) {
      await ensureTunnelConnection(tabId, session.hostConfig);
    }
    const client = session.tunnelClient;

    return new Promise((resolve, reject) => {
      let timer = null;
      let stdout = '';
      let stderr = '';
      let exitCode = null;
      let streamRef = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };

      client.exec(command, (err, stream) => {
        if (err) {
          cleanup();
          reject(err);
          return;
        }
        streamRef = stream;

        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            cleanup();
            try {
              streamRef && typeof streamRef.close === 'function' ? streamRef.close() : streamRef.destroy();
            } catch (e) { }
            reject(new Error('Remote command timed out'));
          }, timeoutMs);
        }

        stream.on('data', (chunk) => { stdout += chunk.toString(); });
        if (stream.stderr && typeof stream.stderr.on === 'function') {
          stream.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        }

        stream.on('exit', (code) => { exitCode = code; });
        stream.on('close', () => {
          cleanup();
          resolve({ stdout, stderr, exitCode });
        });
        stream.on('error', (streamErr) => {
          cleanup();
          reject(streamErr);
        });
      });
    });
  }

  function resetPasswordState(session) {
    session.passwordPromptPromise = null;
    session.passwordAttempts = 0;
    session.awaitingPassword = false;
    session.pendingPassword = null;
    session.lastPassword = null;
    session.rememberPassword = false;
    session.promptBuffer = '';
    session.cwdBuffer = '';
    session.authWindowUntil = 0;
  }

  function writePassword(session, password) {
    if (session && session.ptyProcess && password != null) {
      session.ptyProcess.write(`${password}\n`);
    }
  }

  async function requestPasswordForSession(tabId, hostConfig, context = {}) {
    const session = getSession(tabId);
    if (!session || typeof requestPassword !== 'function') {
      return null;
    }
    if (session.passwordPromptPromise) {
      return session.passwordPromptPromise;
    }
    if (session.passwordAttempts >= MAX_PASSWORD_ATTEMPTS) {
      return { action: 'cancel', reason: 'max-attempts' };
    }
    session.passwordAttempts += 1;
    session.passwordPromptPromise = (async () => {
      try {
        const result = await requestPassword({
          tabId,
          hostConfig,
          attempt: session.passwordAttempts,
          maxAttempts: MAX_PASSWORD_ATTEMPTS,
          reason: context.reason || 'ssh',
          error: context.error || ''
        });
        if (result && result.action === 'submit' && result.password) {
          session.lastPassword = result.password;
          session.rememberPassword = Boolean(result.remember);
        }
        return result;
      } finally {
        session.passwordPromptPromise = null;
      }
    })();
    return session.passwordPromptPromise;
  }

  async function handlePasswordPrompt(tabId, session) {
    if (!session) return;
    session.awaitingPassword = true;
    if (session.pendingPassword) {
      writePassword(session, session.pendingPassword);
      session.pendingPassword = null;
      session.awaitingPassword = false;
      return;
    }
    const response = await requestPasswordForSession(tabId, session.hostConfig, { reason: 'ssh' });
    if (!response || response.action !== 'submit') {
      await disconnect(tabId);
      return;
    }
    if (session.awaitingPassword && session.lastPassword) {
      writePassword(session, session.lastPassword);
      session.awaitingPassword = false;
    } else if (session.lastPassword) {
      session.pendingPassword = session.lastPassword;
    }
  }

  async function connectSftp(tabId, hostConfig, password) {
    const session = getSession(tabId);
    if (!session) {
      throw new Error('Invalid tab');
    }
    const connectionOptions = {
      host: hostConfig.hostName || hostConfig.alias,
      port: hostConfig.port ? Number(hostConfig.port) : 22,
      username: hostConfig.user || process.env.USER,
      agent: process.env.SSH_AUTH_SOCK,
      keepaliveInterval: 10000,
      readyTimeout: 20000
    };

    if (hostConfig.identityFile) {
      try {
        connectionOptions.privateKey = fs.readFileSync(hostConfig.identityFile, 'utf8');
      } catch (err) {
      }
    }
    if (password) {
      connectionOptions.password = String(password);
      connectionOptions.passphrase = String(password);
    }

    session.sftpClient = new SftpClient();
    await session.sftpClient.connect(connectionOptions);
    session.listCache.clear();
  }

  function spawnSshShell(tabId, hostConfig) {
    const session = getSession(tabId);
    if (!session) {
      return;
    }
    const args = ['-tt'];
    if (hostConfig.port) {
      args.push('-p', String(hostConfig.port));
    }
    if (hostConfig.identityFile) {
      args.push('-i', hostConfig.identityFile);
    }
    args.push('-o', 'ServerAliveInterval=30');
    args.push('-o', 'ServerAliveCountMax=3');

    const targetHost = hostConfig.hostName || hostConfig.alias;
    const target = hostConfig.user ? `${hostConfig.user}@${targetHost}` : targetHost;
    args.push(target);

    session.hostConfig = hostConfig;
    session.sessionType = 'ssh';
    resetPasswordState(session);
    session.hostKey = buildHostKey(hostConfig);
    session.authWindowUntil = Date.now() + 60000;
    session.ptyProcess = pty.spawn('ssh', args, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env: process.env
    });

    session.ptyProcess.onData((data) => {
      if (detectPasswordPrompt(session, data)) {
        handlePasswordPrompt(tabId, session).catch(() => { });
      }
      const cwdUpdates = consumeOsc7Sequences(session, data);
      for (const cwd of cwdUpdates) {
        if (cwd) {
          if (cwd !== session.lastCwd) {
            session.lastCwd = cwd;
            send('ssh:cwd', { tabId, cwd });
          }
          send('ssh:prompt', { tabId, cwd });
        }
      }
      if (!cwdUpdates.length) {
        const windowsCwd = detectWindowsPromptCwd(session, data);
        if (windowsCwd && windowsCwd !== session.lastCwd) {
          session.lastCwd = windowsCwd;
          send('ssh:cwd', { tabId, cwd: windowsCwd });
          send('ssh:prompt', { tabId, cwd: windowsCwd });
        }
      }
      send('ssh:data', { tabId, data });
    });

    session.ptyProcess.onExit(() => {
      send('ssh:exit', { tabId });
      // Ensure tunnel forwards are always closed when the SSH terminal ends unexpectedly.
      // (Port forwarding runs on `tunnelClient`, which can outlive the PTY unless we clean it up.)
      disconnect(tabId).catch(() => { });
    });

    setTimeout(() => injectPromptTracking(session, null), 600);
  }

  function spawnLocalShell(tabId) {
    const session = getSession(tabId);
    if (!session) {
      return;
    }
    const settings = typeof getSettings === 'function' ? getSettings() : null;
    const commandSetting = readSetting(settings, 'shell', 'local', 'command', '');
    const argsSetting = readSetting(settings, 'shell', 'local', 'args', '');
    const normalizedCommand = stripWrappingQuotes(commandSetting);
    const useDefault = !normalizedCommand || normalizedCommand.toLowerCase() === 'auto';
    const shell = useDefault ? getDefaultLocalShell() : normalizedCommand;
    const rawArgs = String(argsSetting || '').trim();
    const useDefaultArgs = !rawArgs || rawArgs.toLowerCase() === 'auto';
    const args = useDefaultArgs ? getDefaultLocalShellArgs(shell) : splitArgs(rawArgs);
    const env = buildLocalEnv(shell, settings);
    session.hostConfig = { alias: 'local', type: 'local' };
    session.sessionType = 'local';
    session.ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env
    });

    session.ptyProcess.onData((data) => {
      const cwdUpdates = consumeOsc7Sequences(session, data);
      for (const cwd of cwdUpdates) {
        if (cwd) {
          if (cwd !== session.lastCwd) {
            session.lastCwd = cwd;
            send('ssh:cwd', { tabId, cwd });
          }
          send('ssh:prompt', { tabId, cwd });
        }
      }
      if (!cwdUpdates.length) {
        const windowsCwd = detectWindowsPromptCwd(session, data);
        if (windowsCwd && windowsCwd !== session.lastCwd) {
          session.lastCwd = windowsCwd;
          send('ssh:cwd', { tabId, cwd: windowsCwd });
          send('ssh:prompt', { tabId, cwd: windowsCwd });
        }
      }
      send('ssh:data', { tabId, data });
    });

    session.ptyProcess.onExit(() => {
      send('ssh:exit', { tabId });
    });

    setTimeout(() => injectPromptTracking(session, settings), 300);
  }

  async function disconnect(tabId) {
    const session = getSession(tabId);
    if (!session) {
      return;
    }
    if (session.disconnecting) {
      return;
    }
    session.disconnecting = true;
    try {
      stopMetrics(tabId);
      if (session.ptyProcess) {
        try {
          session.ptyProcess.kill();
        } catch (err) {
        }
        session.ptyProcess = null;
      }
      if (session.sftpClient) {
        try {
          await session.sftpClient.end();
        } catch (err) {
        }
        session.sftpClient = null;
      }
      session.listCache.clear();
      session.osc7Buffer = '';
      session.lastCwd = '';
      session.hostConfig = null;
      session.sessionType = null;
      session.hostKey = '';

      if (session.tunnelClient) {
        try {
          session.tunnelClient.end();
        } catch (err) { }
        session.tunnelClient = null;
      }

      if (session.activeTunnels && session.activeTunnels.size > 0) {
        for (const tunnelId of session.activeTunnels) {
          tunnelService.closeTunnel(tunnelId);
        }
        session.activeTunnels.clear();
      }

      resetPasswordState(session);
    } finally {
      session.disconnecting = false;
    }
  }

  async function kill(tabId) {
    const session = getSession(tabId);
    if (!session) {
      return;
    }
    if (session.disconnecting) {
      return;
    }
    session.disconnecting = true;
    try {
      stopMetrics(tabId);
      if (session.ptyProcess) {
        try {
          session.ptyProcess.kill('SIGKILL');
        } catch (err) {
          try {
            session.ptyProcess.kill();
          } catch (innerErr) {
          }
        }
        session.ptyProcess = null;
      }
      if (session.sftpClient) {
        try {
          await session.sftpClient.end();
        } catch (err) {
        }
        session.sftpClient = null;
      }
      session.listCache.clear();
      session.osc7Buffer = '';
      session.lastCwd = '';
      session.hostConfig = null;
      session.sessionType = null;
      session.hostKey = '';

      if (session.tunnelClient) {
        try {
          session.tunnelClient.end();
        } catch (err) { }
        session.tunnelClient = null;
      }

      if (session.activeTunnels && session.activeTunnels.size > 0) {
        for (const tunnelId of session.activeTunnels) {
          tunnelService.closeTunnel(tunnelId);
        }
        session.activeTunnels.clear();
      }

      resetPasswordState(session);
    } finally {
      session.disconnecting = false;
    }
  }

  function ensureSftpReady(tabId) {
    const session = getSession(tabId);
    if (!session) {
      throw new Error('Not connected');
    }
    if (session.sessionType === 'local') {
      throw new Error('SFTP unavailable for local session');
    }
    if (!session.sftpClient) {
      throw new Error('Not connected');
    }
    return session;
  }

  function sendProgress(tabId, id, transferred, total) {
    send('sftp:progress', { tabId, id, transferred, total });
  }

  async function download(tabId, remotePath, localPath, id) {
    const session = ensureSftpReady(tabId);
    let totalSize = 0;
    sendProgress(tabId, id, 0, totalSize);
    await session.sftpClient.fastGet(remotePath, localPath, {
      step: (transferred, chunk, total) => {
        totalSize = total || totalSize;
        sendProgress(tabId, id, transferred, totalSize);
      }
    });
    sendProgress(tabId, id, totalSize, totalSize);
  }

  async function renamePath(tabId, oldPath, newPath) {
    const session = getSession(tabId);
    if (!session) {
      throw new Error('Invalid tab');
    }
    const from = String(oldPath || '');
    const to = String(newPath || '');
    if (!from || !to) {
      throw new Error('Missing path');
    }
    if (session.sessionType === 'local') {
      await fs.promises.rename(from, to);
      return;
    }
    const sftpSession = ensureSftpReady(tabId);
    const q = (value) => `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
    try {
      const existsTo = await sftpSession.sftpClient.exists(to);
      if (existsTo) {
        throw new Error('Target already exists');
      }
    } catch (err) {
      if (err && err.message === 'Target already exists') throw err;
    }
    try {
      const existsFrom = await sftpSession.sftpClient.exists(from);
      if (!existsFrom) {
        throw new Error('Source not found');
      }
    } catch (err) {
      if (err && err.message === 'Source not found') throw err;
    }

    try {
      await sftpSession.sftpClient.rename(from, to);
    } catch (err) {
      // Some servers return generic "Failure" even when the rename succeeds.
      // Double-check before attempting a fallback.
      try {
        const toExists = await sftpSession.sftpClient.exists(to);
        const fromExists = await sftpSession.sftpClient.exists(from);
        if (toExists && !fromExists) {
          return;
        }
      } catch (innerErr) { }

      // Some servers return generic "Failure" for directory renames via SFTP.
      // Fall back to a shell mv over SSH (still safe because we verified target doesn't exist).
      const res = await exec(tabId, `mv -- ${q(from)} ${q(to)}`, { timeoutMs: 20000 });
      if (res && res.exitCode && Number(res.exitCode) !== 0) {
        const combined = `${res.stderr || ''}\n${res.stdout || ''}`.trim();
        const msg = combined || (err && err.message ? err.message : '') || 'Rename failed';
        throw new Error(msg);
      }
    }
    try {
      sftpSession.listCache.delete(path.posix.dirname(from));
      sftpSession.listCache.delete(path.posix.dirname(to));
    } catch (err) { }
  }

  async function upload(tabId, localPath, remotePath, id) {
    const session = ensureSftpReady(tabId);
    let totalSize = 0;
    sendProgress(tabId, id, 0, totalSize);
    await session.sftpClient.fastPut(localPath, remotePath, {
      step: (transferred, chunk, total) => {
        totalSize = total || totalSize;
        sendProgress(tabId, id, transferred, totalSize);
      }
    });
    sendProgress(tabId, id, totalSize, totalSize);
    session.listCache.delete(path.posix.dirname(remotePath));
  }

  async function ensureSftpConnection(tabId, hostConfig) {
    const session = getSession(tabId);
    if (!session) {
      throw new Error('Invalid tab');
    }
    if (session.sessionType === 'local') {
      return;
    }

    const hostKey = session.hostKey || buildHostKey(hostConfig);
    session.hostKey = hostKey;

    let storedPassword = null;
    if (passwordStore && typeof passwordStore.getPassword === 'function') {
      storedPassword = passwordStore.getPassword(hostKey);
    }

    let currentPassword = session.lastPassword || storedPassword || null;
    let storedPasswordTried = Boolean(storedPassword);
    if (currentPassword && !session.lastPassword) {
      session.lastPassword = currentPassword;
    }
    if (currentPassword && !session.pendingPassword) {
      session.pendingPassword = currentPassword;
    }

    while (true) {
      try {
        await connectSftp(tabId, hostConfig, currentPassword);
        if (currentPassword && session.rememberPassword && passwordStore && typeof passwordStore.setPassword === 'function') {
          passwordStore.setPassword(hostKey, currentPassword);
        }
        return;
      } catch (err) {
        if (!isAuthError(err)) {
          throw err;
        }
        if (storedPasswordTried && currentPassword && storedPassword && currentPassword === storedPassword) {
          if (passwordStore && typeof passwordStore.deletePassword === 'function') {
            passwordStore.deletePassword(hostKey);
          }
          storedPassword = null;
        }
        const response = await requestPasswordForSession(tabId, hostConfig, {
          reason: 'sftp',
          error: err && err.message ? err.message : ''
        });
        if (!response || response.action !== 'submit' || !response.password) {
          if (response && response.reason === 'max-attempts') {
            throw new Error('Authentication failed');
          }
          throw new Error('Connection canceled');
        }
        currentPassword = response.password;
        if (session.awaitingPassword) {
          writePassword(session, currentPassword);
          session.awaitingPassword = false;
        } else {
          session.pendingPassword = currentPassword;
        }
        storedPasswordTried = false;
      }
    }
  }

  async function connect(tabId, hostConfig) {
    await disconnect(tabId);
    try {
      if (hostConfig && hostConfig.type === 'local') {
        spawnLocalShell(tabId);
        startMetrics(tabId);
        return;
      }
      spawnSshShell(tabId, hostConfig);
      await ensureSftpConnection(tabId, hostConfig);
      startMetrics(tabId);
    } catch (err) {
      await disconnect(tabId);
      throw err;
    }
  }

  async function connectLocal(tabId) {
    await disconnect(tabId);
    try {
      spawnLocalShell(tabId);
      startMetrics(tabId);
    } catch (err) {
      await disconnect(tabId);
      throw err;
    }
  }

  function write(tabId, data) {
    const session = getSession(tabId);
    if (session && session.ptyProcess) {
      session.ptyProcess.write(data);
    }
  }

  function resize(tabId, cols, rows) {
    const session = getSession(tabId);
    if (session && session.ptyProcess && cols && rows) {
      session.ptyProcess.resize(cols, rows);
    }
  }

  async function list(tabId, remotePath) {
    const session = ensureSftpReady(tabId);
    if (session.listCache.has(remotePath)) {
      return session.listCache.get(remotePath);
    }
    const list = await session.sftpClient.list(remotePath);
    const normalized = list
      .filter((entry) => entry.name !== '.' && entry.name !== '..')
      .map((entry) => ({
        name: entry.name,
        type: entry.type,
        path: path.posix.join(remotePath, entry.name),
        size: entry.size
      }));
    session.listCache.set(remotePath, normalized);
    return normalized;
  }

  async function listLocal(tabId, localPath) {
    const session = getSession(tabId);
    if (!session || session.sessionType !== 'local') {
      throw new Error('Local session not connected');
    }
    const targetPath = localPath || os.homedir();
    const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      const fullPath = path.join(targetPath, entry.name);
      let type = entry.isDirectory() ? 'd' : '-';
      let size = 0;
      if (entry.isFile()) {
        try {
          const stat = await fs.promises.stat(fullPath);
          size = stat.size || 0;
        } catch (err) {
        }
      } else if (entry.isSymbolicLink()) {
        try {
          const stat = await fs.promises.stat(fullPath);
          if (stat.isDirectory()) {
            type = 'd';
          }
          if (stat.isFile()) {
            size = stat.size || 0;
          }
        } catch (err) {
        }
      }
      items.push({
        name: entry.name,
        type,
        path: fullPath,
        size
      });
    }
    return items;
  }

  async function disconnectAll() {
    for (const tabId of sessions.keys()) {
      await disconnect(tabId);
    }
  }

  async function ensureTunnelConnection(tabId, hostConfig) {
    const session = getSession(tabId);
    if (!session) throw new Error('Session not found');

    if (session.tunnelClient) return session.tunnelClient;

    const client = new SshClient();
    const connectConfig = {
      host: hostConfig.hostName || hostConfig.alias,
      port: hostConfig.port ? Number(hostConfig.port) : 22,
      username: hostConfig.user || process.env.USER,
      keepaliveInterval: 10000,
      readyTimeout: 20000
    };

    if (process.env.SSH_AUTH_SOCK) {
      connectConfig.agent = process.env.SSH_AUTH_SOCK;
    }

    if (hostConfig.identityFile) {
      try {
        connectConfig.privateKey = fs.readFileSync(hostConfig.identityFile, 'utf8');
      } catch (err) { }
    }

    if (session.lastPassword) {
      connectConfig.password = session.lastPassword;
      connectConfig.passphrase = session.lastPassword;
    }

    return new Promise((resolve, reject) => {
      client.on('ready', () => {
        session.tunnelClient = client;
        resolve(client);
      });

      client.on('error', (err) => {
        session.tunnelClient = null;
        reject(err);
      });

      client.on('close', () => { if (session.tunnelClient === client) session.tunnelClient = null; });

      client.on('tcpip', (accept, reject, info) => {
        tunnelService.handleRemoteConnection(client, info, accept, reject);
      });

      client.connect(connectConfig);
    });
  }

  // Run configurations need authenticated command channels, without creating an
  // interactive terminal or coupling the process to an ordinary tab.
  async function connectControl(tabId, hostConfig) {
    const session = getSession(tabId);
    if (!hostConfig) { session.sessionType = 'local'; return; }
    session.sessionType = 'ssh';
    session.hostConfig = hostConfig;
    session.hostKey = buildHostKey(hostConfig);
    if (!session.lastPassword && passwordStore) session.lastPassword = passwordStore.getPassword(session.hostKey);
    try { await ensureTunnelConnection(tabId, hostConfig); }
    catch (error) {
      if (!/authentication|authenticate|passphrase|private key/i.test(error.message)) throw error;
      session.passwordAttempts = 0;
      const response = await requestPasswordForSession(tabId, hostConfig, { reason: 'run configuration', error: error.message });
      if (!response || response.action !== 'submit') throw new Error('SSH authentication canceled');
      await ensureTunnelConnection(tabId, hostConfig);
      if (session.rememberPassword && passwordStore) passwordStore.setPassword(session.hostKey, session.lastPassword);
    }
  }

  const manager = {
    connectControl,
    createSession: (tabId, hostConfig) => connect(tabId, hostConfig),
    createTunnel: async (tabId, type, config) => {
      const session = getSession(tabId);
      if (!session) throw new Error('Invalid tab');
      if (!session.tunnelClient) {
        await ensureTunnelConnection(tabId, session.hostConfig);
      }
      const id = `tunnel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      let resultInfo = {};
      if (type === 'remote') {
        await tunnelService.createRemoteForward(session.tunnelClient, id, config);
      } else {
        const res = await tunnelService.createLocalForward(session.tunnelClient, id, { ...config, type });
        if (res && res.localPort) resultInfo.localPort = res.localPort;
      }
      session.activeTunnels.add(id);
      return { id, ...resultInfo };
    },
    closeTunnel: (tabId, tunnelId) => {
      const session = getSession(tabId);
      if (session) {
        tunnelService.closeTunnel(tunnelId);
        session.activeTunnels.delete(tunnelId);
      }
    },
    connect,
    connectLocal,
    disconnect,
    kill,
    disconnectAll,
    write,
    resize,
    list,
    listLocal,
    download,
    renamePath,
    upload,
    exec,
    ensureSftpReady,
    getSession
  };

  tunnelService.on('tunnel:status', (payload) => {
    // Find which session owns this tunnel
    let foundTabId = null;
    for (const [tabId, session] of sessions.entries()) {
      if (session.activeTunnels && session.activeTunnels.has(payload.id)) {
        foundTabId = tabId;
        break;
      }
    }
    if (foundTabId) {
      send('tunnel:status', { ...payload, tabId: foundTabId });
    }
  });

  return manager;
}

module.exports = {
  createSessionManager
};
