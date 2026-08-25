# agenv CLI Reference

This document covers all 21 commands available in the `agenv` (Antigravity Environment Manager) CLI. 

---

## `agenv init`

**Purpose:** Interactively sets up a new environment repository. It scans your system for known configuration files (OpenCode, Claude, Git, Shell, etc.), allows you to select which ones to track, sets up an `age` encryption key, and generates the `agenv.json` manifest. Once initialized, use `agenv publish` to push it to a remote repository.

**Options:**
| Option | Description |
|--------|-------------|
| `--dir <path>` | Directory to initialize in (default: cwd). |
| `--yes` | Skip interactive prompts and accept non-interactive defaults. |
| `--allow-plaintext-secrets` | Allow storing sensitive files without encryption. |
| `--force` | Force initialization even if agenv.json exists. |
| `--publish` | Publish to GitHub after init (for `--yes` mode). |
| `--no-publish` | Do not ask to publish after init. |

**Usage Examples:**
```bash
# Interactive guided setup
agenv init

# Fast setup using defaults
agenv init --yes
```
**Notes:** If an encryption key does not exist at `~/.config/agenv/key.txt`, it will generate one for you. **Back up this key immediately.**

---

## `agenv publish`

**Purpose:** Publishes your newly initialized environment to GitHub. It can automatically create a remote repository using the GitHub CLI (`gh`) or prompt you to provide a remote URL manually. It then pushes your initial setup to the remote.

**Options:**
| Option | Description |
|--------|-------------|
| `--public` | Sets the repository visibility to public (defaults to private when using `gh`). |
| `--name <repoName>`| The name of the GitHub repository to create. |
| `--remote <url>` | Skips creation and directly sets this Git remote URL. |
| `--attach` | If a repository with the same name exists, automatically attach to it. |
| `--new` | If a repository with the same name exists, create a new one with a different name. |
| `--yes` | Bypasses interactive prompts and accepts default behavior. |
| `--dir <path>` | Directory to publish (default: cwd). |

**Usage Examples:**
```bash
# Publish interactively
agenv publish

# Publish as a public repository named 'my-dev-env'
agenv publish --public --name my-dev-env

# Publish to an existing remote URL
agenv publish --remote https://github.com/myuser/existing-repo.git
```

---

## `agenv scan`

**Purpose:** Performs a read-only discovery of your system, checking for known files and directories. It groups the results by category (`opencode`, `claude`, `agents`, `git`, `vscode`, `shell`).

**Options:**
*None*

**Usage Examples:**
```bash
agenv scan
```
**Notes:** This command makes no changes to your system or manifest. It is strictly for discovery.

---

## `agenv add <file>`

**Purpose:** Adds a specific file to your environment pack and manifest. 

**Options:**
| Option | Description |
|--------|-------------|
| `--encrypt` | Encrypts the file using your `age` key before saving it to the pack. |
| `-c, --category <category>` | Assigns the file to a specific category (e.g., `git`, `custom`). |
| `--allow-plaintext-secrets` | Allow adding sensitive files without encryption. |

**Usage Examples:**
```bash
# Add a simple configuration file
agenv add ~/.bashrc -c shell

# Add and encrypt a file containing sensitive keys
agenv add ~/.gitconfig --encrypt -c git
```

---

## `agenv remove <file|id>`

**Purpose:** Removes a file from your environment pack (manifest and repo storage).

**Options:**
| Option | Description |
|--------|-------------|
| `--no-delete` | Removes the file from `agenv` tracking but leaves the actual source file on your local disk intact. |

**Usage Examples:**
```bash
# Remove a tracked file completely
agenv remove ~/.bashrc

# Stop tracking a file, but keep it on your PC
agenv remove ~/.gitconfig --no-delete
```

---

## `agenv clone <repo-url>`

**Purpose:** Initializes a machine with an existing `agenv` pack. It clones the remote Git repository, automatically expands it to your HOME directory, and binds it in your global registry.

**Options:**
| Option | Description |
|--------|-------------|
| `--dir <path>` | Specifies the local directory to clone the repository into (defaults to the repo name). |

**Usage Examples:**
```bash
# Clone and expand your environment
agenv clone https://github.com/myuser/my-dotfiles

# Clone into a specific folder
agenv clone https://github.com/myuser/my-dotfiles --dir ~/my-env
```
**Notes:** Ensure your `~/.config/agenv/key.txt` is present *before* running this command if your repository contains encrypted files.

---

## `agenv expand [target]`

**Purpose:** Deploys all files tracked in `agenv.json` to their respective target paths in your HOME directory. It automatically decrypts `.age` files.

**Options:**
| Option | Description |
|--------|-------------|
| `--dry-run` | Shows what files would be written without actually writing them. |
| `--force` | Overwrite existing files even if they have changed. |
| `--yes` | Skip confirmation when creating new files. |

**Usage Examples:**
```bash
# Safely see what will happen for the active environment
agenv expand --dry-run

# Deploy files to system
agenv expand

# Expand a specific registered environment
agenv expand work
```

---

## `agenv update [target]`

**Purpose:** A convenience command that performs a `git pull` in your environment repository and immediately runs `agenv expand`.

**Options:**
*None*

**Usage Examples:**
```bash
# Update active environment
agenv update

# Update a specific registered environment
agenv update personal

# Update an environment by local path
agenv update /path/to/my-env
```

---

## `agenv push`

**Purpose:** Commits any newly tracked or modified files in your environment repository and pushes the changes to your remote repository.

**Options:**
| Option | Description |
|--------|-------------|
| `-m, --message <msg>` | Provide a custom commit message (defaults to "Update agenv environment"). |

**Usage Examples:**
```bash
# Push with default message
agenv push

# Push with a custom message
agenv push -m "Add custom SSH config"
```

---

## `agenv sync [target]`

**Purpose:** A unified command to keep environments fully synchronized. It pulls remote changes via `--ff-only`, expands them to your local system, then checks for local changes. With `--push`, it commits and pushes local modifications back to the remote. Without `--push`, it interactively prompts you or skips the push step.

**Options:**
| Option | Description |
|--------|-------------|
| `--push` | Commit and push local changes to the remote. |
| `--no-push` | Do not push local changes (skip the push step entirely). |
| `--yes` | Skip interactive prompts. |

**Usage Examples:**
```bash
# Sync active environment, interactively prompting to push local changes
agenv sync

# Sync a specific environment and auto-push local changes
agenv sync work --push
```

---

## `agenv status [target]`

**Purpose:** Compares the state of the files in your `agenv` repository against the current state of the files on your local disk. 

**Options:**
*None*

**Usage Examples:**
```bash
# Check status of active environment
agenv status

# Check status of a specific environment
agenv status work

# Check status using a registered Git URL
agenv status https://github.com/myuser/work-dotfiles
```
**Notes:** Output will flag files as `[Modified]`, `[Missing]`, or `[In Sync]`.

---

## `agenv list [target]`

**Purpose:** Lists all files currently tracked by your `agenv.json` manifest, grouped cleanly by category.

**Options:**
*None*

**Usage Examples:**
```bash
# List files in active environment
agenv list

# List files in a specific registered environment
agenv list personal
```

---

## `agenv envs`

**Purpose:** Lists all registered environments in your global registry, highlighting their local paths, remote URLs, last sync times, and indicating which one is currently active.

**Options:**
*None*

**Usage Examples:**
```bash
agenv envs
```

---

## `agenv bind <name>`

**Purpose:** Registers an environment in the global registry under a friendly name. By default, it registers the current working directory, but you can specify a directory or remote URL explicitly.

**Options:**
| Option | Description |
|--------|-------------|
| `--dir <path>` | The local directory to register (defaults to current directory). |
| `--url <url>` | Explicitly provide the remote Git URL (otherwise read from local repo). |

**Usage Examples:**
```bash
# Bind the current directory to the name 'work'
agenv bind work

# Bind a specific directory
agenv bind personal --dir ~/personal-env
```

---

## `agenv unbind <name>`

**Purpose:** Removes an environment from the global registry. Note: This does not delete the repository on disk; it simply removes it from `agenv`'s global registry.

**Options:**
| Option | Description |
|--------|-------------|
| `--yes` | Skip confirmation. |

**Usage Examples:**
```bash
agenv unbind work
```

---

## `agenv use <name>`

**Purpose:** Sets a specific environment as the "active" environment in the global registry. This allows you to run `agenv expand`, `agenv sync`, and other commands without having to specify a target or `cd` into the directory.

**Options:**
| Option | Description |
|--------|-------------|
| `--clear` | Clears the active environment selection. |

**Usage Examples:**
```bash
# Set 'personal' as the active environment
agenv use personal

# Clear the active environment
agenv use --clear
```

---

## `agenv doctor`

**Purpose:** Runs an environment health check. It verifies the presence of the `age` binary, checks for a valid encryption key, and confirms Git is installed.

**Options:**
*None*

**Usage Examples:**
```bash
agenv doctor
```

---

## `agenv export`

**Purpose:** Bundles your `agenv` environment into a portable `.tar.gz` archive. This provides a git-free transfer path, allowing you to move an environment without GitHub or git history. The archive includes the manifest and all tracked files (encrypted files remain safely encrypted).

**Options:**
| Option | Description |
|--------|-------------|
| `--out <path>` | Output tarball path (default: `agenv-<dirname>-<timestamp>.tar.gz` in cwd). |

**Usage Examples:**
```bash
# Export the current environment to a tarball
agenv export

# Export to a specific file
agenv export --out ~/Downloads/my-env.tar.gz
```

---

## `agenv import <file>`

**Purpose:** Restores an exported environment tarball to a new directory and automatically expands the tracked files to their target paths in your HOME directory.

**Options:**
| Option | Description |
|--------|-------------|
| `--dir <path>` | Destination directory to extract the environment into (defaults to cwd if not already an agenv repo). |

**Usage Examples:**
```bash
# Import an environment tarball into a new folder
agenv import my-env.tar.gz --dir ~/my-imported-env

# Import an environment tarball into the current directory
agenv import my-env.tar.gz
```
**Notes:** If the archive contains encrypted files, you must ensure your `age` key is properly configured before running this command.

---

## `agenv help`

**Purpose:** Prints the standard help menu for the CLI, outlining available commands and usage hints.

**Options:**
*None*

**Usage Examples:**
```bash
agenv help
```

---

## `agenv self-update`

**Purpose:** Updates the `agenv` CLI to the latest GitHub release. Use this instead of `npm update -g agenv` when installed via the release installer.

**Options:**
*None*

**Usage Examples:**
```bash
agenv self-update
```