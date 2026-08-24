# Environment Variables

These environment variables must be set manually on new machines.
They contain API keys and cannot be stored in the chezmoi source.

## Required Variables

| Variable | Description | How to Get |
|----------|-------------|------------|
| ANTHROPIC_API_KEY | Anthropic/Claude API key | https://console.anthropic.com/ |
| CODEX_API_KEY | Codex API key | OpenCode settings |
| CONTEXT7_API_KEY | Context7 API key | Context7 dashboard |

## Setting on Windows (PowerShell)

```powershell
[System.Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "sk-ant-...", "User")
[System.Environment]::SetEnvironmentVariable("CODEX_API_KEY", "...", "User")
[System.Environment]::SetEnvironmentVariable("CONTEXT7_API_KEY", "...", "User")
```

## Setting on Linux/macOS

```bash
# Add to ~/.bashrc or ~/.zshrc:
export ANTHROPIC_API_KEY="sk-ant-..."
export CODEX_API_KEY="..."
export CONTEXT7_API_KEY="..."
```

## Setting in GitHub Actions

Add these as repository secrets:
1. Go to Settings > Secrets and variables > Actions
2. Add each variable as a repository secret
3. Reference in workflow: `${{ secrets.ANTHROPIC_API_KEY }}`
