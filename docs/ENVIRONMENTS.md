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
- `agenv clone` auto-binds the cloned repository to a friendly name.
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

- **Set the active environment:**
  ```bash
  agenv use <name>
  ```
  Sets the active environment. To clear the active environment selection, run `agenv use --clear`.

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
1. **Pull:** Runs `git pull --ff-only` to bring down remote changes.
2. **Expand:** Deploys tracked files from the repository to your system, decrypting if necessary.
3. **Push:** Checks for local changes. If the `--push` flag is provided, it commits and pushes local modifications back to the remote. If not, it will interactively ask you for confirmation, or simply report the drift if in a non-interactive environment.

**Sync Options:**
- `agenv sync [target] [--push]` to automatically commit and push local changes.
- `agenv sync [target] [--no-push]` to prevent pushing local changes (useful for strictly pulling).

## Example: Working with Two Environments

Here is an example session showing how to manage and switch between a "work" and "personal" environment.

```bash
# You cloned your personal env earlier; let's clone the work one
agenv clone https://github.com/myuser/work-dotfiles --dir work
# (This automatically binds it under the name "work")

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
