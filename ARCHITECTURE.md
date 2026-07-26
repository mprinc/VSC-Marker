Synced with commit: c43b590

# Architecture

## Overview

Marker is a VS Code extension that enhances Markdown editing — smart paste, formatting, living lists (bullet, numbered, roman numeral), tables, headings, and HTML export. It uses a provider-based architecture where possible to avoid blocking system keys on extension host crash.

## Layer Architecture

```
┌─────────────────────────────┐
│     VS Code Extension       │  src/extension.ts
│  (Commands, Providers,      │  Registers commands, providers, listeners
│   Listeners)                │
├─────────────────────────────┤
│     Platform Layer          │  src/platform/
│  (VS Code Implementations) │  Implements interfaces using VS Code APIs
├─────────────────────────────┤
│     Core Layer              │  src/core/
│  (Pure Functions)           │  No dependencies, testable in isolation
└─────────────────────────────┘
```

### Core Layer (`src/core/markdown.ts`)

Pure functions with zero dependencies. Tested via vitest (~194 tests).

Key function groups:

| Group | Functions | Purpose |
|---|---|---|
| **Links/Images** | `wrapWithLink`, `wrapWithImage`, `isUrl`, `isFilePath`, `shouldPasteAsLink`, `filePathToMarkdownUrl` | Link/image markdown generation |
| **List parsing** | `parseListPrefix`, `emptyListItemAction`, `computeOutdentPrefix`, `adaptMarkerForLevel` | Parse bullet/number/roman prefixes, decide outdent vs delete, adapt marker type |
| **List numbering** | `getNextNumber`, `buildNextLinePrefix`, `findListBounds`, `renumberList` | Continue lists, renumber blocks |
| **Roman numerals** | `romanToInt`, `intToRoman` | Convert between integer and roman numeral strings |
| **Formatting** | `toggleWrap`, `toggleHtmlWrap`, `findWrapperAround`, `findHtmlWrapperAround`, `toggleCodeSpan`, `toggleCodeBlock` | Bold, italic, underline, strikethrough, code |
| **Headings** | `getHeadingLevel`, `setHeadingLevel` | Heading level cascade |
| **Tables** | `detectDelimiter`, `parseTextAsTable`, `generateMarkdownTable` | Table creation/conversion |

### Platform Layer (`src/platform/`)

Interfaces (`interfaces.ts`) + VS Code implementations (`vscode-platform.ts`):
- `ClipboardService` — text + binary image reading
- `EditorService` — selection, replace, file path
- `FileSystemService` — write file, check existence
- `NotificationService` — info/error messages

### Extension Entry Point (`src/extension.ts`)

Registers 18 commands, 1 paste provider, 1 text change listener, language configuration.

## Key Binding Safety Architecture

System keys (Enter, Cmd+V, Tab) use a configurable binding mode (`marker.bindings.keys.*.mode`):

| Mode | Mechanism | Crash-safe |
|---|---|---|
| `provider` (default for Enter, Paste) | `DocumentPasteEditProvider` / `onEnterRules` + listener | Yes — provider skipped when host dead |
| `keybinding-override` | Keybinding → extension command | No — key blocked if host crashes |
| `tab-override` (default for Tab) | Keybinding → command + VS Code indent first | No — same as keybinding-override |
| `auto-listener` (Tab only) | Native Tab + listener auto-renumbers | Yes |
| `manual` | No override — Command Palette only | Yes |

Recovery: set `marker.enabled: false` in VS Code settings → all keybindings deactivate.

### Provider APIs used

| Key | Provider | Fallback |
|---|---|---|
| **Cmd+V** | `DocumentPasteEditProvider` with kind `text.marker.smartPaste` | Default paste (provider returns undefined) |
| **Enter** | `onEnterRules` in `language-configuration.json` + `onDidChangeTextDocument` listener | Native Enter (rules require `.+` content) |
| **Tab** | `editor.action.indentLines` + post-process renumber | Native indent (command runs first) |

## List Intelligence

### Supported types
- Bullet: `-`, `+`, `*`
- Numbered: `1.`, `2.`, ...
- Roman numeral: `(i)`, `(ii)`, `(III)`, ...

### Progressive outdent (Enter on empty item)
1. Indented empty item → outdent one level, adapt marker to parent list type
2. Root-level empty item → delete prefix entirely (exit list)
3. Split-line safety: if cursor line has content after split, never delete

### Marker type adaptation
On indent/outdent (Tab/Shift+Tab or Enter outdent), the marker adapts to match siblings at the target indent level:
- `3.` outdented into bullet context → `-`
- `-` indented into numbered context → `4.`
- `(iii)` outdented into numbered context → `4.`

## Data Flow

### Smart Paste (provider mode)

```
1. User pastes (Cmd+V)
2. VS Code calls DocumentPasteEditProvider
3. Provider reads dataTransfer (text/plain or image/png)
4. URL detected → wraps selection as [text](url)
   Image detected → saves file, inserts ![alt](file.png)
   Neither → returns undefined (default paste)
5. editor.pasteAs.preferences auto-applies without widget
```

### Enter continuation (provider mode)

```
1. User presses Enter on "3. item text"
2. onEnterRule matches → appends "1. " on new line
3. Listener fires (400ms debounce) → renumberSurroundingList → "1." becomes "4."
4. If Enter on empty "3. " → rule doesn't match → native Enter →
   listener detects empty prefix → progressive outdent or delete
```

## Clipboard Image Reading

VS Code's clipboard API only supports text. For binary image data:

| Platform | Method |
|---|---|
| **macOS** | AppleScript via `osascript` — reads `NSPasteboard` PNG/TIFF |
| **Linux** | `xclip -selection clipboard -t image/png` |
| **Windows** | PowerShell `System.Windows.Forms.Clipboard::GetImage()` |

## External Dependencies

| Dependency | Purpose |
|---|---|
| `@types/vscode` | VS Code API type definitions |
| `esbuild` | Bundler |
| `typescript` | Compiler |
| `vitest` | Test runner |
