const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { DEFAULT_STATE } = require('../constants');
const { randomUUID } = require('crypto');

function statePath() {
  return path.join(app.getPath('userData'), 'state.json');
}

function loadState() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...parsed };
  } catch (err) {
    return { ...DEFAULT_STATE };
  }
}

function saveState(currentState, patch) {
  const nextState = { ...currentState, ...patch };
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const temporary = `${statePath()}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(nextState, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, statePath());
  } finally { fs.rmSync(temporary, { force: true }); }
  return nextState;
}

module.exports = {
  loadState,
  saveState,
  statePath
};
