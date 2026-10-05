const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { generateKeyPairSync } = require('crypto');
const { Server, utils } = require('ssh2');
const { STATUS_CODE, OPEN_MODE } = utils.sftp;

// Private localhost SSH/SFTP fixture. All file operations stay under root.
async function createSshFixture(root) {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } });
  const peers = new Set(); const children = new Set(); const sockets = new Set();
  const server = new Server({ hostKeys: [key.privateKey] }, peer => {
    peers.add(peer); peer.on('close', () => peers.delete(peer)); peer.on('authentication', ctx => ctx.accept());
    peer.on('ready', () => {
      peer.on('tcpip', (accept, reject, info) => {
        if (info.destIP !== '127.0.0.1') return reject();
        const socket = net.connect(info.destPort, '127.0.0.1'); sockets.add(socket); socket.on('close', () => sockets.delete(socket));
        socket.once('connect', () => { const channel = accept(); socket.pipe(channel).pipe(socket); channel.on('close', () => socket.destroy()); }); socket.on('error', reject);
      });
      peer.on('session', accept => {
        const session = accept();
        session.on('exec', (accept, _reject, info) => {
          const stream = accept(); const child = spawn('/bin/bash', ['-c', info.command], { env: { ...process.env, HOME: root } }); children.add(child);
          child.stdout.on('data', data => { if (!stream.destroyed) stream.write(data); }); child.stderr.on('data', data => { if (!stream.destroyed) stream.stderr.write(data); });
          child.on('close', code => { children.delete(child); if (!stream.destroyed) { stream.exit(code || 0); stream.end(); } }); stream.on('close', () => { if (child.exitCode == null) child.kill('SIGHUP'); });
        });
        session.on('sftp', accept => {
          const sftp = accept(); const handles = new Map(); let sequence = 0;
          const attrs = stat => ({ size: stat.size, uid: stat.uid, gid: stat.gid, mode: stat.mode, atime: Math.floor(stat.atimeMs / 1000), mtime: Math.floor(stat.mtimeMs / 1000) });
          const safe = file => { if (!file.startsWith(root + '/') && !file.startsWith(fs.realpathSync(root) + '/')) throw new Error('File outside fixture'); return file; };
          const operation = (id, fn) => { try { fn(); } catch (_) { sftp.status(id, STATUS_CODE.FAILURE); } };
          sftp.on('STAT', (id, file) => operation(id, () => sftp.attrs(id, attrs(fs.statSync(safe(file))))));
          sftp.on('LSTAT', (id, file) => operation(id, () => sftp.attrs(id, attrs(fs.lstatSync(safe(file))))));
          sftp.on('OPEN', (id, file, flags, attributes) => operation(id, () => {
            const fd = fs.openSync(safe(file), flags & OPEN_MODE.WRITE ? 'w' : 'r', attributes.mode || 0o600);
            const handle = Buffer.alloc(4); handle.writeUInt32BE(++sequence); handles.set(sequence, fd); sftp.handle(id, handle);
          }));
          sftp.on('READ', (id, handle, offset, length) => operation(id, () => {
            const buffer = Buffer.alloc(Math.min(length, 65536)); const count = fs.readSync(handles.get(handle.readUInt32BE()), buffer, 0, buffer.length, offset);
            if (count) sftp.data(id, buffer.subarray(0, count)); else sftp.status(id, STATUS_CODE.EOF);
          }));
          sftp.on('WRITE', (id, handle, offset, data) => operation(id, () => { fs.writeSync(handles.get(handle.readUInt32BE()), data, 0, data.length, offset); sftp.status(id, STATUS_CODE.OK); }));
          sftp.on('FSTAT', (id, handle) => operation(id, () => sftp.attrs(id, attrs(fs.fstatSync(handles.get(handle.readUInt32BE()))))));
          sftp.on('CLOSE', (id, handle) => operation(id, () => { const key = handle.readUInt32BE(); fs.closeSync(handles.get(key)); handles.delete(key); sftp.status(id, STATUS_CODE.OK); }));
          sftp.on('SETSTAT', (id, file, attributes) => operation(id, () => { if (attributes.mode) fs.chmodSync(safe(file), attributes.mode); sftp.status(id, STATUS_CODE.OK); }));
          sftp.on('REMOVE', (id, file) => operation(id, () => { fs.unlinkSync(safe(file)); sftp.status(id, STATUS_CODE.OK); }));
          sftp.on('RENAME', (id, from, to) => operation(id, () => { fs.renameSync(safe(from), safe(to)); sftp.status(id, STATUS_CODE.OK); }));
          sftp.on('EXTENDED', id => sftp.status(id, STATUS_CODE.OP_UNSUPPORTED));
          sftp.on('close', () => { for (const fd of handles.values()) try { fs.closeSync(fd); } catch (_) {} });
        });
      });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, close() { for (const socket of sockets) socket.destroy(); for (const peer of peers) peer.end(); for (const child of children) child.kill('SIGTERM'); server.close(); } };
}
module.exports = { createSshFixture };
