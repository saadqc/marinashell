// Recover missing project links from a unique matching host and directory.
// Explicit links win; ambiguous matches stay separate instead of guessing.
function projectConfigurations(projects, configurations) {
  const result = projects.map(p => ({ ...p, configurationIds: [...new Set(p.configurationIds || [])] }));
  const linked = new Set(result.flatMap(p => p.configurationIds));
  const directory = value => String(value || "").replace(/\/+$/, "");
  for (const config of configurations) {
    if (linked.has(config.id)) continue;
    const cwd = directory(config.cwd);
    if (!cwd) continue;
    const matches = result.map(project => ({ project, score: Math.max(0, ...(project.tabs || []).map(tab => {
      const base = directory(tab.currentPath || tab.directory);
      return base && base !== "/" && (tab.host || "__local__") === config.host &&
        (cwd === base || cwd.startsWith(`${base}/`)) ? base.length : 0;
    })) }));
    const best = Math.max(0, ...matches.map(m => m.score));
    const owners = matches.filter(m => m.score > 0 && m.score === best);
    if (owners.length === 1) owners[0].project.configurationIds.push(config.id);
  }
  return result.map(({ tabs, ...project }) => project);
}
module.exports = { projectConfigurations };
