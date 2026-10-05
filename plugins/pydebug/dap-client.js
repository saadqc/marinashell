const { EventEmitter } = require('events');

// DAP framing is byte-based, including when Unicode strings span stream chunks.
class DapClient extends EventEmitter {
  constructor(stream, { timeoutMs = 15000, maxBytes = 8 * 1024 * 1024 } = {}) {
    super();
    this.stream = stream; this.timeoutMs = timeoutMs; this.maxBytes = maxBytes;
    this.buffer = Buffer.alloc(0); this.sequence = 0; this.pending = new Map(); this.closed = false;
    stream.on('data', chunk => {
      try { this.receive(chunk); } catch (error) { this.close(error); }
    });
    stream.on('error', error => this.close(error));
    stream.on('close', () => this.close(new Error('Debugger connection closed')));
    stream.on('end', () => this.close(new Error('Debugger connection ended')));
  }
  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    if (this.buffer.length > this.maxBytes + 8192) throw new Error('Debugger message exceeds the size limit');
    while (this.buffer.length) {
      const end = this.buffer.indexOf('\r\n\r\n');
      if (end < 0) { if (this.buffer.length > 8192) throw new Error('Invalid debugger header'); return; }
      const header = this.buffer.subarray(0, end).toString('ascii');
      const match = /^Content-Length:\s*(\d+)\s*$/im.exec(header);
      if (!match) throw new Error('Debugger message is missing Content-Length');
      const size = Number(match[1]);
      if (size > this.maxBytes) throw new Error('Debugger message exceeds the size limit');
      if (this.buffer.length < end + 4 + size) return;
      const message = JSON.parse(this.buffer.subarray(end + 4, end + 4 + size).toString('utf8'));
      this.buffer = this.buffer.subarray(end + 4 + size);
      if (message.type === 'response') {
        const pending = this.pending.get(message.request_seq);
        if (!pending) continue;
        this.pending.delete(message.request_seq); clearTimeout(pending.timer);
        if (message.success) pending.resolve(message.body || {});
        else pending.reject(new Error(message.message || message.body?.error?.format || 'Debugger request failed'));
      } else if (message.type === 'event') this.emit('event', message);
      else if (message.type === 'request') {
        // No arbitrary process launches through reverse requests in attach mode.
        this.send({ type: 'response', request_seq: message.seq, command: message.command, success: false, message: 'Reverse requests are not supported by PyDebug' });
      }
    }
  }
  send(message) {
    if (this.closed) throw new Error('Debugger is disconnected');
    const body = Buffer.from(JSON.stringify({ ...message, seq: ++this.sequence }), 'utf8');
    this.stream.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
    return this.sequence;
  }
  request(command, args = {}, timeoutMs = this.timeoutMs) {
    if (this.closed) return Promise.reject(new Error('Debugger is disconnected'));
    return new Promise((resolve, reject) => {
      const seq = this.sequence + 1;
      const timer = setTimeout(() => {
        this.pending.delete(seq); reject(new Error(`Debugger ${command} request timed out`));
      }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timer });
      try { this.send({ type: 'request', command, arguments: args }); }
      catch (error) { clearTimeout(timer); this.pending.delete(seq); reject(error); }
    });
  }
  close(error = new Error('Debugger disconnected')) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.buffer = Buffer.alloc(0);
    this.stream.destroy(); this.emit('disconnected', error);
  }
}
module.exports = { DapClient };
