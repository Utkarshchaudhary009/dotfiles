---
name: agenv
description: Use when the user wants to backup their environment, manage dotfiles, sync configuration across machines, clone or expand an environment setup, publish their env, or otherwise interact with the agenv CLI tool.
---

# agenv: Portable Encrypted Dev Environment Manager

## Overview
`agenv` is a CLI tool for managing portable, encrypted developer environments.
- **Manifest:** `agenv.json` tracks the environment state and metadata.
- **Files Storage:** Tracked files are copied into the `files/` directory within the environment repository.
- **Secrets:** Sensitive files are encrypted using `age` and stored with a `.age` extension.
- **Encryption Key:** Stored locally at `~/.config/agenv/key.txt`.
- **Registry:** Global list of known environments is tracked at `~/.config/agenv/registry.json`.

## How to Run / Handle Agent Context
- **Installed:** `agenv <cmd>`
- **In Development Repo (agenv source checkout):** `bun src/cli.ts <cmd>` (Requires Bun. Fallback is `node dist/agenv.js <cmd>` after `bun run build`).
- **RULES FOR AGENTS:** Always prefer non-interactive flags (e.g., `--yes` for init, `--remote <url> --yes` for publish, `--no-push` or `--push` for sync) so you do not block on interactive prompts. Capture stdout/stderr to read the CLI's output.

## Setup Wizard (Init)
- `agenv init [--dir <path>] [--yes] [--allow-plaintext-secrets] [--force] [--publish] [--no-publish]`
- Creates the env repo, scans system categories (opencode, claude, agents, git, vscode, shell), encrypts sensitive files, initializes a `main` git branch, and commits.
- **Pointers:** Using `--yes` selects defaults. The CLI will refuse to add unencrypted sensitive files if `age` is missing (requires `--allow-plaintext-secrets` to override, but prefer fixing `age` installation instead).

## Managing Tracked Files
- **Add:** `agenv add <files...> [--encrypt] [-c <category>] [--allow-plaintext-secrets] [-u/--update] [--yes] [--json]` (Accepts multiple paths or a bare category id. Auto-registers custom categories. Assigns a default category per file type). `<file>` paths can be absolute or use `~`.
- **Remove:** `agenv remove <file|id> [--no-delete]`
- **Scan:** `agenv scan [--category <id>] [--apply] [--encrypt] [--allow-plaintext-secrets] [-u/--update] [--yes] [--json]` — Discovery of system config files grouped by category (opencode, claude, agents, git, vscode, shell). Without `--apply` it makes no changes.
- **SECURITY RULE:** ALWAYS use `--encrypt` for files containing secrets, tokens, credentials, or API keys (e.g., auth JSON, `.credentials`, accounts, keys). Sensitivity detection is mostly handled automatically at init, but manual additions by the agent must enforce this.

## Deploy / Sync Commands
- `agenv expand [--dry-run] [--force] [--yes] [target]` — Deploys the environment to `$HOME`. Idempotent operation; modified local files are skipped unless forced.
- `agenv update [target]` — Pulls latest changes from remote + expands.
- `agenv sync [target] [--push] [--no-push] [--no-scan] [--rebase] [--yes] [--json]` — Plans local/repo/remote reconciliation, pulls, captures safe tracked-file drift before expand, expands, then commits and pushes canonical environment files when requested. Use `--push` to push automatically, or `--no-push` to only report. Pass `--rebase` to rebase local commits onto the remote instead of `git pull --ff-only`; pass `--json` to emit a structured `SyncResult` (`status`, `hasRemoteAhead`, `hasRemoteBehind`, `conflicts`, `nextCommand`) for automation. If sync reports file-level conflicts, do not force expand; run the recommended command and resolve the listed IDs first.
- `agenv push [-m, --message <msg>]` — Commits and pushes changes.
- `agenv status [target] [--json]` — Shows current status (local changes, sync state).
- `agenv list [target]` — Lists files tracked in the environment.
*(Note: `[target]` can be a registry name, a local path, or a Git URL. Defaults to the active environment or CWD).*

## Registry / Multi-Env
- `agenv envs` — List environments in the local registry.
- `agenv bind <name> [--dir <path>] [--url <url>]` — Bind an environment to the registry manually.
- `agenv unbind <name>` — Remove an environment from the registry.
- `agenv use [name]` / `agenv use --clear` — Set or clear the globally active environment. Without arguments, shows the current active environment. Targeting works from anywhere by name, path, or URL.

## Publish / Share
- `agenv publish [--public] [--name <repoName>] [--remote <url>] [--attach] [--new] [--yes] [--dir <path>]`
- Creates a new GitHub repository (using `gh`), or attaches to an existing repository (verifying via `gh`). Auto-binds the environment in the registry and prints the clone URL.

## Clone / Restore
- `agenv clone <url> [--dir <path>]` — Clones the remote environment and expands it.
- `agenv export [--out <file>]` — Exports the environment to a Git-free `.tar.gz` archive.
- `agenv import <file> [--dir <path>]` — Imports a Git-free archive (useful for air-gapped or non-Git transfers).

## Doctor & Hygiene
- `agenv doctor` — Validates the installation, `age` key presence, and `agenv.json` manifest. Run this if encountering environment problems.
- `agenv self-update` — Updates the agenv CLI to the latest GitHub release.

## Agent Workflow Recipes
1. **Help user capture their environment:**
   - Run `agenv envs`.
   - If none exist, run `agenv init --yes` in their chosen directory.
   - Run `agenv publish --yes` to get the repository URL.
   - Tell the user the resulting URL.
2. **Add a new config to the current env:**
   - Run `agenv status` to verify current state.
   - Run `agenv add <path> [--encrypt]` (Ensure `--encrypt` is used if it contains sensitive data).
   - Run `agenv push` to save the state.
3. **Sync an existing env here:**
   - Run `agenv sync <name> --yes` (this performs pull + expand).
   - Optionally run with `--push` if the user modified files locally and wants to push them back.
4. **Bootstrap a VM/CI:**
   - Run `agenv clone <url>`.
   - *Important:* Note that the `age` key must be present at `~/.config/agenv/key.txt`. If missing, instruct the user to securely copy their key to this location before expanding.
5. **Update docs/README of the agenv repo:**
   - Follow standard Git workflows (`git add -A; git commit; git push`) inside the repo, as `agenv` itself does not manage its own source code's README.

## Safety Rails (Blocklist)
- **NEVER** commit `~/.config/agenv/key.txt` or any file named `key.txt` containing encryption keys.
- **NEVER** print the full decrypted content of `.age` or secret files to the AI transcript (always redact sensitive values).
- **NEVER** run `agenv expand` against a repository whose `agenv.json` contains untrusted `targetRel` fields. Validate to prevent path traversal attacks.
- **WINDOWS FALLBACK:** If the `agenv` command is not on the `PATH`, use `bun <path_to_cli.ts>` or `node <path_to_dist>`.

## Troubleshooting Quick Table
| Issue | Solution |
|-------|----------|
| `age` missing | Instruct user/agent to install `age`. |
| Key missing on expand/clone | Copy valid key to `~/.config/agenv/key.txt`. |
| "Local changes detected" in sync | Use `--push` to commit/push them, or decline. |
| "not registered" error | The environment must be cloned first, or manually bound using `agenv bind`. |
| `tar` missing on Windows (export/import) | Use Git Bash, WSL, or install Windows-native `tar`. |
