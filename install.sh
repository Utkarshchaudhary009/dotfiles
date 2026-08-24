#!/usr/bin/env bash
# Install the latest agenv release bundle and put `agenv` on PATH.
# Usage: curl -fsSL https://raw.githubusercontent.com/Utkarshchaudhary009/dotfiles/main/install.sh | bash
set -euo pipefail

REPO="${AGENV_REPO:-Utkarshchaudhary009/dotfiles}"
INSTALL_DIR="${AGENV_INSTALL_DIR:-$HOME/.local/bin}"

if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js >= 18 is required but was not found on PATH." >&2
  exit 1
fi

echo "Fetching latest release of $REPO..."
url=$(curl -fsSL -H 'User-Agent: agenv-installer' \
  "https://api.github.com/repos/$REPO/releases/latest" |
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);const a=(r.assets||[]).find(x=>x.name==='agenv.js');console.log(a?a.browser_download_url:'');})")

if [ -z "$url" ]; then
  echo "error: no agenv.js asset found in the latest release." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
curl -fsSL -H 'User-Agent: agenv-installer' "$url" -o "$INSTALL_DIR/agenv"
chmod +x "$INSTALL_DIR/agenv"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    line="export PATH=\"$INSTALL_DIR:\$PATH\""
    if [ -n "${ZSH_VERSION:-}" ] && [ -f "$HOME/.zshrc" ]; then
      printf '\n%s\n' "$line" >> "$HOME/.zshrc"
      echo "Added $INSTALL_DIR to PATH in ~/.zshrc."
    else
      printf '\n%s\n' "$line" >> "$HOME/.bashrc"
      echo "Added $INSTALL_DIR to PATH in ~/.bashrc."
    fi
    ;;
esac

echo "Installed agenv to $INSTALL_DIR/agenv."
echo "Open a NEW terminal, then run: agenv --version"
