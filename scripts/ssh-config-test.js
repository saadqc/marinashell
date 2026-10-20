const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listConfigHosts, resolveHost } = require('../main/services/sshConfig');

// Exercise the production parser against disposable fixtures, never real hosts.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marina-ssh-config-'));
const home = os.homedir;
try {
  os.homedir = () => root;
  fs.mkdirSync(path.join(root, '.ssh', 'parts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ssh', 'config'), [
    'Host *',
    '  User fixture-default',
    '  Port 2222',
    'Include parts/*.conf',
    'Host fixture-api',
    '  HostName api.example.invalid # comment',
    '  User fixture-api-user',
    '  IdentityFile "~/.ssh/test key"',
    'Host wildcard-*',
    '  HostName ignored.example.invalid',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(root, '.ssh', 'parts', 'worker.conf'), [
    'Host fixture-worker',
    '  HostName worker.example.invalid',
    '  Port=2200',
    ''
  ].join('\n'));
  const hosts = listConfigHosts();
  assert.deepEqual(hosts.map(item => item.alias), ['fixture-api', 'fixture-worker']);
  assert.equal(hosts[0].hostName, 'api.example.invalid');
  assert.equal(hosts[0].user, 'fixture-api-user');
  assert.equal(hosts[0].port, '2222');
  assert.equal(hosts[0].identityFile, path.join(root, '.ssh', 'test key'));
  assert.equal(hosts[1].user, 'fixture-default');
  assert.equal(hosts[1].port, '2200');
  assert.deepEqual(resolveHost('fixture-worker'), hosts[1]);
  assert.equal(resolveHost('missing-fixture'), null);
  fs.rmSync(path.join(root, '.ssh', 'config'));
  assert.deepEqual(listConfigHosts(), []);
  console.log('PASS: SSH defaults, includes, comments, quoted paths, wildcard filtering and host resolution using isolated fixtures');
} finally {
  os.homedir = home;
  fs.rmSync(root, { recursive: true, force: true });
}
