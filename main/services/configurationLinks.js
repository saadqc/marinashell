function removeConfigurationLinks(groups, retired) {
  if (!retired.size) return groups || [];
  return (groups || []).map(group => ({ ...group,
    ...(Array.isArray(group.configurationIds) ? { configurationIds: group.configurationIds.filter(id => !retired.has(id)) } : {}),
    ...(Array.isArray(group.tabs) ? { tabs: group.tabs.map(tab => retired.has(tab.configurationId) ? { ...tab, configurationId: '' } : tab) } : {})
  }));
}
module.exports = { removeConfigurationLinks };
