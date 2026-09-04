const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { exec } = require('child_process');
const { ipcMain } = require('electron');

const USER_PLUGINS_DIR = path.join(os.homedir(), '.marinashell', 'plugins');
// In development, app.getAppPath() might point to the source root. 
// In production, it might be in Resources/app.asar. 
// We'll define a strategy to locate the bundled plugins folder.
// For now, assuming standard electron app structure or dev mode.

function getBundledPluginsDir(app) {
    // Try to find the plugins folder relative to the app path
    const appPath = app.getAppPath();
    const candidates = [
        path.join(appPath, 'plugins'),
        path.join(path.dirname(appPath), 'plugins') // e.g. parallel to resources
    ];

    for (const c of candidates) {
        if (fs.existsSync(c)) {
            return c;
        }
    }
    return null;
}

function createPluginManager({ app, sessionManager, getMainWindow, getSettings }) {
    const plugins = new Map(); // id -> pluginObject

    function readSettingValue(pathParts, fallback) {
        const settings = typeof getSettings === 'function' ? getSettings() : null;
        let node = settings;
        for (const part of pathParts) {
            if (!node || typeof node !== 'object') return fallback;
            node = node[part];
        }
        if (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, 'value')) {
            return node.value;
        }
        return fallback;
    }

    function getDisabledIds() {
        const list = readSettingValue(['plugins', 'disabled', 'list'], []);
        return Array.isArray(list) ? list.map((v) => String(v)) : [];
    }

    function isEnabled(id) {
        const disabled = getDisabledIds();
        return !disabled.includes(String(id));
    }

    function ensureUserDir() {
        if (!fs.existsSync(USER_PLUGINS_DIR)) {
            fs.mkdirSync(USER_PLUGINS_DIR, { recursive: true });
        }
    }

    function loadPluginFromDir(dirPath, source) {
        try {
            if (!fs.existsSync(dirPath)) return null;
            const stat = fs.statSync(dirPath);
            if (!stat.isDirectory()) return null;

            const packageJsonPath = path.join(dirPath, 'package.json');
            if (!fs.existsSync(packageJsonPath)) return null;

            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            const id = pkg.name || path.basename(dirPath);

            // Check if already loaded (e.g. user override bundled)
            if (plugins.has(id)) return;

            const enabledNow = isEnabled(id);

            const pluginInfo = {
                id,
                version: pkg.version || '0.0.0',
                description: pkg.description || '',
                editorMode: pkg.marinashell && pkg.marinashell.editorMode
                    ? String(pkg.marinashell.editorMode)
                    : null,
                mainEntry: pkg.main ? path.join(dirPath, pkg.main) : null,
                rendererEntry: pkg.renderer ? path.join(dirPath, pkg.renderer) : null,
                dirPath,
                source, // 'user' or 'bundled'
                loaded: false,
                enabledAtLoad: enabledNow,
                ipcChannels: [],
                error: null
            };

            if (!enabledNow) {
                plugins.set(id, pluginInfo);
                return;
            }

            function loadMain() {
                if (!pluginInfo.mainEntry || !fs.existsSync(pluginInfo.mainEntry)) {
                    if (pluginInfo.mainEntry) {
                        console.warn(`[PluginManager] Main entry defined but not found: ${pluginInfo.mainEntry}`);
                    }
                    pluginInfo.loaded = true; // No main entry is valid (renderer-only plugin)
                    return;
                }
                console.log(`[PluginManager] Loading main entry for ${id} from ${pluginInfo.mainEntry}`);
                const pluginMain = require(pluginInfo.mainEntry);
                if (typeof pluginMain !== 'function') {
                    console.error(`[PluginManager] Main entry for ${id} is not a function`);
                    return;
                }
                const context = {
                    app,
                    sessionManager,
                    getMainWindow,
                    getSettings,
                    pluginPath: dirPath,
                    registerIpc: (channel, handler) => {
                        const fullChannel = `plugin:${id}:${channel}`;
                        console.log(`[PluginManager] Registering IPC: ${fullChannel}`);
                        pluginInfo.ipcChannels.push(fullChannel);
                        ipcMain.handle(fullChannel, async (event, payload) => {
                            if (!isEnabled(id)) {
                                return { ok: false, disabled: true, error: 'Plugin disabled' };
                            }
                            return handler(event, payload);
                        });
                    },
                };
                pluginMain(context);
                pluginInfo.loaded = true;
            }

            // Load Main Process logic if present
            try {
                loadMain();
            } catch (err) {
                console.error(`[marinashell] Failed to load main plugin ${id}:`, err);
                pluginInfo.error = err.message;
            }

            plugins.set(id, pluginInfo);
        } catch (err) {
            console.error(`[marinashell] Error loading plugin from ${dirPath}:`, err);
        }
    }

    function scanDirectory(baseDir, source) {
        if (!baseDir || !fs.existsSync(baseDir)) return;
        const entries = fs.readdirSync(baseDir);
        for (const entry of entries) {
            // Skip hidden files/dirs
            if (entry.startsWith('.')) continue;
            const fullPath = path.join(baseDir, entry);
            loadPluginFromDir(fullPath, source);
        }
    }

    function init() {
        console.log('[marinashell] Initializing plugin manager...');
        ensureUserDir();

        // 1. Scan User Plugins (Priority)
        scanDirectory(USER_PLUGINS_DIR, 'user');

        // 2. Scan Bundled Plugins
        const bundledDir = getBundledPluginsDir(app);
        if (bundledDir) {
            scanDirectory(bundledDir, 'bundled');
        }

        console.log(`[marinashell] Loaded ${plugins.size} plugins.`);
    }

    function getPluginsList() {
        return Array.from(plugins.values()).map(p => {
            const enabled = isEnabled(p.id);
            return ({
            id: p.id,
            version: p.version,
            description: p.description,
            editorMode: p.editorMode,
            rendererEntry: p.rendererEntry ? pathToFileURL(p.rendererEntry).href : null,
            source: p.source,
            loaded: p.loaded,
            enabled,
            enabledAtLoad: p.enabledAtLoad,
            error: p.error
            });
        });
    }

    function installPlugin(repoUrl) {
        return new Promise((resolve, reject) => {
            // Basic validation
            if (!repoUrl || !repoUrl.startsWith('http')) {
                return reject(new Error('Invalid URL'));
            }

            // Name inference (basic)
            const parts = repoUrl.split('/');
            let folderName = parts[parts.length - 1] || 'plugin';
            if (folderName.endsWith('.git')) {
                folderName = folderName.slice(0, -4);
            }

            const targetPath = path.join(USER_PLUGINS_DIR, folderName);
            if (fs.existsSync(targetPath)) {
                return reject(new Error(`Plugin directory ${folderName} already exists`));
            }

            // git clone
            exec(`git clone "${repoUrl}" "${targetPath}"`, (error, stdout, stderr) => {
                if (error) {
                    return reject(new Error(`Git clone failed: ${error.message}`));
                }
                // Attempt to load it immediately
                loadPluginFromDir(targetPath, 'user');
                resolve({
                    id: folderName, // Ideally we'd read package.json name, but this is a decent fallback return
                    path: targetPath
                });
            });
        });
    }

    function syncEnabled() {
        // Allows enabling plugins without restarting the app:
        // - If a plugin was disabled at init (so main wasn't loaded), load its main now when enabled.
        for (const pluginInfo of plugins.values()) {
            if (!pluginInfo) continue;
            if (pluginInfo.error) continue;
            if (!isEnabled(pluginInfo.id)) continue;
            if (pluginInfo.loaded) continue;
            if (!pluginInfo.mainEntry || !fs.existsSync(pluginInfo.mainEntry)) {
                pluginInfo.loaded = true;
                continue;
            }
            try {
                console.log(`[PluginManager] Enabling plugin main for ${pluginInfo.id}`);
                const id = pluginInfo.id;
                const dirPath = pluginInfo.dirPath;
                const pluginMain = require(pluginInfo.mainEntry);
                if (typeof pluginMain !== 'function') {
                    console.error(`[PluginManager] Main entry for ${id} is not a function`);
                    continue;
                }
                const context = {
                    app,
                    sessionManager,
                    getMainWindow,
                    getSettings,
                    pluginPath: dirPath,
                    registerIpc: (channel, handler) => {
                        const fullChannel = `plugin:${id}:${channel}`;
                        console.log(`[PluginManager] Registering IPC: ${fullChannel}`);
                        pluginInfo.ipcChannels.push(fullChannel);
                        ipcMain.handle(fullChannel, async (event, payload) => {
                            if (!isEnabled(id)) {
                                return { ok: false, disabled: true, error: 'Plugin disabled' };
                            }
                            return handler(event, payload);
                        });
                    },
                };
                pluginMain(context);
                pluginInfo.loaded = true;
            } catch (err) {
                console.error(`[marinashell] Failed to enable plugin ${pluginInfo.id}:`, err);
                pluginInfo.error = err && err.message ? err.message : String(err);
            }
        }
    }

    return {
        init,
        getPluginsList,
        installPlugin,
        syncEnabled
    };
}

module.exports = { createPluginManager };
