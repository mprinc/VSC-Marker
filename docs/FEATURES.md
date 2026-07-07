- **NON-BLOCKING**: Any feature that is supported by the extension should not block the regular workflow in the VSC editor. For example, most of the VSC extensions can simply block on ENTER key and not let it pass through to the editor. 
- Intelligent lists and sub-lists enumerations# NON-BLOCKING VSC Features

- **NON-BLOCKING**: Any feature that is supported by the extension should not block the regular workflow in the VSC editor. For example, most of the VSC extensions can simply block on ENTER key and not let it pass through to the editor. 

  ┌─────┬───────────┬─────────────────┬───────────────────────────────┬───────────────────────────────────────┐
  │  #  │ Озбиљност │    Тастер(и)    │            Проблем            │               Поправка                │
  ├─────┼───────────┼─────────────────┼───────────────────────────────┼───────────────────────────────────────┤
  │ 8   │ КОРИЈЕН   │ Сви (18)        │ marker.active увијек true чак │ onDidChangeConfiguration listener     │
  │     │           │                 │  и кад marker.enabled=false   │ синхронизује context key              │
  ├─────┼───────────┼─────────────────┼───────────────────────────────┼───────────────────────────────────────┤
  │     │           │                 │ Недостаје                     │                                       │
  │ 9   │ LOW       │ Tab, Shift+Tab  │ !editorTabMovesFocus          │ Додат у when clause                   │
  │     │           │                 │ (accessibility)               │                                       │
  ├─────┼───────────┼─────────────────┼───────────────────────────────┼───────────────────────────────────────┤
  │ 2   │ HIGH      │ Enter           │ enterBusy guard тихо гута     │ Fallback на defaultNewline()          │
  │     │           │                 │ keypress                      │                                       │
  ├─────┼───────────┼─────────────────┼───────────────────────────────┼───────────────────────────────────────┤
  │ 3   │ HIGH      │ Cmd+V           │ pasteBusy guard тихо гута     │ Fallback на clipboardPasteAction      │
  │     │           │                 │ keypress                      │                                       │
  ├─────┼───────────┼─────────────────┼───────────────────────────────┼───────────────────────────────────────┤
  │ 1   │ CRITICAL  │ Cmd+V, Enter,   │ safe() хвата грешку без       │ Нови fallbackCmd параметар — при      │
  │     │           │ Tab, Shift+Tab  │ fallback-а                    │ грешци извршава VS Code default       │
  ├─────┼───────────┼─────────────────┼───────────────────────────────┼───────────────────────────────────────┤
  │ 5   │ MEDIUM    │ Cmd+Shift+V     │ Preview disabled гута         │ Fallback на markdown.showPreview      │
  │     │           │                 │ Cmd+Shift+V                   │                                       │
  ├─────┼───────────┼─────────────────┼───────────────────────────────┼───────────────────────────────────────┤
  │ 6   │ MEDIUM    │ Tab, Shift+Tab  │ safe() без fallback-а на      │ safe(indentListCmd,                   │
  │     │           │                 │ indent/outdent                │ 'editor.action.indentLines')          │
  └─────┴───────────┴─────────────────┴───────────────────────────────┴───────────────────────────────────────┘

  Принцип који сада важи

  Ниједан VS Code стандардни тастер не може бити блокиран:
  1. marker.enabled=false → marker.active=false → keybindings уопште не fire-ују
  2. Busy guards → fallback на VS Code default
  3. safe() catch → fallback на VS Code default
  4. Tab/Shift+Tab → VS Code ради indent ПРВО, Marker само ренумерише послије
  5. !editorTabMovesFocus → Tab accessibility режим поштован