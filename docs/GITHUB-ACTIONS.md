# Deploying `agenv` in GitHub Actions

You can use `agenv` to automatically provision a full AI coding environment (or any configuration bundle) directly inside your CI/CD pipelines via GitHub Actions.

Because `agenv` relies on `age` for secure secret encryption, it is completely safe to keep your environment repository public, while selectively decrypting secrets inside the GitHub Actions runner.

## Prerequisites

1. An initialized `agenv` repository pushed to GitHub.
2. The private `age` key (from `~/.config/agenv/key.txt`) copied from your local machine.
3. A GitHub Repository Secret named `AGE_KEY` containing that private key.

## GitHub Actions Workflow Snippet

Below is a ready-to-paste YAML snippet using `ubuntu-latest`. It demonstrates how to install `bun`, configure the `age` key, and run `agenv expand`.

```yaml
name: Deploy Environment
on: [push]

jobs:
  setup-environment:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install age
        run: sudo apt-get update && sudo apt-get install -y age

      - name: Configure age Encryption Key
        env:
          AGE_KEY: ${{ secrets.AGE_KEY }}
        run: |
          mkdir -p ~/.config/agenv
          printf '%s\n' "$AGE_KEY" > ~/.config/agenv/key.txt
          chmod 600 ~/.config/agenv/key.txt

      - name: Expand Environment
        # Assuming agenv is configured/installed, or running directly via source
        # If your repo is the agenv repo itself:
        run: bun ./src/cli.ts expand

        # Or, if using a globally installed agenv against an external repo:
        # run: npx agenv clone https://github.com/your-username/my-env
```

### How it works:
1. **Secrets:** Your sensitive configuration files (e.g., tokens, private configs) remain encrypted (`.age` extensions) in the repository. The only piece of plaintext required is the `AGE_KEY` stored securely in GitHub Secrets.
2. **Key Placement:** The workflow securely places the secret key exactly where `agenv` expects it (`~/.config/agenv/key.txt`).
3. **Expansion:** `agenv expand` seamlessly detects the `age` binary and the key, automatically decrypting your secure files to their final destinations in the runner's `$HOME` directory.