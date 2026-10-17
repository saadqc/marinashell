# Git changes and pull requests

Enable **Git** in **Settings → Plugins**. Enable **Editor** for CodeMirror comparisons. Git operations work independently of Run Configurations.

## Open a comparison

Select a connected local or SSH terminal inside a repository, then click **Git → Diff** on the left. Alternatively, right-click a terminal pane and choose **Git Diff** to use that pane's host and current directory. The icon and context action stay hidden outside a Git worktree. Refresh after external changes.

The changed-file list separates staged, unstaged, and untracked changes. A file changed in both index and working tree appears twice; select the appropriate row. Green and red counts show additions and deletions. Select **Unified** or **Split** above the CodeMirror diff; the choice persists globally. Previous/Next arrows, or Alt+Up/Down, move between hunks in that file.

Comparisons are read-only. Binary files, submodules, conflicts, and files over the 2 MB content limit display an explanation. Large changes do not have to be opened to operate on their files.

Open **Working changes** in the compact toolbar to filter and choose a local or remote tracking branch. Branch comparisons show committed changes from the merge base to HEAD, exclude uncommitted changes, and do not switch branches. Return to **Working changes** in the picker to see the working tree. Use **Fetch** explicitly to refresh remote refs. The repository path is available by hovering the branch name or changed-file count.

## Git operations

Open the **Git operations** dropdown to stage/unstage the selected file or all files, commit the existing index, fetch, pull with fast-forward-only behavior, push to a selected remote/branch, or create/switch branches. Dropdowns overlay the comparison so the file list and diff keep their full height. Escape or clicking outside closes them. A changed repository snapshot requires Refresh before a write. Operations retain normal Git hooks, signing, and credential behavior. Unsupported interactive prompts are reported as errors.

## Pull requests

The **Pull Requests** tab detects GitHub CLI on the execution host. To override its executable, use **Settings → Git → GitHub CLI paths by host**. The JSON object maps `__local__` or an SSH alias to that host's executable path. Sign in with `gh auth login` on the relevant host before using PR features.

Choose the remote and the project's GitHub account. Account selection persists with the project and does not run `gh auth switch` or change other projects' active accounts. SSH Git authentication and commit authorship continue to use Git's own settings.

Select a PR from the searchable title picker to view its changed files in the same Unified/Split viewer, using immutable base/merge-base/head revisions. The picker overlays the diff; the file list and editor retain their full height. PR state, author, and source/target branches are available in the picker's tooltip, and the list shows each PR's state and branches. The remote dropdown contains repository and account settings; **Branch** contains branch selection and **Open branch in browser**. Use **Open PR ↗** for the selected PR. Published branches can open in the browser even when PR authentication is unavailable. The Git header's Refresh button refreshes the active Diff or Pull Requests view.

PR files first use exact commit objects already present in the terminal host's Git repository; unsaved working-tree files are never substituted. Missing objects fall back to GitHub, with old/new versions loaded concurrently. Successful contents are kept in a bounded memory cache (32 MB of UTF-16 text, up to 256 entries), isolated by execution host, project, GitHub repository/account, commit SHA, and path. Switching files reuses those contents; closing the app clears the cache. Reopening a PR reuses its metadata until **Refresh**, which checks for new commits while retaining unchanged cached file contents.

**New PR** collects title, description, base/head branches, head remote, and draft status. **Preview diff** shows the current branch comparison. Push the head branch explicitly before creating the PR. Existing PRs are opened rather than duplicated; an uncertain creation outcome must be reconciled from the PR list before a new request.

Verification: `npm run test:git`, `npm run test:git:ui`, and `npm run test:github`. The Git UI suite uses the real Electron app and a private loopback SSH server. GitHub tests combine a CLI fixture with real Git repositories and partial clones to check cache reuse, concurrent fallback, isolation, and content limits. They do not create PRs in a user's repositories.
