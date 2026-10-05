"""Session-owned debugpy entry point; no application source changes required.

Let debugpy bind an ephemeral port itself and publish that endpoint in the
private run directory. This avoids probing a free port and attaching to a
listener belonging to another process in the gap before launch.
"""
import json
import os
import runpy
import sys
import tempfile

import debugpy

endpoint_file, mode, target, *arguments = sys.argv[1:]
debugpy.configure(subProcess=False)
host, port = debugpy.listen(("127.0.0.1", 0))
with tempfile.NamedTemporaryFile(mode="w", dir=os.path.dirname(endpoint_file), delete=False) as endpoint:
    json.dump({"host": host, "port": port, "pid": os.getpid(), "cwd": os.getcwd(),
               "interpreter": sys.executable, "version": debugpy.__version__}, endpoint)
os.replace(endpoint.name, endpoint_file)
print("PyDebug: waiting for debugger", flush=True)
debugpy.wait_for_client()
if mode == "module":
    sys.path.insert(0, os.getcwd())
    sys.argv = [target, *arguments]
    runpy.run_module(target, run_name="__main__", alter_sys=True)
else:
    target = os.path.abspath(os.path.expanduser(target))
    sys.path.insert(0, os.path.dirname(target))
    sys.argv = [target, *arguments]
    runpy.run_path(target, run_name="__main__")
