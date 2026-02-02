export function createPluginLoader(api) {
    const plugins = new Map();

    async function loadPlugins(context) {
        if (!api.getPlugins) return;
        try {
            const available = await api.getPlugins();
            for (const info of available) {
                if (info && info.enabled === false) {
                    continue;
                }
                if (info.rendererEntry && !info.error) {
                    try {
                        // dynamic import from the file URL
                        const module = await import(info.rendererEntry);
                        if (module.default && typeof module.default === 'function') {
                            module.default(context);
                            plugins.set(info.id, { ...info, module });
                            console.log(`[marinashell] Loaded renderer plugin: ${info.id}`);
                        }
                    } catch (err) {
                        console.error(`[marinashell] Failed to load renderer plugin ${info.id}:`, err);
                    }
                }
            }
        } catch (err) {
            console.error('[marinashell] Error fetching plugins:', err);
        }
    }

    return {
        loadPlugins
    };
}
