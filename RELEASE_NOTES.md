# MarinaShell v0.2.21

- Open an existing project or group in **PyCharm, Antigravity IDE, VS Code, Sublime Text, WebStorm, or IntelliJ IDEA** from project options, grouped terminal menus, and saved-project libraries.
- Open all configured local folders together in one editor workspace, keeping folder names and order. Saved projects can open directly without starting terminal sessions.
- Configure automatic discovery, custom installation paths, installation selection, and a global default in **Settings → Editor → External editors**. Projects can override the default editor.
- Missing editors and folders now have clear dialogs with settings, editing, and retry actions. Workspace updates preserve editor settings and report conflicting folder changes.
- PyCharm and other JetBrains adapters use a managed aggregate project outside source repositories. PyCharm retains separate repository roots and existing interpreter references.

This release supports local folders. SSH and mixed-host projects display an unsupported-connection explanation. Native three-folder opening was verified in PyCharm, Antigravity IDE, and VS Code on macOS. Sublime, WebStorm, IntelliJ IDEA, and Windows/Linux discovery adapters are included, but native runtime validation for those targets remains pending. PyCharm interpreters absent from its SDK table must be selected in the IDE.
