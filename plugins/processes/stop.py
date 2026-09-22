import ctypes
import json
import os
import platform
import signal
import sys


def identity(pid):
    if platform.system() == 'Linux':
        with open('/proc/%s/stat' % pid) as handle:
            return handle.read().rsplit(')', 1)[1].split()[19]
    if platform.system() == 'Darwin':
        class Usage(ctypes.Structure):
            _fields_ = [('uuid', ctypes.c_uint8 * 16), ('values', ctypes.c_uint64 * 18)]
        lib = ctypes.CDLL('/usr/lib/libproc.dylib')
        lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
        usage = Usage()
        if lib.proc_pid_rusage(pid, 2, ctypes.byref(usage)) == 0:
            return str(usage.values[8])
    os.kill(pid, 0)  # Distinguish an exited process from an unreadable identity.
    raise RuntimeError('Cannot verify this process. Refresh the list and try again.')


def stop(payload):
    pid = payload['pid']
    if type(pid) is not int or pid <= 1 or not isinstance(payload.get('identity'), str) or not payload['identity']:
        raise ValueError('Invalid process identity.')
    fd = None
    try:
        if hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'):
            fd = os.pidfd_open(pid)
        if identity(pid) != payload['identity']:
            raise RuntimeError('This PID now belongs to a different process. Refresh the list.')
        sig = signal.SIGKILL if payload.get('force') is True else signal.SIGTERM
        if fd is not None:
            signal.pidfd_send_signal(fd, sig)
        else:
            os.kill(pid, sig)
        return {'ok': True}
    except (ProcessLookupError, FileNotFoundError):
        return {'ok': True, 'exited': True}
    finally:
        if fd is not None:
            os.close(fd)


if __name__ == '__main__':
    try:
        print(json.dumps(stop(json.loads(sys.argv[1]))))
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error)}))
