const assert = require('assert/strict'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { createGitHub, parseRemote } = require('../plugins/git/github');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-gh-'));
const calls = []; let creates = 0; const sha = 'a'.repeat(40); const base = 'b'.repeat(40);
let remoteUrl = 'git@github.com:fixture/repository.git';
const contexts = { one: { host: '__local__', cwd: root, projectId: 'one' }, two: { host: '__local__', cwd: root, projectId: 'two' } };
const git = { context: id => contexts[id], text: async (_c, args) => {
  if (args[0] === 'remote' && args.length === 1) return 'origin\n';
  if (args[0] === 'remote') return remoteUrl + '\n';
  if (args[0] === 'ls-remote') return `${sha}\trefs/heads/feature\n`;
  if (args[0] === 'rev-parse') return sha + '\n'; return '';
} };
const commands = { run: async command => {
  calls.push(command); const args = command.args; let result;
  if (command.executable === 'ssh') return { exitCode: 0, stdout: 'hostname github.com\n', stderr: '' };
  if (args[0] === '--version') return { exitCode: 0, stdout: 'gh fixture', stderr: '' };
  if (args[0] === 'auth' && args[1] === 'token') return { exitCode: 0, stdout: 'private-' + args.at(-1), stderr: '' };
  if (args[0] === 'auth') result = { hosts: { 'github.com': [{ login: 'alice', active: true }, { login: 'bob', active: false }] } };
  else if (args[0] === 'pr' && args[1] === 'create') { creates++; assert.equal(command.input, 'body\nwith newline'); assert(!args.includes('body\nwith newline')); return { exitCode: 0, stdout: 'https://github.com/fixture/repository/pull/7\n', stderr: '' }; }
  else if (args[0] === 'pr') result = [];
  else if (args.some(a => a.includes('/compare/'))) result = { merge_base_commit: { sha: base } };
  else if (args.some(a => a.includes('/files?'))) {
    assert(!args.includes('--slurp'), 'gh rejects --slurp combined with --jq');
    return { exitCode: 0, stderr: '', stdout: JSON.stringify([{ filename: 'new.js', status: 'modified', additions: 1, deletions: 1 }]) + '\n' + JSON.stringify([{ filename: 'second.js', status: 'added', additions: 2, deletions: 0 }]) + '\n' };
  }
  else if (args.some(a => a.includes('/contents/'))) result = { type: 'file', encoding: 'base64', size: 8, content: Buffer.from('value=1\n').toString('base64') };
  else result = { title: 'Fixture', body: '', state: 'open', html_url: 'https://github.com/fixture/repository/pull/7', user: { login: 'alice' }, base: { sha: base, ref: 'main' }, head: { sha, ref: 'feature', repo: { full_name: 'fixture/repository' } } };
  return { exitCode: 0, stdout: JSON.stringify(result), stderr: '' };
} };
async function test() {
  assert.equal(parseRemote('git@github.com:fixture/repository.git').repo, 'fixture/repository');
  assert.equal(parseRemote('ssh://git@enterprise.example:2222/owner/repository.git').hostname, 'enterprise.example');
  assert.equal(parseRemote('/some/local/repo'), null);
  const github = createGitHub({ git, commands, root });
  assert.equal((await github.status('one')).accounts.length, 2);
  await github.selectAccount('one', 'origin', 'alice'); await github.selectAccount('two', 'origin', 'bob');
  await Promise.all([github.list('one', 'origin'), github.list('two', 'origin')]);
  const requests = calls.filter(c => c.args[0] === 'pr' && c.args[1] === 'list');
  assert(requests.some(c => c.env.GH_TOKEN === 'private-alice')); assert(requests.some(c => c.env.GH_TOKEN === 'private-bob'));
  assert(!calls.some(c => c.args.includes('switch')));
  assert(!calls.some(c => c.args.some(a => a.includes('private-'))), 'Tokens never appear in command arguments');
  const review = await github.review('one', 'origin', 7); assert.equal(review.files[0].path, 'new.js');
  assert.equal(review.files.length, 2, 'All compact JSON pages are parsed');
  const content = await github.content(review.reviewId, '0'); assert.equal(content.oldText, 'value=1\n');
  const input = { requestId: 'fixture-request', title: 'Fixture', body: 'body\nwith newline', head: 'feature', base: 'main', draft: true };
  assert.match((await github.create('one', 'origin', input)).url, /pull\/7/);
  assert.equal((await github.create('one', 'origin', input)).existing, true); assert.equal(creates, 1);
  assert.equal((await github.branchUrl('one', 'origin', 'feature/one')).url, 'https://github.com/fixture/repository/tree/feature%2Fone');
  remoteUrl = 'git@github-fixture:fixture/repository.git'; assert.equal((await github.status('one', 'origin')).remotes[0].hostname, 'github.com', 'SSH aliases resolve to the API host');
  console.log('PASS: sanitized remotes/accounts, concurrent per-project authentication, immutable PR contents, creation receipts, stdin descriptions and browser URLs');
}
test().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
