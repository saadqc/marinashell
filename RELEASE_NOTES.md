## Runs that behave like an IDE

- Launching a run configuration no longer opens a terminal tab. Runs appear in a status chip next to the configuration dropdown, with a green dot while running.
- Open a run's output from the chip dropdown or the new tabs in the terminal pane header. Output views are limited to one per configuration and never appear in the top session-tab strip.
- Run output tabs live next to the "Terminal" pane title, so switching between runs never disturbs your session tabs.
- Terminal links recognize absolute file paths, including `path:line`, and open them in the CodeMirror editor. Local files open without a terminal session.
- The environment picker lists only environments of the selected environment manager: mamba shows mamba environments, pyenv shows pyenv versions, and direct interpreters stay under Direct interpreter.
- A stale environment manager path falls back to a `PATH` lookup at launch instead of failing.
- The configuration dropdown shows every tab group's configurations under their group name; only ungrouped configurations remain under All configurations.
