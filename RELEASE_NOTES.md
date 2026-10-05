# MarinaShell v0.2.19

- Fixed Reconnect showing “Session disconnected” after successfully starting a new shell. Delayed exit/data events from the replaced terminal now stay with that terminal, and reconnect waits for previous connection cleanup. Applies to local and SSH terminals.
- Added **Environment → Python debugger** to Python run configurations. See whether debugpy is available in the selected environment, copy the resolved interpreter's installation command, or click **Install debugpy** to install the tested version (1.8.17). Local and SSH installations recheck readiness, show pip failures, and allow retry.
- Debugger status resets when the configuration's interpreter or environment changes. Configurations with setup scripts use an explicit **Check debugpy** action so opening the dialog does not execute those scripts.
- Fixed Zsh startup tracking when the prompt-hook array is unset.

PyDebug requires Python 3.9+ and debugpy 1.8.x. Enable PyDebug, Editor, and Run Configurations in Settings → Plugins. See the [PyDebug setup and usage guide](https://github.com/saadqc/marinashell/blob/v0.2.19/docs/pydebug.md).
