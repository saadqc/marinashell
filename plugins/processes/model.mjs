export function withRates(snapshot, previous) {
  const seconds = previous ? snapshot.sampledAt - previous.sampledAt : 0;
  const before = new Map((previous?.processes || []).map(row => [row.pid, row]));
  return snapshot.processes.map(row => {
    const old = before.get(row.pid);
    const rate = key => seconds > 0 && row.identity != null && old?.identity === row.identity && row[key] != null && old[key] != null && row[key] >= old[key] ? (row[key] - old[key]) / seconds : null;
    return { ...row, readRate: rate('readBytes'), writeRate: rate('writeBytes') };
  });
}
export function filterAndSort(rows, name, port, key = 'ramBytes', direction = -1) {
  const query = name.trim().toLowerCase();
  const portText = port.trim();
  return rows.filter(row => (!query || `${row.name} ${row.user} ${row.pid}`.toLowerCase().includes(query)) && (!portText || row.ports.includes(Number(portText))))
    .sort((a,b) => {
      if (a[key] == null) return b[key] == null ? a.pid - b.pid : 1;
      if (b[key] == null) return -1;
      return (typeof a[key] === 'string' ? a[key].localeCompare(b[key]) : a[key] - b[key]) * direction || a.pid - b.pid;
    });
}
