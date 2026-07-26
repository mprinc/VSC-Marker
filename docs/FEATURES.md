Synced with commit: c43b590

# Features

## Core principles

- **NON-BLOCKING**: No Marker feature should block regular VS Code workflow. If the extension host crashes, system keys (Enter, Cmd+V, Tab) must continue working.

## Intelligent lists

- Bullet (`-`, `+`, `*`), numbered (`1.`, `2.`), roman numeral (`(i)`, `(ii)`, `(III)`)
- Enter continuation with auto-renumbering
- Progressive outdent: Enter on empty nested item → outdent; at root → exit list
- Marker type adaptation on indent/outdent (e.g. `3.` ↔ `-` ↔ `(iii)`)
- Split-line safety: Enter in middle of text never deletes content

## Safety architecture

Key binding modes (`marker.bindings.keys.*.mode`):

| Key | Default mode | Mechanism | Crash-safe |
|---|---|---|---|
| Enter | `provider` | `onEnterRules` + listener | Yes |
| Cmd+V | `provider` | `DocumentPasteEditProvider` | Yes |
| Tab | `tab-override` | Keybinding → command | No (set `auto-listener` for crash-safe) |

Recovery: `marker.enabled: false` → all keybindings deactivate immediately.

### Safety audit (historical fixes)

| # | Severity | Key(s) | Problem | Fix |
|---|---|---|---|---|
| 1 | CRITICAL | Cmd+V, Enter, Tab | `safe()` catches error without fallback | `fallbackCmd` parameter — executes VS Code default on error |
| 2 | HIGH | Enter | `enterBusy` guard silently swallows keypress | Fallback to `defaultNewline()` |
| 3 | HIGH | Cmd+V | `pasteBusy` guard silently swallows keypress | Fallback to `clipboardPasteAction` |
| 5 | MEDIUM | Cmd+Shift+V | Preview disabled swallows shortcut | Fallback to `markdown.showPreview` |
| 6 | MEDIUM | Tab, Shift+Tab | `safe()` without indent fallback | `safe(cmd, 'editor.action.indentLines')` |
| 8 | ROOT | All (18) | `marker.active` stale after crash | Replaced with `config.marker.enabled` in when clauses |
| 9 | LOW | Tab, Shift+Tab | Missing `!editorTabMovesFocus` | Added to when clause |

### Current safety principles

1. `config.marker.enabled` in when clauses — user-controllable, persistent setting
2. Provider APIs (DocumentPasteEditProvider, onEnterRules) — skipped when host is dead
3. Busy guards → fallback to VS Code defaults
4. `safe()` catch → fallback to VS Code defaults
5. Tab/Shift+Tab → VS Code does indent FIRST, Marker only renumbers after
6. `!editorTabMovesFocus` → Tab accessibility mode respected
