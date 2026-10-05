const { normalize, buildCommand, quote } = require('./configuration');
const VERSION = '1.8.17';
const pipArgs = ['-m', 'pip', 'install', '--no-input', '--disable-pip-version-check', `debugpy==${VERSION}`];
const probe = `import sys, json
result = {"interpreter": sys.executable, "pythonVersion": sys.version.split()[0], "pythonSupported": sys.version_info >= (3, 9), "found": False, "compatible": False}
try:
    import debugpy
    result.update(found=True, version=debugpy.__version__, compatible=sys.version_info >= (3, 9) and debugpy.__version__.split(".")[:2] == ["1", "8"])
except ModuleNotFoundError as error:
    if error.name != "debugpy": result["error"] = str(error)
except Exception as error:
    result["error"] = str(error)
print("MARINA_DEBUGPY_STATUS:" + json.dumps(result))`;

function createDebugpyEnvironment({ manager, execute }) {
  const installing = new Set();
  function configuration(input = {}) {
    if (input.type !== 'python') throw new Error('debugpy is available for Python configurations only');
    if (input.host === '__local__' && process.platform === 'win32') throw new Error('Select a macOS/Linux SSH host to use Python run configurations on Windows');
    // Checking an unfinished draft must not require an application entry point,
    // parse application arguments, clean ports, or start a managed run.
    return normalize({ ...input, name: input.name || 'Python environment', mode: 'script', target: '__debugpy_setup__', args: '', killPortOnLaunch: false, killPort: null, tmux: false });
  }
  async function prepared(c) { return manager.prepareEnvironment(c); }
  async function inspect(c, env) {
    const result = await execute(c.host, buildCommand(c, env.fileEnv, env.scriptEnv, env.scriptMeta, { pythonCode: probe }), { timeoutMs: 30000 });
    const line = result.stdout?.split('\n').find(line => line.startsWith('MARINA_DEBUGPY_STATUS:'));
    if (result.exitCode !== 0 || !line) throw new Error((result.stderr || 'Could not check debugpy with the configuration’s interpreter').trim().slice(-4000));
    const status = JSON.parse(line.slice('MARINA_DEBUGPY_STATUS:'.length));
    return { ...status, host: c.host, installCommand: `${quote(status.interpreter)} ${pipArgs.join(' ')}` };
  }
  async function check(input) {
    const c = configuration(input);
    return inspect(c, await prepared(c));
  }
  async function install(input) {
    const c = configuration(input); const env = await prepared(c);
    const before = await inspect(c, env);
    if (!before.pythonSupported) throw new Error('PyDebug requires Python 3.9 or newer; select a newer interpreter before installing debugpy');
    if (before.compatible) return { status: before, output: 'debugpy already found in current environment.' };
    const key = JSON.stringify([c.host, before.interpreter]);
    if (installing.has(key)) throw new Error('debugpy installation is already running in this environment');
    installing.add(key);
    try {
      // Freeze the resolved executable but retain manager activation and all
      // configuration environment sources used for the check.
      const result = await execute(c.host, buildCommand({ ...c, interpreter: before.interpreter }, env.fileEnv, env.scriptEnv, env.scriptMeta, { pythonArgs: pipArgs }), { timeoutMs: 180000 });
      const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim().slice(-12000);
      if (result.exitCode !== 0) throw new Error(`debugpy installation failed. ${output || `pip exited with code ${result.exitCode}`}`);
      const status = await inspect(c, env);
      if (!status.compatible) throw new Error(`Installation finished, but compatible debugpy could not be loaded by ${status.interpreter}. ${status.error || ''}`);
      return { status, output };
    } finally { installing.delete(key); }
  }
  return { check, install };
}
module.exports = { createDebugpyEnvironment, VERSION };
