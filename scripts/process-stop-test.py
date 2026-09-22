import importlib.util
import subprocess
import sys
import unittest

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('stop', 'plugins/processes/stop.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class StopTests(unittest.TestCase):
    def test_stop_and_force(self):
        for stubborn in (False, True):
            child = subprocess.Popen([sys.executable, '-u', '-c',
                'import signal,time; ' + ('signal.signal(signal.SIGTERM,signal.SIG_IGN); ' if stubborn else '') + 'print("ready",flush=True); time.sleep(60)'], stdout=subprocess.PIPE)
            try:
                child.stdout.readline()
                payload = dict(pid=child.pid, identity=module.identity(child.pid))
                with self.assertRaises(RuntimeError):
                    module.stop(dict(payload, identity='stale'))
                self.assertIsNone(child.poll())
                self.assertTrue(module.stop(payload)['ok'])
                if stubborn:
                    self.assertIsNone(child.poll())
                    self.assertTrue(module.stop(dict(payload, force=True))['ok'])
                self.assertEqual(child.wait(timeout=5), -9 if stubborn else -15)
                self.assertTrue(module.stop(payload)['exited'])
            finally:
                if child.poll() is None: child.kill(); child.wait()
                child.stdout.close()

    def test_invalid(self):
        for pid in (0, 1, -1, '12', True):
            with self.assertRaises(ValueError): module.stop(dict(pid=pid,identity='x'))

if __name__ == '__main__': unittest.main()
