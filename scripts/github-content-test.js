const assert = require('assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { execFileSync } = require('child_process');
const { performance } = require('perf_hooks');
const { createHostCommands } = require('../main/services/hostCommands');
const { createGitService } = require('../plugins/git/service');
const { createGitHub } = require('../plugins/git/github');
const { createContentCache } = require('../plugins/git/content-cache');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-pr-content-'));
const repository = path.join(root, 'repository'); fs.mkdirSync(repository);
const runGit = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: 'pipe' }).trim();
const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(repository, file)), { recursive: true }); fs.writeFileSync(path.join(repository, file), text); };
const unusual = '- odd\n雪 $(false).js'; const renamed = 'nested/new\n雪.js';
const files = [
  { filename: 'src/one.js', status: 'modified' }, { filename: renamed, previous_filename: unusual, status: 'renamed' },
  { filename: 'added.js', status: 'added' }, { filename: 'removed.txt', status: 'removed' },
  { filename: 'binary.dat', status: 'added' }, { filename: 'large.txt', status: 'added' },
  { filename: 'invalid.txt', status: 'added' }, { filename: 'submodule', status: 'added' }
];
let defaultLogin = 'alice'; let base; let head; let headRepo = 'fixture/repository'; let contentGate; let failContent = false; let promisorPath;
let remoteReads = 0; let active = 0; let maxActive = 0; const calls = [];
const host = createHostCommands(null);
const commands = { identity: host.identity, run: async command => {
  calls.push(command);
  if (command.executable === 'git') {
    if (command.args.includes('ls-tree') || command.args.includes('cat-file')) { assert.equal(command.env.GIT_NO_LAZY_FETCH, '1'); assert.equal(command.env.GIT_ALLOW_PROTOCOL, ''); }
    if (command.cwd === promisorPath && command.env.GIT_ALLOW_PROTOCOL !== undefined) command = { ...command, args: ['-c', `remote.origin.url=file://${repository}`, ...command.args] };
    return host.run(command);
  }
  const args = command.args; let data;
  if (args[0] === '--version') return { exitCode: 0, stdout: 'gh fixture', stderr: '' };
  if (args[0] === 'auth' && args[1] === 'token') return { exitCode: 0, stdout: 'fixture-' + args.at(-1), stderr: '' };
  if (args[0] === 'auth') data = { hosts: { 'github.com': [{ login: 'alice', active: defaultLogin === 'alice' }, { login: 'bob', active: defaultLogin === 'bob' }] } };
  else if (args.some(arg => arg.includes('/contents/'))) {
    remoteReads++; active++; maxActive = Math.max(maxActive, active);
    try {
      if (contentGate) await contentGate;
      if (failContent) return { exitCode: 1, stdout: '', stderr: 'Temporary fixture failure' };
      const resource = args.find(arg => arg.includes('/contents/'));
      const text = `remote:${resource}\n`; data = { type: 'file', encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64') };
    } finally { active--; }
  } else if (args.some(arg => arg.includes('/compare/'))) data = { merge_base_commit: { sha: base } };
  else if (args.some(arg => arg.includes('/files?'))) return { exitCode: 0, stdout: JSON.stringify(files) + '\n', stderr: '' };
  else data = { title: 'Fixture', state: 'open', html_url: 'https://github.com/fixture/repository/pull/7', user: { login: 'alice' }, base: { sha: base, ref: 'main' }, head: { sha: head, ref: 'feature', repo: { full_name: headRepo } } };
  return { exitCode: 0, stdout: JSON.stringify(data), stderr: '' };
} };
async function waitFor(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Timed out waiting for parallel content requests'); }
async function test() {
  runGit('init', '-b', 'main'); runGit('config', 'core.autocrlf', 'false'); runGit('config', 'user.name', 'Fixture'); runGit('config', 'user.email', 'fixture@example.invalid');
  write('src/one.js', 'base\r\n'); write(unusual, 'rename source\n'); write('removed.txt', 'removed\n');
  runGit('add', '.'); runGit('commit', '-m', 'base'); base = runGit('rev-parse', 'HEAD');
  write('src/one.js', 'head\r\n'); fs.renameSync(path.join(repository, unusual), path.join(repository, 'renamed-temp'));
  fs.mkdirSync(path.dirname(path.join(repository, renamed)), { recursive: true }); fs.renameSync(path.join(repository, 'renamed-temp'), path.join(repository, renamed));
  fs.unlinkSync(path.join(repository, 'removed.txt')); write('added.js', ''); write('binary.dat', Buffer.from([0, 1, 2]));
  write('invalid.txt', Buffer.from([255])); write('large.txt', Buffer.alloc(2 * 1024 * 1024 + 1, 97));
  runGit('add', '.'); runGit('update-index', '--add', '--cacheinfo', `160000,${base},submodule`); runGit('commit', '-m', 'head'); head = runGit('rev-parse', 'HEAD');
  write('src/one.js', 'UNSAVED WORKING TREE\n');
  runGit('remote', 'add', 'origin', 'git@github.com:fixture/repository.git');
  const git = createGitService(commands); const context = (await git.discover({ cwd: path.join(repository, 'src'), projectId: 'one' })).repository;
  const github = createGitHub({ git, commands, root: path.join(root, 'settings') }); await github.status(context.id);
  let review = await github.review(context.id, 'origin', 7);
  const cold = performance.now(); const content = await github.content(review.reviewId, '0'); const coldMs = performance.now() - cold;
  assert.deepEqual(content, { name: 'src/one.js', oldText: 'base\r\n', newText: 'head\r\n' }); assert.equal(remoteReads, 0, 'Both versions come from exact local commits');
  const callCount = calls.length; const warm = performance.now(); assert.deepEqual(await github.content(review.reviewId, '0'), content); const warmMs = performance.now() - warm;
  assert.equal(calls.length, callCount, 'Warm file switching runs no Git or GitHub commands');
  assert.equal((await github.content(review.reviewId, '1')).oldText, 'rename source\n', 'Rename uses old path including newline and Unicode');
  assert.equal((await github.content(review.reviewId, '1')).newText, 'rename source\n');
  assert.equal((await github.content(review.reviewId, '2')).newText, '', 'Empty added blobs are cacheable');
  assert.equal((await github.content(review.reviewId, '3')).newText, '');
  assert.equal((await github.content(review.reviewId, '3')).oldText, 'removed\n');
  assert.match((await github.content(review.reviewId, '4')).unavailable, /Binary/);
  const beforeLarge = calls.length; assert.match((await github.content(review.reviewId, '5')).unavailable, /2 MB/);
  assert(!calls.slice(beforeLarge).some(c => c.args.includes('cat-file')), 'Oversized blob is rejected before reading content');
  assert.match((await github.content(review.reviewId, '6')).unavailable, /non-UTF-8/);
  assert.match((await github.content(review.reviewId, '7')).unavailable, /Submodule/); assert.equal(remoteReads, 0);
  review = await github.review(context.id, 'origin', 7); const beforeRefreshRead = calls.length;
  assert.deepEqual(await github.content(review.reviewId, '0'), content); assert.equal(calls.length, beforeRefreshRead, 'Fresh review metadata reuses unchanged immutable contents');
  // A repository missing those objects falls back to GitHub without fetching Git refs.
  const missing = path.join(root, 'missing'); fs.mkdirSync(missing); execFileSync('git', ['init', '-b', 'main', missing], { stdio: 'pipe' });
  execFileSync('git', ['-C', missing, 'remote', 'add', 'origin', 'git@github.com:fixture/repository.git']);
  const remoteContext = (await git.discover({ cwd: missing, projectId: 'two' })).repository;
  await github.status(remoteContext.id); review = await github.review(remoteContext.id, 'origin', 7);
  let release; contentGate = new Promise(resolve => { release = resolve; });
  const first = github.content(review.reviewId, '0'); const second = github.content(review.reviewId, '0');
  try { await waitFor(() => active === 2); } finally { release(); }
  const [a, b] = await Promise.all([first, second]); contentGate = null;
  assert.deepEqual(a, b); assert.equal(remoteReads, 2, 'Concurrent identical reads share one request per side'); assert.equal(maxActive, 2, 'Old and new contents load concurrently');
  assert.match(a.oldText, new RegExp(base)); assert.match(a.newText, new RegExp(head));
  const beforeRemoteWarm = calls.length; await github.content(review.reviewId, '0'); assert.equal(calls.length, beforeRemoteWarm);
  await github.selectAccount(remoteContext.id, 'origin', 'bob'); review = await github.review(remoteContext.id, 'origin', 7);
  await github.content(review.reviewId, '0'); assert.equal(remoteReads, 4, 'Different account cannot reuse another account cache');
  const oldHead = head; head = 'c'.repeat(40); review = await github.review(remoteContext.id, 'origin', 7);
  const updated = await github.content(review.reviewId, '0'); assert.match(updated.newText, /c{40}/); assert.equal(remoteReads, 5, 'New head reuses only the unchanged base');
  headRepo = 'fixture/fork'; review = await github.review(remoteContext.id, 'origin', 7); await github.content(review.reviewId, '0'); assert.equal(remoteReads, 6, 'Repository identities isolate equal SHAs');
  const previousIdentity = commands.identity; commands.identity = () => 'changed';
  assert.match((await github.content(review.reviewId, '0')).unavailable, /host settings changed/); commands.identity = previousIdentity;
  head = 'd'.repeat(40); headRepo = 'fixture/repository'; review = await github.review(remoteContext.id, 'origin', 7); failContent = true;
  assert.match((await github.content(review.reviewId, '0')).unavailable, /Temporary/); failContent = false;
  assert.match((await github.content(review.reviewId, '0')).newText, /d{40}/, 'Transient failures are not cached'); head = oldHead;
  await github.selectAccount(remoteContext.id, 'origin', '');
  review = await github.review(remoteContext.id, 'origin', 7); const beforeDefault = remoteReads;
  await github.content(review.reviewId, '0'); assert.equal(remoteReads, beforeDefault, 'Returning to the same CLI default account reuses its immutable cache');
  defaultLogin = 'bob'; await github.status(remoteContext.id); review = await github.review(remoteContext.id, 'origin', 7);
  await github.content(review.reviewId, '0'); assert.equal(remoteReads, beforeDefault + 2, 'External CLI default account changes isolate refreshed contents');
  const anotherProject = (await git.discover({ cwd: missing, projectId: 'three' })).repository;
  await github.status(anotherProject.id); review = await github.review(anotherProject.id, 'origin', 7); const beforeProject = remoteReads;
  await github.content(review.reviewId, '0'); assert.equal(remoteReads, beforeProject + 2, 'Projects with the same directory and account retain separate caches');
  // Exercise an actual partial clone, including an older Git that can ignore
  // GIT_NO_LAZY_FETCH. Transport blocking must prevent lazy object downloads.
  runGit('config', 'uploadpack.allowFilter', 'true');
  const partial = path.join(root, 'partial');
  execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', `file://${repository}`, partial], { stdio: 'pipe' });
  const partialGit = (...args) => execFileSync('git', ['-C', partial, ...args], { encoding: 'utf8', stdio: 'pipe' });
  partialGit('remote', 'set-url', 'origin', 'git@github.com:fixture/repository.git');
  // Point the promisor at an accessible local source: an accidental lazy fetch
  // would otherwise succeed and silently fill the object store.
  promisorPath = partial;
  const beforePacks = partialGit('count-objects', '-v');
  const partialContext = (await git.discover({ cwd: partial, projectId: 'partial' })).repository;
  await github.status(partialContext.id); review = await github.review(partialContext.id, 'origin', 7);
  const beforePartial = remoteReads; const partialContent = await github.content(review.reviewId, '0');
  assert.match(partialContent.newText, /^remote:/); assert.equal(remoteReads, beforePartial + 2, 'Missing partial-clone blobs use GitHub fallback');
  assert.equal(partialGit('count-objects', '-v'), beforePacks, 'Local probing does not download promisor objects');
  assert(!calls.some(c => c.args.some(arg => ['fetch', 'checkout', 'switch'].includes(arg))), 'PR reads never fetch or modify the checkout');
  const cache = createContentCache({ maxBytes: 8, maxEntries: 2 }); const loads = new Map();
  const load = key => cache.read(key, async () => { loads.set(key, (loads.get(key) || 0) + 1); return 'ab'; });
  await load('a'); await load('b'); await load('a'); await load('c'); await load('b'); assert.equal(loads.get('a'), 1); assert.equal(loads.get('b'), 2, 'LRU evicts within the byte budget');
  console.log(`PERF real local Git: first=${coldMs.toFixed(2)}ms, cached=${warmMs.toFixed(2)}ms; cached read executes zero host commands`);
  console.log('PASS: real Git immutable blobs, dirty checkout, hostile rename paths, added/deleted/empty files, binary/size/submodule guards, parallel remote fallback, in-flight deduplication, commit/account/repository/host isolation, retry and bounded eviction');
}
test().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
