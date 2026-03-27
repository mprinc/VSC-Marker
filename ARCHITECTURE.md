# Architecture

## Overview

Marker is a VS Code extension that enhances Markdown editing by providing smart paste operations for links and images.

## Layer Architecture

The extension follows a three-layer architecture to minimize coupling with VS Code APIs:

```
┌─────────────────────────────┐
│     VS Code Extension       │  src/extension.ts
│  (Command Registration)     │  Registers commands, wires layers together
├─────────────────────────────┤
│     Platform Layer          │  src/platform/
│  (VS Code Implementations) │  Implements interfaces using VS Code APIs
├─────────────────────────────┤
│     Core Layer              │  src/core/
│  (Pure Functions)           │  No dependencies, testable in isolation
└─────────────────────────────┘
```

### Core Layer (`src/core/markdown.ts`)

Pure functions with zero dependencies. Can be tested and reused outside VS Code.

| Function | Input | Output | Purpose |
|---|---|---|---|
| `wrapWithLink(text, url)` | `"click here", "https://example.com"` | `"[click here](https://example.com)"` | Create Markdown link |
| `wrapWithImage(alt, path)` | `"photo", "photo.png"` | `"![photo](photo.png)"` | Create Markdown image |
| `isUrl(text)` | `"https://example.com"` | `true` | Validate URL |
| `sanitizeFilename(text)` | `"My Photo!"` | `"my-photo"` | Clean text for filenames |
| `buildImageFilename(alt, ext)` | `"My Photo", "png"` | `"my-photo.png"` | Build image filename from alt text |

### Platform Layer (`src/platform/`)

**Interfaces** (`interfaces.ts`) — platform-agnostic contracts:

```typescript
interface ClipboardService {
  readText(): Promise<string>;        // Read text from clipboard
  readImage(): Promise<Uint8Array | null>;  // Read binary image from clipboard
}

interface EditorService {
  getSelectedText(): string | null;     // Get currently selected text
  replaceSelection(newText: string): Promise<boolean>;  // Replace selection
  getCurrentFilePath(): string | null;  // Get active file path
}

interface FileSystemService {
  writeFile(path: string, data: Uint8Array): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  getDirname(filePath: string): string;
}

interface NotificationService {
  showInfo(message: string): void;
  showError(message: string): void;
}
```

**VS Code Implementation** (`vscode-platform.ts`) — all VS Code API usage is contained here:

- `VscClipboardService` — wraps `vscode.env.clipboard` for text, uses native OS tools for binary image reading
- `VscEditorService` — wraps `vscode.window.activeTextEditor` for text operations
- `VscFileSystemService` — wraps Node.js `fs` module
- `VscNotificationService` — wraps `vscode.window.showInformationMessage/showErrorMessage`

### Extension Entry Point (`src/extension.ts`)

Wires everything together and registers two commands:

- `marker.pasteLink` — reads URL from clipboard, wraps selected text as `[text](url)`
- `marker.pasteImage` — reads image from clipboard, saves as PNG, wraps selected text as `![text](filename.png)`

## Clipboard Image Reading

VS Code's clipboard API (`vscode.env.clipboard`) only supports text. For binary image data, the extension uses native OS commands:

| Platform | Method |
|---|---|
| **macOS** | AppleScript via `osascript` — accesses `NSPasteboard` to read PNG/TIFF data |
| **Linux** | `xclip -selection clipboard -t image/png` |
| **Windows** | PowerShell `System.Windows.Forms.Clipboard::GetImage()` |

The image is written to a temp file, read into a `Uint8Array`, then the temp file is deleted.

## Data Flow

### Paste Link

```
1. User selects text in Markdown file
2. User copies a URL to clipboard
3. User triggers "Marker: Paste Link" (Cmd+Alt+V)
4. Extension reads clipboard text → validates it's a URL
5. Extension reads selected text
6. Core function: wrapWithLink(selectedText, url) → "[text](url)"
7. Selection is replaced with the Markdown link
```

### Paste Image

```
1. User selects text in Markdown file (will be used as alt text + filename)
2. User copies an image to clipboard (e.g., screenshot)
3. User triggers "Marker: Paste Image" (Cmd+Alt+I)
4. Extension reads clipboard image data (binary PNG)
5. Extension reads selected text → sanitizes for filename
6. Extension saves image as "selected-text.png" in the same folder as the .md file
7. Core function: wrapWithImage(altText, filename) → "![text](filename.png)"
8. Selection is replaced with the Markdown image reference
```

## External Dependencies

| Dependency | Purpose | Link |
|---|---|---|
| `@types/vscode` | VS Code API type definitions | https://www.npmjs.com/package/@types/vscode |
| `esbuild` | Fast bundler for the extension | https://esbuild.github.io/ |
| `typescript` | TypeScript compiler | https://www.typescriptlang.org/ |

## Key VS Code APIs Used

| API | Documentation | Purpose |
|---|---|---|
| `vscode.commands.registerCommand` | [Commands API](https://code.visualstudio.com/api/references/vscode-api#commands) | Register extension commands |
| `vscode.env.clipboard.readText` | [Env API](https://code.visualstudio.com/api/references/vscode-api#env) | Read text from clipboard |
| `vscode.window.activeTextEditor` | [Window API](https://code.visualstudio.com/api/references/vscode-api#window) | Access the active editor |
| `TextEditor.edit` | [TextEditor API](https://code.visualstudio.com/api/references/vscode-api#TextEditor) | Modify document content |
| `TextEditor.selection` | [Selection API](https://code.visualstudio.com/api/references/vscode-api#Selection) | Get/set text selection |

## Keybindings

| Command | Windows/Linux | macOS | Context |
|---|---|---|---|
| Paste Link | `Ctrl+Alt+V` | `Cmd+Alt+V` | Markdown files only |
| Paste Image | `Ctrl+Alt+I` | `Cmd+Alt+I` | Markdown files only |
