const fs = require('fs/promises');
const path = require('path');

function directoryArgument(argv) {
  const positions = argv.map((value, index) => value === '--open-directory' ? index : -1).filter(index => index >= 0);
  if (!positions.length) return null;
  if (positions.length !== 1 || !argv[positions[0] + 1]) throw new Error('Use --open-directory followed by one absolute local folder path.');
  return argv[positions[0] + 1];
}
async function resolveDirectory(value) {
  if (typeof value !== 'string' || value.length > 4096 || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error('Choose an absolute local folder path.');
  try {
    const directory = await fs.realpath(value);
    if (!(await fs.stat(directory)).isDirectory()) throw new Error();
    return directory;
  } catch { throw new Error('The selected local folder is missing or unavailable.'); }
}
function createDirectoryHandoff({ show, send, report }) {
  const queue = [];
  let ready = false, pending = Promise.resolve();
  function flush() { if (ready) while (queue.length) send(queue.shift()); }
  return {
    enqueue(argv) {
      pending = pending.then(async () => {
        try {
          const requested = directoryArgument(argv);
          if (requested === null) return;
          if (queue.length >= 32) throw new Error('Too many folder requests are waiting. Try again after MarinaShell opens.');
          queue.push(await resolveDirectory(requested)); show(); flush();
        } catch (error) { report(error.message); }
      });
      return pending;
    },
    setReady(value) { ready = value; flush(); }
  };
}
module.exports = { directoryArgument, resolveDirectory, createDirectoryHandoff };
