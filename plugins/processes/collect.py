import ctypes
import json
import os
import platform
import re
import shutil
import subprocess
import time

# Names only: do not collect command-line arguments or environment variables.
def collect():
    system = platform.system()
    if system not in ('Linux', 'Darwin'):
        raise RuntimeError('Process collection currently supports macOS and Linux hosts.')
    env = dict(os.environ, LC_ALL='C')
    result = subprocess.run(['ps', '-axo', 'pid=,user=,pcpu=,rss=,comm='], capture_output=True, text=True, check=True, timeout=10, env=env)
    notes = []
    ports = {}
    lsof = shutil.which('lsof') or next((p for p in ['/usr/sbin/lsof', '/sbin/lsof'] if os.path.isfile(p)), None)
    if lsof:
        try:
            sockets = subprocess.run([lsof, '-nP', '-i', '-Fpn'], capture_output=True, text=True, timeout=10, env=env)
            if sockets.returncode not in (0, 1):
                notes.append('Some port information could not be read.')
            pid = None
            for line in sockets.stdout.splitlines():
                if line.startswith('p') and line[1:].isdigit():
                    pid = int(line[1:])
                elif pid and line.startswith('n'):
                    local = line[1:].split('->')[0]
                    match = re.search(r':(\d+)(?:\s|$)', local)
                    if match:
                        ports.setdefault(pid, set()).add(int(match.group(1)))
        except subprocess.TimeoutExpired:
            notes.append('Port lookup timed out; process usage is still available.')
    else:
        notes.append('Install lsof on this host to filter by port.')
    libproc = None
    if system == 'Darwin':
        try:
            libproc = ctypes.CDLL('/usr/lib/libproc.dylib')
            libproc.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
            libproc.proc_pid_rusage.restype = ctypes.c_int
        except OSError:
            pass
    class RusageV2(ctypes.Structure):
        # Apple's rusage_info_v2 ABI: uuid, then 18 uint64 counters.
        _fields_ = [('uuid', ctypes.c_uint8 * 16), ('values', ctypes.c_uint64 * 18)]
    processes = []
    for line in result.stdout.splitlines():
        values = line.strip().split(None, 4)
        if len(values) != 5:
            continue
        try:
            pid, user, cpu, rss, name = values
            pid = int(pid)
            row = dict(pid=pid, user=user, name=name, cpuPercent=float(cpu), ramBytes=int(rss)*1024,
                       readBytes=None, writeBytes=None, identity=None, ports=sorted(ports.get(pid, [])))
            if system == 'Linux':
                try:
                    with open('/proc/%s/stat' % pid) as handle:
                        row['identity'] = handle.read().rsplit(')', 1)[1].split()[19]
                    with open('/proc/%s/io' % pid) as handle:
                        io = dict(entry.split(':', 1) for entry in handle.read().splitlines())
                    row['readBytes'], row['writeBytes'] = int(io['read_bytes']), int(io['write_bytes'])
                except (OSError, KeyError, IndexError, ValueError):
                    pass
            elif libproc:
                usage = RusageV2()
                if libproc.proc_pid_rusage(pid, 2, ctypes.byref(usage)) == 0:
                    row['identity'] = str(usage.values[8])
                    row['readBytes'], row['writeBytes'] = int(usage.values[16]), int(usage.values[17])
            processes.append(row)
        except (ValueError, OverflowError):
            continue
    notes.append('CPU is reported by ps. Disk rates need two samples; restricted counters appear as —. Ports are local TCP/UDP endpoints visible to your account.')
    return dict(processes=processes, sampledAt=time.time(), platform=system, notes=notes)

if __name__ == '__main__':
    print(json.dumps(collect(), allow_nan=False))
