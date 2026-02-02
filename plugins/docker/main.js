function shellSingleQuote(value) {
    // POSIX-safe single-quote wrapper: abc'def -> 'abc'"'"'def'
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function parseJsonLines(stdout) {
    if (!stdout) return [];
    return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch (err) {
                return null;
            }
        })
        .filter(Boolean);
}

async function execOrThrow(sessionManager, tabId, command, options = {}) {
    const result = await sessionManager.exec(tabId, command, options);
    if (result.exitCode && Number(result.exitCode) !== 0) {
        const msg = (result.stderr || result.stdout || '').trim() || `Command failed: ${command}`;
        throw new Error(msg);
    }
    return result;
}

function normalizeDockerError(err) {
    const message = err && err.message ? String(err.message) : 'Docker command failed';
    if (/command not found|not found/.test(message) && /\bdocker\b/.test(message)) {
        return 'docker is not installed on this host (or not in PATH).';
    }
    if (/permission denied/i.test(message) && /docker\.sock|docker/.test(message)) {
        return 'Permission denied talking to Docker. Ensure your user can access Docker (e.g. in the docker group) or run Docker rootless.';
    }
    if (/cannot connect to the docker daemon|is the docker daemon running/i.test(message)) {
        return 'Cannot connect to the Docker daemon. Is Docker running?';
    }
    return message;
}

module.exports = function (context) {
    const { sessionManager, registerIpc } = context;

    const dockerReadyCache = new Map(); // tabId -> timestamp

    async function ensureReady(tabId) {
        const session = sessionManager.getSession(tabId);
        if (!session || !session.hostConfig || (session.sessionType !== 'ssh' && session.sessionType !== 'local')) {
            throw new Error('Not connected');
        }
        const lastOk = dockerReadyCache.get(tabId) || 0;
        if (Date.now() - lastOk < 5000) {
            return true;
        }
        // Verify docker is callable and daemon reachable (best-effort).
        await execOrThrow(sessionManager, tabId, 'docker version --format "{{.Server.Version}}"', { timeoutMs: 15000 });
        dockerReadyCache.set(tabId, Date.now());
        return true;
    }

    async function listContainers(tabId) {
        const res = await execOrThrow(sessionManager, tabId, `docker ps -a --no-trunc --format '{{json .}}'`, { timeoutMs: 20000 });
        return parseJsonLines(res.stdout);
    }

async function listImages(tabId) {
        // `--digests` provides `.Digest` in the output for many images.
        const res = await execOrThrow(sessionManager, tabId, `docker images --no-trunc --digests --format '{{json .}}'`, { timeoutMs: 20000 });
        return parseJsonLines(res.stdout);
    }

    async function listVolumes(tabId) {
        const res = await execOrThrow(sessionManager, tabId, `docker volume ls --format '{{json .}}'`, { timeoutMs: 20000 });
        return parseJsonLines(res.stdout);
    }

    async function listNetworks(tabId) {
        const res = await execOrThrow(sessionManager, tabId, `docker network ls --format '{{json .}}'`, { timeoutMs: 20000 });
        return parseJsonLines(res.stdout);
    }

    async function listCompose(tabId) {
        // Compose v2 first, fall back to docker-compose if present.
        try {
            const res = await execOrThrow(sessionManager, tabId, `docker compose ls --format json`, { timeoutMs: 20000 });
            const text = (res.stdout || '').trim();
            return text ? JSON.parse(text) : [];
        } catch (err) {
            const msg = err && err.message ? String(err.message) : '';
            // Only try fallback when compose isn't available; otherwise surface the real error.
            if (!/unknown command|is not a docker command|not found/.test(msg)) throw err;
        }

        const res2 = await execOrThrow(sessionManager, tabId, `docker-compose ls --format json`, { timeoutMs: 20000 });
        const text2 = (res2.stdout || '').trim();
        return text2 ? JSON.parse(text2) : [];
    }

    async function containerAction(tabId, action, id) {
        const safeId = shellSingleQuote(id);
        const cmdByAction = {
            start: `docker start ${safeId}`,
            stop: `docker stop ${safeId}`,
            restart: `docker restart ${safeId}`,
            kill: `docker kill ${safeId}`,
            remove: `docker rm -f ${safeId}`
        };
        const cmd = cmdByAction[action];
        if (!cmd) throw new Error(`Unknown container action: ${action}`);
        await execOrThrow(sessionManager, tabId, cmd, { timeoutMs: 30000 });
        return true;
    }

    async function imageRemove(tabId, idOrRef) {
        await execOrThrow(sessionManager, tabId, `docker image rm -f ${shellSingleQuote(idOrRef)}`, { timeoutMs: 30000 });
        return true;
    }

    async function volumeRemove(tabId, name) {
        await execOrThrow(sessionManager, tabId, `docker volume rm ${shellSingleQuote(name)}`, { timeoutMs: 30000 });
        return true;
    }

    async function networkRemove(tabId, idOrName) {
        await execOrThrow(sessionManager, tabId, `docker network rm ${shellSingleQuote(idOrName)}`, { timeoutMs: 30000 });
        return true;
    }

    function clampInt(value, fallback, min, max) {
        const parsed = Number(value);
        if (Number.isNaN(parsed) || !Number.isFinite(parsed)) return fallback;
        const i = Math.floor(parsed);
        return Math.max(min, Math.min(max, i));
    }

    async function containerLogs(tabId, id, options = {}) {
        const tail = clampInt(options.tail, 200, 10, 5000);
        const timestamps = options.timestamps !== false;
        const idArg = shellSingleQuote(id);
        const cmd = `docker logs ${timestamps ? '--timestamps ' : ''}--tail ${tail} ${idArg}`;
        const res = await execOrThrow(sessionManager, tabId, cmd, { timeoutMs: 60000 });
        // docker logs may write to stderr for some cases; include both.
        return `${res.stdout || ''}${res.stderr || ''}`;
    }

    async function detectContainerShell(tabId, id) {
        const idArg = shellSingleQuote(id);
        // Prefer bash when present, otherwise sh.
        // We probe non-interactively via ssh exec; the actual interactive is run in the user's terminal PTY.
        try {
            await execOrThrow(sessionManager, tabId, `docker exec ${idArg} bash -lc "exit"`, { timeoutMs: 8000 });
            return 'bash';
        } catch (err) {
        }
        try {
            await execOrThrow(sessionManager, tabId, `docker exec ${idArg} sh -lc "exit"`, { timeoutMs: 8000 });
            return 'sh';
        } catch (err) {
        }
        return null;
    }

    registerIpc('init', async (_event, payload) => {
        try {
            await ensureReady(payload.tabId);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: normalizeDockerError(err) };
        }
    });

    registerIpc('listContainers', async (_event, payload) => {
        try {
            await ensureReady(payload.tabId);
            return { ok: true, data: await listContainers(payload.tabId) };
        } catch (err) {
            return { ok: false, error: normalizeDockerError(err) };
        }
    });

    registerIpc('listImages', async (_event, payload) => {
        try {
            await ensureReady(payload.tabId);
            return { ok: true, data: await listImages(payload.tabId) };
        } catch (err) {
            return { ok: false, error: normalizeDockerError(err) };
        }
    });

    registerIpc('listVolumes', async (_event, payload) => {
        try {
            await ensureReady(payload.tabId);
            return { ok: true, data: await listVolumes(payload.tabId) };
        } catch (err) {
            return { ok: false, error: normalizeDockerError(err) };
        }
    });

    registerIpc('listNetworks', async (_event, payload) => {
        try {
            await ensureReady(payload.tabId);
            return { ok: true, data: await listNetworks(payload.tabId) };
        } catch (err) {
            return { ok: false, error: normalizeDockerError(err) };
        }
    });

    registerIpc('listCompose', async (_event, payload) => {
        try {
            await ensureReady(payload.tabId);
            return { ok: true, data: await listCompose(payload.tabId) };
        } catch (err) {
            return { ok: false, error: normalizeDockerError(err) };
        }
    });

    registerIpc('containerAction', async (_event, payload) => {
        const { tabId, action, id } = payload || {};
        try {
            await ensureReady(tabId);
            await containerAction(tabId, action, id);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: normalizeDockerError(err) };
        }
    });

    registerIpc('imageRemove', async (_event, payload) => {
        const { tabId, id } = payload || {};
        try {
            await ensureReady(tabId);
            await imageRemove(tabId, id);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: normalizeDockerError(err) };
        }
    });

    registerIpc('volumeRemove', async (_event, payload) => {
        const { tabId, name } = payload || {};
        try {
            await ensureReady(tabId);
            await volumeRemove(tabId, name);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: normalizeDockerError(err) };
        }
    });

    registerIpc('networkRemove', async (_event, payload) => {
        const { tabId, id } = payload || {};
        try {
            await ensureReady(tabId);
            await networkRemove(tabId, id);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: normalizeDockerError(err) };
        }
    });

    registerIpc('containerLogs', async (_event, payload) => {
        const { tabId, id, options } = payload || {};
        try {
            await ensureReady(tabId);
            const text = await containerLogs(tabId, id, options || {});
            return { ok: true, text };
        } catch (err) {
            return { ok: false, error: normalizeDockerError(err) };
        }
    });

    registerIpc('containerShell', async (_event, payload) => {
        const { tabId, id } = payload || {};
        try {
            await ensureReady(tabId);
            const shell = await detectContainerShell(tabId, id);
            if (!shell) {
                return { ok: false, error: 'No shell found in container (bash/sh missing).' };
            }
            return { ok: true, shell, command: `docker exec -it ${id} ${shell}` };
        } catch (err) {
            return { ok: false, error: normalizeDockerError(err) };
        }
    });
};
