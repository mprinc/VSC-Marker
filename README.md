# Marker

A VS Code extension for working with Markdown files.

## Commands & Keyboard Shortcuts

All shortcuts are active only in Markdown files.

| Command | Mac | Windows/Linux | Description |
|---------|-----|---------------|-------------|
| Smart Paste | `Cmd+V` | `Ctrl+V` | Auto-detects URL or image in clipboard and pastes accordingly |
| Paste Link | `Cmd+Alt+V` | `Ctrl+Alt+V` | Wraps selected text as `[text](url)` with URL from clipboard |
| Paste Image | `Cmd+Alt+I` | `Ctrl+Alt+I` | Saves clipboard image to file, inserts `![text](file.png)` |
| Bold | `Cmd+B` | `Ctrl+B` | Toggle **bold** |
| Italic | `Cmd+I` | `Ctrl+I` | Toggle *italic* |
| Underline | `Cmd+U` | `Ctrl+U` | Toggle `<u>underline</u>` |
| Strikethrough | `Alt+S` | `Alt+S` | Toggle ~~strikethrough~~ |
| Code Span | `Cmd+E` | `Ctrl+E` | Toggle `` `inline code` `` |
| Code Block | `Cmd+Shift+E` | `Ctrl+Shift+E` | Toggle fenced code block |
| Heading Up | `Cmd+Shift+]` | `Ctrl+Shift+]` | Increase heading level (with cascading sub-headings) |
| Heading Down | `Cmd+Shift+[` | `Ctrl+Shift+[` | Decrease heading level (with cascading sub-headings) |
| Toggle Task | `Alt+C` | `Alt+C` | Toggle `[ ]` / `[x]` checkbox (converts plain bullets too) |
| Indent List | `Tab` | `Tab` | Indent list item |
| Outdent List | `Shift+Tab` | `Shift+Tab` | Outdent list item |
| Create Table | `Cmd+Alt+T` | `Ctrl+Alt+T` | Create empty table or convert selected text to table |
| Preview | `Cmd+Shift+V` | `Ctrl+Shift+V` | Live markdown preview in side panel |
| Export HTML | — | — | Export current file to HTML (via Command Palette) |
| Smart Enter | `Enter` | `Enter` | Auto-continue bullet and numbered lists |

### Smart behaviors

- **No selection**: formatting and paste commands apply to the word under cursor
- **Toggle off**: if cursor is inside an existing wrapper (`**`, `` ` ``, `<u>`, etc.), the command removes it
- **Existing link**: if cursor is inside `[text](url)`, Paste Link updates the URL
- **Empty list item**: pressing Enter on an empty `- ` or `1. ` removes the marker
- **Numbered lists**: auto-numbering supports `auto` mode (detects pattern) and `increment` mode

## Install

### Local install (from .vsix)

```bash
cd VSC-Marker
npm install
npx @vscode/vsce package
code --install-extension marker-0.0.1.vsix
```

After installing, **restart** VS Code or run `Cmd+Shift+P` → `Developer: Reload Window`.

To update: bump `version` in `package.json`, repeat the steps above.

To uninstall: `Cmd+Shift+P` → `Extensions: Uninstall` → search "Marker".

### Development mode

```bash
cd VSC-Marker
npm install
npm run esbuild
code --extensionDevelopmentPath=$(pwd)
```

This opens a new VS Code window (Extension Development Host) with the extension loaded. Alternatively, open the project in VS Code and press `F5`.

### VS Code settings

To prevent VS Code's built-in paste from interfering, add to `settings.json`:

```json
{
  "markdown.editor.filePaste.copyIntoWorkspace": "never",
  "editor.pasteAs.enabled": false
}
```

Here are more info on [config options](./config.json5)

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for details on the layered architecture and VS Code APIs used.
