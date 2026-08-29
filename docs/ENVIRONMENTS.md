# Managing Multiple Environments

`agenv` is designed to seamlessly handle multiple environment profiles—such as separating your work dotfiles from your personal configurations, or managing different project-specific AI agent configs. It does this via a global environment registry.

## The Registry (`~/.config/agenv/registry.json`)

The registry keeps track of all your local environment repositories and their remote Git URLs. It acts as a central phonebook for your environments, tracking:
- A friendly **name** for the environment (e.g., `work`, `personal`).
- The **local directory** path.
- The **remote URL** of the repository.
- The last time it was successfully synchronized (`lastSynced`).
- The **active** environment flag.

**Automatic Updates:**
The registry automatically updates in the background. For example:
- `agenv publish` auto-binds the repository upon successfully creating a remote.
- `agenv sync` updates the `lastSynced` timestamp upon completion.

## Registry Commands

You can interact with the registry using the following commands:

- **List environments:**
  ```bash
  agenv envs
  ```
  Shows all registered environments, their paths, remote URLs, last sync times, and highlights the currently active environment.

- **Register (bind) an environment:**
  ```bash
  agenv bind <name> [--dir <path>] [--url <repo-url>]
  ```
  Binds an existing local environment repository to a friendly name. If run without options, it binds the current directory.

- **Remove (unbind) an environment:**
  ```bash
  agenv unbind <name>
  ```
  Removes the environment from the registry (does not delete the files on disk).

- **Set or show the active environment:**
  ```bash
  agenv use [name]
  ```
  Without arguments, shows the current active environment. With a name, sets it as active. To clear the active environment selection, run `agenv use --clear`.

## Targeting Environments from Anywhere

Once an environment is registered, you no longer need to `cd` into its directory to manage it. Most `agenv` commands accept an optional `[target]` argument, which can be a registered **name**, a **local path**, or a **registered Git URL**.

```bash
# Target by registered name
agenv status work
agenv sync personal

# Target by local path
agenv update /path/to/specific/env

# Target by Git URL (must be in the registry)
agenv status https://github.com/myuser/work-env
```

*Note on URL targeting:* If you target a Git URL that is not currently bound in the registry, the CLI will throw an error with instructions on how to use `agenv clone` or `agenv bind` to register it first.

## Keeping in Sync (`agenv sync`)

The `agenv sync` command acts as a unified updater. Its execution flow is:
1. **Plan:** Compares local tracked-file drift, canonical repository state, and remote Git state. Clean environments exit immediately as a no-op.
2. **Pull:** Runs `git pull --ff-only` (default) to bring down remote changes. Pass `--rebase` to `agenv sync` to rebase local commits onto the remote instead when branches have diverged.
3. **Capture:** Captures safe local tracked-file drift into the canonical `agenv.json` / `files/` store before expand can overwrite local edits.
4. **Expand:** Deploys tracked files from the repository to your system, decrypting if necessary. Same-file local/remote conflicts stop here before any overwrite and report conflict IDs.
5. **Push:** If `--push` is provided, commits and pushes only canonical environment files (`agenv.json`, `files/`, `.gitignore`, `README.md`). If not, it interactively asks for confirmation, or reports the skipped push in non-interactive mode.

**Sync Options:**
- `agenv sync [target] [--push]` to automatically commit and push local changes.
- `agenv sync [target] [--no-push]` to prevent pushing local changes (useful for strictly pulling).
- `agenv sync [target] [--rebase]` to rebase local commits onto the remote before pushing (default pull strategy is `git pull --ff-only`).
- `agenv sync [target] [--json]` to emit the same state for agents/scripts, including `status`, `hasRemoteAhead`, `hasRemoteBehind`, `conflicts`, and `nextCommand`.

## Example: Working with Two Environments

Here is an example session showing how to manage and switch between a "work" and "personal" environment.

```bash
# You cloned your personal env earlier; let's clone the work one
agenv clone https://github.com/myuser/work-dotfiles --dir work

# Bind it to the registry under a friendly name
agenv bind work --dir work

# Check all registered environments
agenv envs
# Output shows both 'personal' and 'work', with 'work' active.

# Switch the active environment back to 'personal'
agenv use personal

# Check the drift for the work environment without changing directories
agenv status work

# Sync both environments, auto-pushing any local tweaks back to GitHub
agenv sync personal --push
agenv sync work --push
```
