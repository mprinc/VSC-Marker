#!/bin/bash
# Install the latest (numerically highest) version of the Marker extension

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Find the latest .vsix file by version number
LATEST=$(ls "$SCRIPT_DIR"/marker-*.vsix 2>/dev/null | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)

if [ -z "$LATEST" ]; then
  echo "No .vsix files found in $SCRIPT_DIR"
  exit 1
fi

VERSION=$(basename "$LATEST" | sed 's/marker-\(.*\)\.vsix/\1/')
echo "Installing Marker v${VERSION}..."

# Remove old versions
# rm -rf ~/.vscode/extensions/mprinc.marker-*

# Install
code --install-extension "$LATEST" --force

if [ $? -eq 0 ]; then
  echo "Installed successfully. Reload VS Code (Cmd+Shift+P → Developer: Reload Window)"
else
  echo "Installation failed. Make sure VS Code is fully closed (Cmd+Q) and try again."
  exit 1
fi
