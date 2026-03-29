# Marker

A VS Code extension for working with Markdown files.

To switch off the default VS Code behavior of copying files (like images) into the workspace when pasting, add the following setting to your `settings.json`:

"markdown.editor.filePaste.copyIntoWorkspace": "never",


## Features

### Paste Link (`Cmd+Alt+V` / `Ctrl+Alt+V`)

1. Select text in a Markdown file
2. Copy a URL to clipboard
3. Run the command — selected text becomes `[selected text](url)`

### Paste Image (`Cmd+Alt+I` / `Ctrl+Alt+I`)

1. Select text in a Markdown file (used as alt text and filename)
2. Copy an image to clipboard (e.g., take a screenshot)
3. Run the command — image is saved as `selected-text.png` in the same folder, and the selected text becomes `![selected text](selected-text.png)`

## Installation

### From source

```bash
git clone <repo-url>
cd VSC-Marker
npm install
npm run esbuild
```

Then press `F5` in VS Code to launch the Extension Development Host.

### From .vsix

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension marker-0.0.1.vsix
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for details on the layered architecture and VS Code APIs used.
