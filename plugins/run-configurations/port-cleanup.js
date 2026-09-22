// Limit cleanup to TCP listeners on the configured execution host.
function portCleanupScript(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer between 1 and 65535');
  return `command -v lsof >/dev/null || { echo 'Port cleanup requires lsof on the execution host' >&2; exit 1; }
marina_port_pids=$(lsof -nP -t -iTCP:${port} -sTCP:LISTEN 2>/dev/null) || marina_port_pids=''
if [ -n "$marina_port_pids" ]; then
  printf 'Stopping TCP listeners on port ${port}\\n'
  for marina_port_pid in $marina_port_pids; do
    case "$marina_port_pid" in ''|*[!0-9]*) echo 'Invalid listener PID' >&2; exit 1;; esac
    kill -KILL "$marina_port_pid" || { kill -0 "$marina_port_pid" 2>/dev/null && exit 1; }
  done
  for marina_port_wait in {1..30}; do
    if ! lsof -nP -t -iTCP:${port} -sTCP:LISTEN >/dev/null 2>&1; then break; fi
    sleep 0.1
  done
  if lsof -nP -t -iTCP:${port} -sTCP:LISTEN >/dev/null 2>&1; then echo 'Port ${port} is still occupied' >&2; exit 1; fi
fi`;
}
module.exports = { portCleanupScript };
