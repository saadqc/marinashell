#!/usr/bin/env bash
# A per-run supervisor. Control requests are consumed by the owner of the job;
# clients never signal a PID read from an old record. Bash job control gives the
# command its own process group on macOS and Linux without requiring setsid.
set -u
umask 077
mode=$1
run_dir=$2
cd "$run_dir" || exit 1

identity() {
  ps -p "$1" -o lstart= 2>/dev/null | sed 's/^ *//;s/ *$//'
}
boot_identity() {
  if [ -r /proc/sys/kernel/random/boot_id ]; then cat /proc/sys/kernel/random/boot_id
  else sysctl -n kern.boottime 2>/dev/null; fi
}
alive() {
  [ -f supervisor ] && [ -f identity ] && [ -f boot ] || return 1
  local pid current
  pid=$(cat supervisor)
  case "$pid" in ''|*[!0-9]*) return 1;; esac
  current=$(identity "$pid")
  [ -n "$current" ] && [ "$current" = "$(cat identity)" ] && [ "$(boot_identity)" = "$(cat boot)" ]
}
if [ "$mode" = status ]; then
  state=$(cat state 2>/dev/null || echo unknown)
  if [ "$state" = running ] || [ "$state" = stopping ]; then
    if ! alive; then state=unknown; fi
  fi
  printf '%s\n' "$state"
  for field in exit supervisor pid identity child-identity boot generation; do
    tr '\n' ' ' < "$field" 2>/dev/null || true
    printf '\n'
  done
  size=$(wc -c < output 2>/dev/null || echo 0)
  printf '%s\n' "$size"
  offset=${3:-0}
  generation=${4:-0}
  current_generation=$(cat generation 2>/dev/null || echo 0)
  if [ "$generation" != "$current_generation" ] || [ "$offset" -gt "$size" ]; then offset=0; fi
  # Each read is bounded; byte offsets preserve ANSI and UTF-8 across chunks.
  tail -c +$((offset + 1)) output 2>/dev/null | head -c 262144 | base64
  exit 0
fi
if [ "$mode" = control ]; then
  case "${3:-}" in stop|kill) ;; *) exit 2;; esac
  alive || { echo 'Run owner unavailable; cannot safely signal this run.' >&2; exit 3; }
  printf '%s\n' "$3" > "request.$$.tmp"
  mv "request.$$.tmp" request
  exit 0
fi
if [ "$mode" = child ]; then
  # Keep the process-group leader alive after the application exits. The outer
  # owner can then finish/kill remaining workers without a reusable PID lookup.
  trap ':' TERM INT HUP
  bash ./command.sh </dev/null
  code=$?
  printf '%s\n' "$code" > command-exit.tmp; mv command-exit.tmp command-exit
  exec 3<>finish
  while ! IFS= read -r message <&3; do :; done
  exit "$code"
fi
[ "$mode" = run ] || exit 2
# The mkdir lock prevents two clients from launching the same configuration.
lock_dir=${3:-}
if [ -n "$lock_dir" ]; then
  if ! mkdir "$lock_dir" 2>/dev/null; then
    echo 'Another run holds the single-instance lock.' >> output
    printf 'blocked\n' > state
    exit 73
  fi
  printf '%s\n' "$run_dir" > "$lock_dir/run"
fi
printf '%s\n' "$$" > supervisor
identity $$ > identity
boot_identity > boot
printf '0\n' > generation
: > output
set -m
# FD 0 is closed to input; even a sourced startup file cannot turn this into
# an interactive terminal. Job %1 remains owned by this supervisor.
mkfifo finish
bash ./runner.sh child "$run_dir" </dev/null >>output 2>&1 &
child=$!
printf '%s\n' "$child" > pid
identity "$child" > child-identity
printf 'running\n' > state
stop_job() {
  printf 'stopping\n' > state
  kill -TERM %1 2>/dev/null || true
}
force_job() { kill -KILL %1 2>/dev/null || true; }
trap 'stop_job' TERM INT HUP
while jobs -p %1 >/dev/null 2>&1 && kill -0 "$child" 2>/dev/null; do
  if [ -f command-exit ]; then
    remaining=$(ps -axo pid=,pgid=,stat= | awk -v group="$child" '$2 == group && $1 != group && $3 !~ /^Z/ { n++ } END { print n+0 }')
    if [ "$remaining" = 0 ]; then
      printf 'finish\n' > finish
      break
    fi
  fi
  if [ -f request ]; then
    request=$(cat request); rm -f request
    if [ "$request" = kill ]; then force_job; else stop_job; fi
  fi
  bytes=$(wc -c < output)
  if [ "$bytes" -gt 8388608 ]; then
    # Bounded retained output. O_APPEND writers keep working after truncation.
    tail -c 4194304 output > output.tail
    cat output.tail > output; rm -f output.tail
    generation=$(cat generation); printf '%s\n' "$((generation + 1))" > generation
  fi
  sleep 0.25 & wait $! 2>/dev/null || true
 done
wait "$child"
code=$?
# Foreground commands are expected; clean up remaining members of this job.
kill -TERM %1 2>/dev/null || true
printf '%s\n' "$code" > exit.tmp; mv exit.tmp exit
if [ -n "$lock_dir" ] && [ "$(cat "$lock_dir/run" 2>/dev/null)" = "$run_dir" ]; then
  rm -f "$lock_dir/run"; rmdir "$lock_dir" 2>/dev/null || true
fi
# Inline environment values are not retained in launch scripts after exit.
# Publish exit only after releasing the single-instance lock. A restart may
# begin as soon as clients observe this state.
rm -f command.sh request finish
printf 'exited\n' > state.tmp; mv state.tmp state
exit "$code"
