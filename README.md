<div align="center">

# 🚀 agenv — Antigravity Environment Manager

**Your portable, encrypted AI coding environment manager. Deployable in 2 commands.**

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)](#)
[![npm](https://img.shields.io/badge/npm-package-blue)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](#)

</div>

---

## 🌌 What is agenv?

`agenv` is a user-controlled, encrypted developer environment manager. It allows you to select, pack, encrypt, and deploy your entire AI workspace—including configs, skills, API keys, and aliases—using a portable Git-backed repository with a native CLI. 

Deploy your perfect workspace to a new machine, VM, or GitHub Action instantly:

```bash
agenv clone https://github.com/yourusername/my-env
```

## ✨ Features

- **Interactive Setup:** Automatically scan your system and pick the configs to track (OpenCode, Claude, Git, VSCode, Shell).
- **Secure by Default:** Utilizes `age` (X25519) encryption to keep your secrets and OAuth tokens safe, even in public repositories.
- **Publish Seamlessly:** Create and push to a GitHub repository directly from the CLI via native integrations.
- **Two-Command Deploy:** Bootstrap any new machine simply with `clone` and `expand`.
- **Manifest-Driven:** Clean state tracking with a `agenv.json` file—no hidden symlink spaghetti.
- **Agent-Ready:** Native, pre-configured support for AI platforms (OpenCode, Claude Desktop, and global agents).
- **Extensible:** Easily add custom files, override categories, or script environment hooks.

## 🚀 Quick Start

Get your environment managed and deployed in minutes. *(For the complete walkthrough, see the [Setup Guide](docs/SETUP-GUIDE.md))*

### 1. Initialize
Run `agenv init` to create a new pack, select files, and generate an encryption key.
```bash
agenv init
```

### 2. Publish
Publish your environment to GitHub. If a repository with the same name already exists, you will be prompted to attach to it or create a new one (or use `--attach`/`--new`).
```bash
agenv publish
```

### 3. Clone Anywhere
On your new machine, restore your encryption key, then clone and auto-expand your environment.
```bash
agenv clone https://github.com/<your-gh-user>/<repo-url>
```

### 4. Day 2: Sync Changes
Keep everything in sync. Add new files, push, or sync across machines:
```bash
agenv add ~/.zshrc --encrypt
agenv push
# Or, pull, expand, and push in one go:
agenv sync --push
```

## 🌍 Manage Multiple Environments

`agenv` features a global registry that allows you to manage multiple distinct environments (e.g., work vs. personal) and interact with them from anywhere without changing directories. Learn more in the [Environments Guide](docs/ENVIRONMENTS.md).

## 🔄 Updating

Keep both the CLI and your environment current:

- **Update the CLI** (a global npm package):
  ```bash
  npm update -g agenv
  # or: npm install -g agenv@latest
  ```
- **Check your CLI version:**
  ```bash
  agenv --version
  ```
- **Update your environment** (inside an environment repo — pulls remote changes and re-expands):
  ```bash
  agenv update
  ```
- **Push your local changes back** to the remote:
  ```bash
  agenv push
  ```

## 🤖 Interactive Workflow

`agenv init` is completely interactive, designed to automatically discover environments:

```
> agenv init

🔍 Scanning system for discoverable configs...
Found 12 matching files across 4 categories.

? Select files to add to your environment (Space to select, Enter to confirm):
  ◉ opencode (3 files)
    ✔ ~/.config/opencode/opencode.json
    ✔ ~/.config/opencode/smart-title.jsonc
  ◉ git (1 file)
    ✔ ~/.gitconfig
  ◉ shell (1 file)
    ✔ ~/.bashrc

? The following files may contain secrets. Encrypt them?
  > ~/.gitconfig (git) - Yes

🔑 Generating new age (X25519) encryption key...
   Saved key to: ~/.config/agenv/key.txt
   ⚠️ BACK UP THIS KEY. YOU WILL NOT BE ABLE TO DECRYPT YOUR REPO WITHOUT IT!

✅ Environment initialized in ./my-env with agenv.json manifest.
```

## ⚡ CLI Command Reference

| Command | Description | Options |
|---------|-------------|---------|
| `agenv init` | Interactive setup: scan system, select files, set encryption key, create repo | `--dir <path>`, `--yes`, `--allow-plaintext-secrets`, `--force`, `--publish`, `--no-publish` |
| `agenv publish` | Publish environment to GitHub (creates repo, commits, pushes) | `--public`, `--name <name>`, `--remote <url>`, `--attach`, `--new`, `--yes`, `--dir <path>` |
| `agenv clone` | Initialize a machine with an existing pack (auto-expands and decrypts) | `<url>`, `--dir <path>` |
| `agenv add` | Add a file to the pack | `<file>`, `--encrypt`, `-c <category>`, `--allow-plaintext-secrets` |
| `agenv remove` | Remove a file from the pack | `<file\|id>`, `--no-delete` |
| `agenv scan` | Show discoverable config files grouped by category (no changes made) | |
| `agenv expand` | Deploy all tracked files from the repo to your HOME directory | `--dry-run`, `--force`, `--yes` |
| `agenv update` | Run git pull and automatically run `expand` | |
| `agenv push` | Commit and push changes back to the remote repository | `-m <msg>` |
| `agenv sync` | Pull remote changes, expand, and push local modifications back | `[target]`, `--push`, `--no-push`, `--yes` |
| `agenv export` | Bundle env to portable `.tar.gz` archive (no git needed) | `--out <path>` |
| `agenv import` | Restore an exported environment tarball | `<file>`, `--dir <path>` |
| `agenv status` | Compare repo vs disk state (new/modified/missing) | `[target]` |
| `agenv list` | List all tracked files grouped by category | `[target]` |
| `agenv envs` | List all registered environments | |
| `agenv bind` | Register an environment in the global registry | `<name>`, `--dir <path>`, `--url <url>` |
| `agenv unbind` | Remove an environment from the registry | `<name>`, `--yes` |
| `agenv use` | Set the active environment | `<name>`, `--clear` |
| `agenv doctor` | Run environment and dependency health check | |
| `agenv help` | Display CLI help menu | |

> **Note:** `[target]` can be a registered name, a local path, or a Git URL. It defaults to the active environment or current working directory.
> For deep-dives into each command, see [docs/CLI.md](docs/CLI.md).

## 🔐 Encryption & Security Model

`agenv` natively embeds the [age](https://github.com/FiloSottile/age) encryption engine for modern, fast, and secure file protection.

- **Algorithm:** X25519
- **Key Location:** `~/.config/agenv/key.txt` (This is NEVER added to your repository).
- **Public Key:** The public key is embedded in each encrypted file; the private key at `~/.config/agenv/key.txt` must be present to decrypt.
- **Repository Safety:** Encrypted files end in `.age` and can be safely pushed to public Git repositories. 

*Always back up your `key.txt` to a secure password manager.*

## 🧩 Extending (Adding Custom Categories)

`agenv` automatically categorizes common files. If you have specific files that don't match, you can forcefully assign them a custom category:

```bash
agenv add ~/.ssh/config --encrypt -c custom
agenv add ~/.kube/config -c kubernetes
```

The manifest (`agenv.json`) and repo directory will automatically organize these under `files/custom/` and `files/kubernetes/`.

## 🛠 Troubleshooting

| Problem | Cause / Solution |
|---------|------------------|
| **"age command not found"** | The environment is missing the `age` binary. Run `agenv doctor` to verify your dependencies. |
| **"Failed to decrypt: key not found"** | Your `key.txt` is missing from `~/.config/agenv/key.txt`. Restore it from your password manager backup. |
| **"Not a agenv repository"** | You are running repository commands outside of an initialized directory. `cd` into your environment repo first. |
| **"gh command not found"** | Optional dependency. If missing, `agenv publish` will gracefully fallback to manual URL prompt (see Setup Guide). |

*See the [Setup Guide](docs/SETUP-GUIDE.md) for more troubleshooting tips.*

## 🤝 Contributing / Development

Want to improve `agenv`? Setup is quick:

```bash
# Clone the repository
git clone https://github.com/your-org/dotfiles.git

# Install dependencies via Bun
bun install

# Run the build
bun run build

# Run the CLI from source
node dist/agenv.js --help

# Create npm package locally
npm pack
```

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for more info on the architecture.

## License

MIT