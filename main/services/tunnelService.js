const net = require('net');
const { EventEmitter } = require('events');

const SOCKS_VERSION = 5;
const AUTH_METHOD_NO_AUTH = 0;
const CMD_CONNECT = 1;
const ATYP_IPV4 = 1;
const ATYP_DOMAIN = 3;
const ATYP_IPV6 = 4;

class TunnelService extends EventEmitter {
    constructor() {
        super();
        // Map<tunnelId, { server, type, config, status }>
        this.tunnels = new Map();
    }

    // Create a local listener that forwards to remote (Local/Dynamic)
    // config: { localPort, remoteHost, remotePort, type: 'local'|'dynamic' }
    async createLocalForward(sshClient, id, config) {
        return new Promise((resolve, reject) => {
            const server = net.createServer((socket) => {
                if (config.type === 'dynamic') {
                    this.handleSocksConnection(socket, sshClient, id);
                } else {
                    this.handleLocalConnection(socket, sshClient, config, id);
                }
            });

            server.on('error', (err) => {
                this.emit('tunnel:error', { id, error: err.message });
                // If the server itself errors (e.g. port in use), we might need to close it
                this.updateStatus(id, 'error', err.message);
            });

            server.listen(config.localPort, '127.0.0.1', () => {
                const address = server.address();
                const port = typeof address === 'object' ? address.port : config.localPort;
                this.tunnels.set(id, {
                    server,
                    type: config.type,
                    config: { ...config, localPort: port },
                    status: 'active'
                });
                this.updateStatus(id, 'active');
                resolve({ localPort: port });
            });
        });
    }

    // Create a remote listener that forwards to local (Reverse)
    // config: { remotePort, localHost, localPort }
    async createRemoteForward(sshClient, id, config) {
        return new Promise((resolve, reject) => {
            // ssh2 forwardIn
            sshClient.forwardIn('127.0.0.1', config.remotePort, (err) => {
                if (err) {
                    this.updateStatus(id, 'error', err.message);
                    return reject(err);
                }

                this.tunnels.set(id, {
                    type: 'remote',
                    config,
                    status: 'active',
                    client: sshClient // Keep ref to close later
                });
                this.updateStatus(id, 'active');
                resolve();
            });
        });
    }

    handleLocalConnection(socket, sshClient, config, id) {
        sshClient.forwardOut(
            '127.0.0.1',
            socket.remotePort,
            config.remoteHost,
            config.remotePort,
            (err, stream) => {
                if (err) {
                    socket.end();
                    return;
                }
                socket.pipe(stream).pipe(socket);
            }
        );
    }

    handleSocksConnection(socket, sshClient, id) {
        let state = 'greeting'; // greeting, connection

        socket.on('data', (data) => {
            if (state === 'greeting') {
                if (data[0] !== SOCKS_VERSION) {
                    socket.end();
                    return;
                }
                // Respond with NO AUTH
                const response = Buffer.from([SOCKS_VERSION, AUTH_METHOD_NO_AUTH]);
                socket.write(response);
                state = 'connection';
            } else if (state === 'connection') {
                if (data[0] !== SOCKS_VERSION || data[1] !== CMD_CONNECT) {
                    // Only support CONNECT
                    socket.end();
                    return;
                }

                let addrHost;
                let addrPort;
                let offset = 3; // VER, CMD, RSV
                const atyp = data[3];

                if (atyp === ATYP_IPV4) {
                    // IPv4
                    offset = 4;
                    addrHost = data.slice(offset, offset + 4).join('.');
                    offset += 4;
                } else if (atyp === ATYP_DOMAIN) {
                    // Domain
                    offset = 4;
                    const len = data[offset];
                    offset += 1;
                    addrHost = data.slice(offset, offset + len).toString();
                    offset += len;
                } else if (atyp === ATYP_IPV6) {
                    // IPv6 not fully supported in this minimal impl, but we can try
                    socket.end();
                    return;
                }

                // Port
                addrPort = data.readUInt16BE(offset);

                // Forward
                sshClient.forwardOut(
                    '127.0.0.1',
                    socket.remotePort,
                    addrHost,
                    addrPort,
                    (err, stream) => {
                        if (err) {
                            // SOCKS5 reply failure
                            // REP=1 (general failure)
                            const reply = Buffer.from([5, 1, 0, 1, 0, 0, 0, 0, 0, 0]);
                            socket.write(reply);
                            socket.end();
                            return;
                        }
                        // SOCKS5 reply success
                        // REP=0
                        // We just return 0.0.0.0:0 as bind addr
                        const reply = Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
                        socket.write(reply);
                        socket.pipe(stream).pipe(socket);
                    }
                );
                state = 'streaming'; // Done with handshake
            }
        });
    }

    handleRemoteConnection(sshClient, details, accept, reject) {
        // details: { bindAddr, bindPort }
        // We need to find which tunnel ID corresponds to this request.
        // Since forwardIn uses a specific port, we can look up by config.remotePort

        // Note: ssh2 emits 'tcpip' event on client for forwarded connections
        // We'll handle this in the session manager where we have access to the service
        // But we need to map the incoming port to our target

        const tunnelEntry = Array.from(this.tunnels.entries()).find(([_, t]) =>
            t.type === 'remote' &&
            t.config.remotePort === details.bindPort &&
            t.client === sshClient
        );

        if (!tunnelEntry) {
            return reject();
        }

        const [id, tunnel] = tunnelEntry;
        const socket = net.connect(tunnel.config.localPort, tunnel.config.localHost || '127.0.0.1');

        socket.on('error', () => {
            reject();
        });

        socket.on('connect', () => {
            const stream = accept();
            socket.pipe(stream).pipe(socket);
        });
    }

    closeTunnel(id) {
        const tunnel = this.tunnels.get(id);
        if (!tunnel) return;

        if (tunnel.server) {
            tunnel.server.close();
        }

        if (tunnel.type === 'remote' && tunnel.client) {
            tunnel.client.unforwardIn('127.0.0.1', tunnel.config.remotePort, () => { });
        }

        this.tunnels.delete(id);
        this.updateStatus(id, 'closed');
    }

    closeAll(client) {
        // Close all tunnels associated with this specific ssh client
        for (const [id, tunnel] of this.tunnels.entries()) {
            // For local/dynamic, we might not have the client ref stored directly in the same way,
            // but we should pass it or track it.
            // Revisit tracking: we should probably store the client in the tunnel object for all types if possible,
            // or at least pass it in.
            // For now, let's assume we do cleanup by ID from sessionManager, 
            // or we check if the tunnel belongs to the closing session.
        }
    }

    updateStatus(id, status, error) {
        this.emit('tunnel:status', { id, status, error });
    }
}

module.exports = new TunnelService();
