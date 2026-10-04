const { app } = require('electron');
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSessionManager } = require('../main/services/sessionManager');
const { DEFAULT_SETTINGS } = require('../main/constants');
const { prepareLocalShell } = require('../main/services/shellIntegration');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-shell-test-'));
const home = path.join(root, 'home');
const dotfiles = path.join(root, 'dotfiles');
const target = path.join(root, 'target');
for (const dir of [home, dotfiles, target]) fs.mkdirSync(dir);
os.homedir = () => home;
process.env.HOME = home;
process.env.ZDOTDIR = dotfiles;
fs.writeFileSync(path.join(dotfiles, '.zshenv'), 'export FIXTURE_ENV=loaded\n');
fs.writeFileSync(path.join(dotfiles, '.zprofile'), 'export FIXTURE_PROFILE=loaded\n');
fs.writeFileSync(path.join(dotfiles, '.zshrc'), `PS1='fixture> '\nprintf 'profile-output\\n'\nprintf 'profile-error\\n' >&2\nfixture_prompt() { printf 'PROFILE_PROMPT\\n'; }\nprecmd_functions+=(fixture_prompt)\n`);
fs.writeFileSync(path.join(dotfiles, '.zlogin'), 'export FIXTURE_LOGIN=loaded\n');
fs.writeFileSync(path.join(home, '.bash_profile'), 'export FIXTURE_PROFILE=loaded\n. "$HOME/.bashrc"\n');
fs.writeFileSync(path.join(home, '.bashrc'), `PS1='fixture> '\nprintf 'profile-output\\n'\nprintf 'profile-error\\n' >&2\nPROMPT_COMMAND=("printf 'PROFILE_PROMPT\\n'")\n`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let manager;
async function waitFor(predicate, label) {
  for (let i = 0; i < 120; i++) { if (predicate()) return; await pause(50); }
  throw new Error(`Timeout: ${label}`);
}
app.whenReady().then(async () => {
  for (const shell of ['/bin/zsh', '/bin/bash'].filter(fs.existsSync)) {
    for (const level of ['errors', 'info', 'debug']) {
      const settings = structuredClone(DEFAULT_SETTINGS);
      settings.shell.local.command.value = shell;
      settings.shell.local.logLevel.value = level;
      settings.shell.local.pathPrepend.value = path.join(root, 'custom-bin');
      let output = '';
      const cwd = [];
      manager = createSessionManager({ getSettings: () => settings, logDebug: () => {}, sendToRenderer: (channel, payload) => {
        if (channel === 'ssh:data') output += payload.data;
        if (channel === 'ssh:cwd') cwd.push(payload.cwd);
      }});
      await manager.connectLocal('fixture');
      const file = path.join(target, 'app log.txt');
      fs.writeFileSync(file, 'fixture');
      assert.equal(await manager.isFile('fixture', file), true);
      assert.equal(await manager.isFile('fixture', target), false);
      assert.equal(await manager.isFile('fixture', path.join(target, 'missing')), false);
      assert.equal(await manager.isFile('fixture', 'relative.txt'), false);
      assert.equal(await manager.isFile('missing-session', file), false);
      const remote = manager.getSession('remote-stat');
      remote.sessionType = 'ssh';
      remote.sftpClient = { stat: async value => { if (value === '/missing') throw new Error('missing'); return { isFile: value === '/app.log' }; } };
      assert.equal(await manager.isFile('remote-stat', '/app.log'), true);
      assert.equal(await manager.isFile('remote-stat', '/directory'), false);
      assert.equal(await manager.isFile('remote-stat', '/missing'), false);
      remote.sftpClient = null;
      await waitFor(() => cwd.includes(home) && output.includes('fixture>'), `${shell} startup`).catch(error => { console.error(shell, level, JSON.stringify(output), cwd); throw error; });
      assert(output.includes('profile-output') && output.includes('profile-error'), 'User profile output and errors must survive');
      assert(output.includes('PROFILE_PROMPT'), 'Original prompt hooks must survive');
      assert(!output.includes('__marinashell') && !output.includes('function>'), 'No typed setup code');
      assert.equal(output.includes('[MarinaShell]'), level !== 'errors');
      assert.equal(output.includes('PATH setup and OSC7'), level === 'debug');
      manager.write('fixture', `cd '${target}'; printf '__CHECK__%s|%s|%s|%s\\n' "$FIXTURE_PROFILE" "$ZDOTDIR" "$PATH" "${shell.endsWith('zsh') ? '$FIXTURE_LOGIN' : 'loaded'}"\r`);
      await waitFor(() => cwd.includes(target) && output.includes('__CHECK__loaded|'), 'directory tracking and profile variables').catch(error => { console.error(shell, level, JSON.stringify(output), cwd); throw error; });
      assert(output.includes(path.join(root, 'custom-bin')), 'Configured PATH prepend must survive user profiles');
      if (shell.endsWith('zsh')) assert(output.includes(`__CHECK__loaded|${dotfiles}|`), 'Original ZDOTDIR restored');
      const startup = manager.getSession('fixture').shellStartup;
      const startupDir = shell.endsWith('zsh') ? startup.env.ZDOTDIR : path.dirname(startup.args[1]);
      await manager.disconnectAll();
      assert.equal(await manager.isFile('fixture', file), false);
      assert(!fs.existsSync(startupDir), 'Temporary startup files cleaned up');
    }
  }
  // Only the exact private marker is filtered, even across chunk boundaries.
  const startup = prepareLocalShell('/bin/zsh', ['-l'], { HOME: home }, '', 'errors');
  try {
    const source = fs.readFileSync(path.join(startup.env.ZDOTDIR, 'integration.sh'), 'utf8');
    const marker = source.match(/\x1b\]777;[^\x07]+\x07/)[0];
    let output = '';
    for (const char of `before${marker}after`) output += startup.filter(char);
    assert.equal(output, 'beforeafter');
    assert.equal(startup.filter('arbitrary shell error\r\n'), 'arbitrary shell error\r\n');
  } finally { startup.cleanup(); }
  const customArgs = ['-c', 'echo custom'];
  assert.deepEqual(prepareLocalShell('/bin/bash', customArgs, { HOME: home }).args, customArgs, 'Custom arguments preserved');
  console.log('PASS: real Bash/Zsh quiet startup, profile output/errors/hooks, configured PATH, directory tracking, errors/info/debug settings, custom arguments and temporary-file cleanup');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await manager?.disconnectAll();
  fs.rmSync(root, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
});
