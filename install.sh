#!/bin/bash
# Kiro Chat UI - Installation Script

set -e

echo "=== Kiro Chat UI Installer ==="
echo ""

# Check Node.js — install if missing
if ! command -v node &>/dev/null; then
  echo "⚠ Node.js not found. Installing via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install 20
  echo "✓ Node.js installed: $(node -v)"
else
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -lt 14 ]; then
    echo "❌ Node.js v14+ required (found v$(node -v))"
    exit 1
  fi
  echo "✓ Node.js $(node -v)"
fi

# Check kiro-cli
KIRO_PATH=$(which kiro-cli 2>/dev/null || echo "")
if [ -z "$KIRO_PATH" ]; then
  echo "❌ kiro-cli not found in PATH."
  echo "  Install from https://kiro.dev or set KIRO_CLI path in server.js"
  exit 1
fi
echo "✓ kiro-cli at $KIRO_PATH"

# Update kiro-cli path in server.js if different
CURRENT=$(grep "const KIRO_CLI" server.js | grep -o "'[^']*'" | tr -d "'")
if [ "$KIRO_PATH" != "$CURRENT" ]; then
  sed -i "s|const KIRO_CLI = '.*'|const KIRO_CLI = '$KIRO_PATH'|" server.js
  echo "✓ Updated kiro-cli path to $KIRO_PATH"
fi

# Make scripts executable
chmod +x kiro-chat.sh
echo "✓ Scripts configured"

echo ""
echo "=== Installation complete ==="
echo ""
echo "Start:   ./kiro-chat.sh start"
echo "Open:    http://localhost:3000"
echo "Stop:    ./kiro-chat.sh stop"
echo ""
