# agenv Setup Guide

Welcome to **agenv**! This guide walks you through the standardized workflow for setting up, publishing, and cloning your encrypted developer environment across all your machines.

## Prerequisites

- **Node.js** (>= 18) or **Bun** installed on your system.
- **Git** installed and available in your PATH.
- *(Optional)* **GitHub CLI (`gh`)** for seamless automatic repository creation during publish.
- *(Optional)* **age** encryption tool. (If you don't have it, `agenv` will guide you on how to install it during setup).

---

## Step 1: Install `agenv`

Install the CLI globally so you can run it from anywhere. 

Using npm:
```bash
npm install -g agenv
```

Or using Bun:
```bash
bun install -g agenv
```

Verify the installation:
```bash
agenv --version
```

---

## Step 2: Initialize Your Environment

On your primary machine, start the interactive setup wizard to scan your system and create your environment manifest.

```bash
agenv init
```

**Interactive Walkthrough:**
1. **Scanning**: `agenv` scans your system for discoverable config files (e.g., OpenCode, Claude, Agents, Git, VSCode, Shell).
2. **Selection**: You'll be prompted to select the categories and files you want to track (use Space to select, Enter to confirm).
3. **Encryption Prompt**: The tool will ask if you want to encrypt sensitive files (like `.gitconfig` or credentials). Say **Yes**.
4. **Key Generation**: If an `age` key doesn't exist, it generates one at `~/.config/agenv/key.txt`. **Back this up immediately!**
5. **Generation**: It creates a local Git repository with:
   - `agenv.json` (the tracking manifest)
   - `files/` (copied and optionally encrypted source files)
   - `.gitignore` and `README.md`
   - An initial git commit.

---

## Step 3: Publish to GitHub

Now that your local environment is packed, publish it to a remote repository.

```bash
agenv publish
```

**What happens?**
- **With `gh` CLI**: If you are authenticated with the GitHub CLI, `agenv` will automatically create a private repository on your GitHub account, set the remote, push the initial commit, and print the clone URL.
- **Manual Path**: If `gh` is not installed or authenticated, it will prompt you to create an empty repo manually and paste the URL. It then pushes the code.

*Options you can use:*
- `--public`: Make the remote repository public (safe if secrets are encrypted!).
- `--name <repoName>`: Specify a custom repository name.
- `--remote <url>`: Bypass prompt and use this exact Git remote URL.
- `--yes`: Accept defaults automatically.

**Example Output:**
```text
┌────────────────────────────────────────────────────────┐
│ Environment published!                                 │
│ URL: https://github.com/yourusername/my-env            │
│ Copy it and run on any machine:                        │
│   agenv clone https://github.com/yourusername/my-env   │
└────────────────────────────────────────────────────────┘
```

## No GitHub CLI? No problem

If you do not have the GitHub CLI (`gh`) installed, or if you prefer to host your environment on another platform (like GitLab, Bitbucket, Codeberg, Gitea, or a self-hosted Git server), `agenv` seamlessly falls back to standard Git workflows.

**Interactive Flow:**
When you run `agenv publish` without `gh`, the CLI will prompt you:
1. It attempts to open your browser to `https://github.com/new` (you can navigate to your Git host of choice instead).
2. Create an empty repository there.
3. Paste the clone URL (e.g., `https://github.com/user/repo.git` or `git@github.com:user/repo.git`) into the CLI.
4. `agenv` will handle adding the remote and pushing your initial commit.

**Manual Flow:**
If you already have a repository ready, simply pass the remote URL directly:
```bash
agenv publish --remote git@gitlab.com:user/my-env.git
```

**Note on Credentials:** 
`gh` is only a convenience wrapper for GitHub. When falling back to standard Git pushes over HTTPS, your Git host may require a Personal Access Token (PAT). Alternatively, use an SSH URL (e.g., `git@github.com:...`) to authenticate via your existing SSH keys.

*For GitHub Actions:* Even without `gh` locally, as long as your repository is hosted on GitHub, you can still use the documented GitHub Actions workflows (see `GITHUB-ACTIONS.md`) for CI/CD.

---

## Step 4: Clone Anywhere

When setting up a new machine, VM, or GitHub Action, you only need your Git URL and your encryption key.

1. **Restore your Key**: Ensure your `age` key is placed at `~/.config/agenv/key.txt` on the new machine.
2. **Clone & Expand**:
   ```bash
   agenv clone https://github.com/yourusername/my-env
   ```

**Under the hood:**
- `agenv` clones the repository.
- It checks for the `age` key at `~/.config/agenv/key.txt`.
- It decrypts any `.age` files in the repository.
- It automatically runs `agenv expand`, copying tracked files to their target locations in your HOME directory.

---

## Step 5: Keeping Environments in Sync

Keep your environments in sync across multiple machines with a simple set of commands.

- **Local changes only**: If you've modified or added files locally, push them back to your repository:
  ```bash
  agenv push -m "Update git aliases"
  ```
- **Remote changes only**: If you've pushed changes from another machine, pull and expand them on your current machine:
  ```bash
  agenv update
  ```
- **Both (Unified Sync)**: To pull remote changes, expand them, and automatically commit and push any local changes in one step, use `sync`:
  ```bash
  agenv sync [name] [--push]
  ```
  *(Without `--push`, the CLI will prompt you interactively before pushing your local changes).*

**Handling Repo Name Collisions During Publish:**
If you run `agenv publish` and a remote repository with the same name already exists on your GitHub account, the CLI will prompt you:
- **Attach**: Link your local environment to the existing remote repository.
- **New**: Create a new repository with a different name.
You can bypass the prompt using the `--attach` or `--new` flags.

---

## Step 6: Everyday Use

- **Track a new file**: Add a new file to the environment (use `--encrypt` if sensitive):
  ```bash
  agenv add ~/.ssh/config --encrypt
  ```
- **Stop tracking a file**: Remove it from the environment:
  ```bash
  agenv remove ~/.bashrc
  ```
- **Check for drifts**: See what's modified between your machine and your repo:
  ```bash
  agenv status
  ```

---

## Security Notes

- **The Age Key**: Your private `age` key lives at `~/.config/agenv/key.txt`. **Never commit this file to your repository.** Keep it stored in a secure password manager (like 1Password, Bitwarden, etc.).
- **Safe to be Public**: Because `agenv` uses robust X25519 encryption, it is safe to make your dotfiles repository public. Without `key.txt`, attackers cannot read your encrypted `.age` files.

---

## Troubleshooting

| Problem | Cause & Solution |
|---------|------------------|
| **"age command not found"** | Your system lacks the `age` binary. Install it via `brew install age`, `apt install age`, etc. |
| **"Failed to decrypt: key not found"** | You ran `agenv clone` or `expand` but `~/.config/agenv/key.txt` is missing. Restore it from your password manager. |
| **"Not an agenv repository"** | You are running repository commands outside the `agenv` folder. `cd` into the cloned folder first. |
| **"gh command not found"** / **Not authed** | Run `gh auth login` first, or manually create the repo on GitHub and use `agenv publish --remote <url>`. |
| **Push rejected** | There are upstream changes. Run `agenv update` first to merge remote changes. |
| **"Local changes detected" during sync** | `agenv sync` found modifications but `--push` was not specified. Follow the interactive prompt to push, or use `agenv sync --push`. |
| **"URL not in registry"** | You tried to sync a Git URL that hasn't been registered. Run `agenv clone` or `agenv bind` first. |
| **"Active environment missing"** | The CLI doesn't know which environment to use. Run `agenv use <name>` to set one, or `agenv bind` if it's a new folder. |

---

## Getting Updates

Two things can be updated independently:

- **The CLI itself** — `agenv` is a global npm package. Update it with `npm update -g agenv` (or `npm install -g agenv@latest`), and check your version with `agenv --version`.
- **Your environment** — inside an environment repo, run `agenv update` to pull the latest remote changes and automatically re-expand them to your system.