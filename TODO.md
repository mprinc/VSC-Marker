Synced with commit: c43b590

https://marketplace.visualstudio.com/items?itemName=yzhang.markdown-all-in-one

Функционалности у односу на All-in-One

  1. Фундаменталне (нужне за свакодневно MD писање)

  | Функционалност | Marker | All-in-One | Статус |
  |---|---|---|---|
  | Bold (Cmd+B) | Yes | Yes | Имамо |
  | Italic (Cmd+I) | Yes | Yes | Имамо |
  | Underline (Cmd+U) | Yes | No | Имамо (боље) |
  | Strikethrough (Alt+S) | Yes | Yes | Имамо |
  | Code span (Cmd+E) | Yes | Yes | Имамо |
  | Code block (Cmd+Shift+E) | Yes | Yes | Имамо |
  | Toggle heading (Cmd+Shift+]/[) | Yes | Yes | Имамо (с каскадом) |
  | Check/uncheck task (Alt+C) | Yes | Yes | Имамо |
  | Paste link преко селекције | Yes | Yes | Имамо |
  | Paste image | Yes | No | Имамо (боље) |
  | Smart Paste (Cmd+V) | Yes | Yes (само линк) | Имамо (боље — и слика, и file path) |
  | Auto-continue листе на Enter | Yes | Yes | Имамо (bullet, numbered, roman) |
  | Preview | Yes | Yes | Имамо |
  | Table креирање/конверзија | Yes | No | Имамо (боље) |
  | Ordered list auto-renumber | Yes | Yes | Имамо |
  | Tab/Shift+Tab indent листе | Yes | Yes | Имамо |
  | Export to HTML | Yes | Yes | Имамо |

  2. Додатне (корисне, али не критичне)

  | Функционалност | Marker | All-in-One |
  |---|---|---|
  | Table of Contents (TOC) генерисање | No | Yes |
  | TOC аутоматски update на save | No | Yes |
  | Section numbering (1., 1.1., 1.1.1.) | No | Yes |
  | Math/KaTeX support ($...$) | No | Yes |
  | Path auto-completion за слике/линкове | No | Yes |
  | Strikethrough/code визуелне декорације | No | Yes |
  | Toggle list marker тип (- / * / + / 1.) | No | Yes |
  | GFM Alerts ([!NOTE], [!WARNING]) | No | Yes |
  | Toolbar action buttons | No | Yes |

  3. Marker-ексклузивне (All-in-One нема)

  | Функционалност | Опис |
  |---|---|
  | Roman numeral lists | `(i)`, `(ii)`, `(III)` — пуна подршка |
  | Progressive outdent | Enter на празном → outdent по нивоима, тек на root → exit |
  | Marker type adaptation | Tab/Shift+Tab аутоматски мијења тип (bullet ↔ numbered ↔ roman) |
  | Split-line safety | Enter у средини текста никад не брише садржај |
  | Crash-safe bindings | provider/keybinding-override/manual модови за Enter, Paste, Tab |
  | File path paste | Paste file path → релативни markdown линк |
  | Workspace-aware paths | Аутоматски relative/absolute на основу workspace |
  | Inverse paste mode | Cmd+Alt+V увијек инвертује path mode |

  Приоритети (предстоји):

  1. Table formatter (поравнање колона) — средње
  2. TOC генерисање — сложеније
  3. Path auto-completion — средње
  4. Math/KaTeX — сложеније
