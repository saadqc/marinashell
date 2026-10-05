const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;

// Source integration during shell startup, rather than typing into the PTY.
// User startup files retain their output, environment changes and prompt hooks.
function prepareLocalShell(shell, args, env, bootstrap = '', level = 'errors') {
  const name = path.basename(shell).toLowerCase();
  const supportedArgs = args.every(arg => ['-l', '--login', '-i', '-il', '-li'].includes(arg));
  if (!['zsh', 'bash'].includes(name) || !supportedArgs) {
    return { args, env, cleanup() {}, filter: data => data,
      notice: level === 'debug' ? `[MarinaShell] Startup hooks skipped for ${name} with custom shell options.\r\n` : '' };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marinashell-shell-'));
  fs.chmodSync(dir, 0o700);
  const marker = `\x1b]777;marinashell-${randomUUID()};ready\x07`;
  const write = (file, content) => fs.writeFileSync(path.join(dir, file), content, { mode: 0o600 });
  const login = args.some(arg => ['-l', '--login', '-il', '-li'].includes(arg));
  try {
    write('integration.sh', `${bootstrap}\n
__marinashell_pwd() { local __marinashell_exit_code=$?; printf '\\033]7;file://%s%s\\007' "\${HOSTNAME:-localhost}" "$PWD"; return "$__marinashell_exit_code"; }
if [ -n "$ZSH_VERSION" ]; then
  if (( \${precmd_functions[(Ie)__marinashell_pwd]:-0} == 0 )); then precmd_functions+=(__marinashell_pwd); fi
elif [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == 'declare -a'* ]]; then
  if (( BASH_VERSINFO[0] < 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] < 1) )); then
    __marinashell_prompt_commands=("\${PROMPT_COMMAND[@]}")
    __marinashell_prompt() { local command; for command in "\${__marinashell_prompt_commands[@]}"; do eval "$command"; done; __marinashell_pwd; }
    unset PROMPT_COMMAND
    PROMPT_COMMAND=__marinashell_prompt
  elif [[ " \${PROMPT_COMMAND[*]} " != *' __marinashell_pwd '* ]]; then PROMPT_COMMAND+=(__marinashell_pwd); fi
else
  case ";$PROMPT_COMMAND;" in
    *';__marinashell_pwd;'*) ;;
    *) PROMPT_COMMAND="__marinashell_pwd\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
  esac
fi
__marinashell_pwd
printf ${quote(marker)}
`);
    if (name === 'zsh') {
      // Zsh chooses startup files via ZDOTDIR. Restore its original value while
      // sourcing each user file, and again after the final startup stage.
      for (const file of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) {
        const finish = file === '.zlogin' ? 'true' : file === '.zshrc' ? '[[ ! -o login ]]' : 'false';
        write(file, `
if [ "$MARINASHELL_USER_ZDOTDIR_SET" = 1 ]; then export ZDOTDIR="$MARINASHELL_USER_ZDOTDIR"; else unset ZDOTDIR; fi
if [ -r "\${ZDOTDIR-$HOME}/${file}" ]; then . "\${ZDOTDIR-$HOME}/${file}"; fi
if [ "\${ZDOTDIR+x}" = x ]; then
  export MARINASHELL_USER_ZDOTDIR="$ZDOTDIR" MARINASHELL_USER_ZDOTDIR_SET=1
else
  export MARINASHELL_USER_ZDOTDIR="$HOME" MARINASHELL_USER_ZDOTDIR_SET=0
fi
if ${finish}; then
  . ${quote(path.join(dir, 'integration.sh'))}
  unset MARINASHELL_USER_ZDOTDIR MARINASHELL_USER_ZDOTDIR_SET MARINASHELL_INTEGRATION_DIR
else
  export ZDOTDIR="$MARINASHELL_INTEGRATION_DIR"
fi
:
`);
      }
      env = { ...env, ZDOTDIR: dir, MARINASHELL_INTEGRATION_DIR: dir,
        MARINASHELL_USER_ZDOTDIR: env.ZDOTDIR ?? env.HOME ?? os.homedir(),
        MARINASHELL_USER_ZDOTDIR_SET: Object.hasOwn(env, 'ZDOTDIR') ? '1' : '0' };
    } else {
      const profile = login ? `
if [ -r /etc/profile ]; then . /etc/profile; fi
for __marinashell_profile in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [ -r "$__marinashell_profile" ]; then . "$__marinashell_profile"; break; fi
done
unset __marinashell_profile
` : `if [ -r "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi\n`;
      write('bashrc', `${profile}\n. ${quote(path.join(dir, 'integration.sh'))}\n`);
      args = ['--rcfile', path.join(dir, 'bashrc'), '-i'];
    }
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  let pending = '';
  let ready = false;
  function filter(data) {
    // Remove only our exact control marker, including fragmented PTY chunks.
    // All user output, errors and OSC7 directory updates pass through intact.
    let text = pending + data;
    pending = '';
    const index = text.indexOf(marker);
    if (index !== -1) {
      let diagnostic = '';
      if (!ready) {
        ready = true;
        if (level === 'info' || level === 'debug') diagnostic += `[MarinaShell] ${name} startup hooks ready.\r\n`;
        if (level === 'debug') diagnostic += '[MarinaShell] PATH setup and OSC7 directory tracking installed through startup files.\r\n';
      }
      text = text.slice(0, index) + diagnostic + text.slice(index + marker.length);
    }
    for (let n = Math.min(text.length, marker.length - 1); n > 0; n--) {
      if (text.endsWith(marker.slice(0, n))) {
        pending = text.slice(-n);
        text = text.slice(0, -n);
        break;
      }
    }
    return text;
  }
  return { args, env, filter, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
module.exports = { prepareLocalShell };
