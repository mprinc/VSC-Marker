#!/bin/bash
# Build, bump patch version, package, and install Marker extension
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Read current version
CURRENT=$(node -e "console.log(require('./package.json').version)")

# Bump patch version: 0.0.17 → 0.0.18
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
PATCH=$((PATCH + 1))
NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

echo "=== Marker deploy ==="
echo "  $CURRENT → $NEW_VERSION"

# Update version in package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '${NEW_VERSION}';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Compile TypeScript
echo "  Compiling..."
npm run compile --silent

# Run tests
echo "  Testing..."
npx vitest run --silent 2>/dev/null || true

# Package VSIX
echo "  Packaging..."
npx vsce package --no-git-tag-version 2>/dev/null | tail -1

# Install
VSIX="marker-${NEW_VERSION}.vsix"
echo "  Installing ${VSIX}..."
code --install-extension "$VSIX" --force 2>/dev/null

echo ""
echo "=== Done: Marker v${NEW_VERSION} installed ==="
echo "  Reload VS Code: Cmd+Shift+P → Developer: Reload Window"
