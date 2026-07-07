import * as vscode from 'vscode';
import * as path from 'path';
import {
  wrapWithLink, wrapWithImage, isUrl, isFilePath, shouldPasteAsLink, shouldUseRelativePath, RelativePathMode, filePathToMarkdownUrl, buildImageFilename,
  parseListPrefix, buildNextLinePrefix, NumberedListMode,
  toggleWrap, toggleHtmlWrap, findWrapperAround, findHtmlWrapperAround,
  findLinkAround,
  analyzeText, generateMarkdownTable, getDelimiterLabel,
  Delimiter, parseTextAsTable,
  toggleCodeSpan, toggleCodeBlock,
  getHeadingLevel, setHeadingLevel,
  toggleTaskCheck,
  findListBounds, renumberList
} from './core/markdown';
import { showPreview } from './preview/markdown-preview';
import {
  VscClipboardService,
  VscEditorService,
  VscFileSystemService,
  VscNotificationService
} from './platform/vscode-platform';

const clipboard = new VscClipboardService();
const editor = new VscEditorService();
const fileSystem = new VscFileSystemService();
const notify = new VscNotificationService();

// Re-entrancy guards to prevent recursive command execution
let enterBusy = false;
let pasteBusy = false;

/**
 * Get text and selection for paste operations.
 * If text is selected → use selection.
 * If cursor is inside an existing link/image → return that range for replacement.
 * If no selection → select word under cursor.
 */
function getPasteSelection(vscEditor: vscode.TextEditor): {
  text: string;
  selection: vscode.Selection;
  existingLink: ReturnType<typeof findLinkAround>;
} | null {
  const doc = vscEditor.document;
  const selection = vscEditor.selection;

  if (!selection.isEmpty) {
    return {
      text: doc.getText(selection),
      selection,
      existingLink: null,
    };
  }

  const pos = selection.active;
  const lineText = doc.lineAt(pos.line).text;

  // Check if cursor is inside an existing link/image
  const link = findLinkAround(lineText, pos.character);
  if (link) {
    const sel = new vscode.Selection(
      new vscode.Position(pos.line, link.start),
      new vscode.Position(pos.line, link.end)
    );
    return { text: link.text, selection: sel, existingLink: link };
  }

  // Select word under cursor
  const wordRange = doc.getWordRangeAtPosition(pos);
  if (wordRange) {
    return {
      text: doc.getText(wordRange),
      selection: new vscode.Selection(wordRange.start, wordRange.end),
      existingLink: null,
    };
  }

  return null;
}

async function pasteLink(invertRelative: boolean = false): Promise<boolean> {
  if (!isEnabled()) { return false; }
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) { return false; }

  const clipboardText = await clipboard.readText();
  if (!clipboardText) { return false; }

  const trimmed = clipboardText.trim();
  let url: string;
  if (isUrl(trimmed)) {
    url = trimmed;
  } else if (isFilePath(trimmed)) {
    const mode = getConfig<RelativePathMode>('pasteLink.relativePaths', 'auto');
    const inWorkspace = isInWorkspace(trimmed);
    const useRelative = shouldUseRelativePath(mode, invertRelative, inWorkspace);
    if (useRelative) {
      const currentFile = editor.getCurrentFilePath();
      url = filePathToMarkdownUrl(toRelativePath(trimmed, currentFile));
    } else {
      url = filePathToMarkdownUrl(trimmed);
    }
  } else {
    return false;
  }
  const info = getPasteSelection(vscEditor);

  if (!info) {
    // No selection, no word under cursor — insert bare URL at cursor
    const pos = vscEditor.selection.active;
    await vscEditor.edit(eb => eb.insert(pos, url));
    return true;
  }

  if (info.existingLink) {
    const cursorCol = vscEditor.selection.active.character;
    if (cursorCol >= info.existingLink.textStart && cursorCol <= info.existingLink.textEnd) {
      // Cursor inside link's display text — insert URL as plain text at cursor
      const pos = vscEditor.selection.active;
      await vscEditor.edit(eb => eb.insert(pos, url));
    } else {
      // Cursor inside link's URL part — update the URL
      const updated = info.existingLink.isImage
        ? wrapWithImage(info.existingLink.text, url)
        : wrapWithLink(info.existingLink.text, url);
      await vscEditor.edit(eb => eb.replace(info.selection, updated));
    }
  } else {
    const markdownLink = wrapWithLink(info.text, url);
    await vscEditor.edit(eb => eb.replace(info.selection, markdownLink));
  }
  return true;
}

async function smartPaste(): Promise<void> {
  if (pasteBusy) { await vscode.commands.executeCommand('editor.action.clipboardPasteAction'); return; }
  pasteBusy = true;
  try {
    if (!isEnabled() || !getConfig<boolean>('override.paste', true)) {
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
      return;
    }

    const vscEditor = vscode.window.activeTextEditor;
    if (!vscEditor) {
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
      return;
    }

    // Read clipboard text once (avoid double read)
    const clipboardText = await clipboard.readText();

    // Check if we have text (selected or word under cursor) for link/image wrapping
    const info = getPasteSelection(vscEditor);

    if (info) {
      // Text available + URL or file path in clipboard → paste as link
      const trimmed = clipboardText?.trim() ?? '';
      if (getConfig<boolean>('pasteLink.enabled', true) &&
          shouldPasteAsLink(trimmed, !vscEditor.selection.isEmpty)) {
        if (await pasteLink()) { return; }
      }
    }

    // Image in clipboard → paste as image (works with or without selection)
    if (getConfig<boolean>('pasteImage.enabled', true) && !clipboardText) {
      if (await pasteImage()) { return; }
    }

    // Fallback: default paste
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
  } finally {
    pasteBusy = false;
  }
}

async function pasteImage(): Promise<boolean> {
  if (!isEnabled()) { return false; }
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) { return false; }

  const currentFile = editor.getCurrentFilePath();
  if (!currentFile) { return false; }

  const imageData = await clipboard.readImage();
  if (!imageData) { return false; }

  const dir = fileSystem.getDirname(currentFile);
  const info = getPasteSelection(vscEditor);

  let altText: string;
  let finalFilename: string;

  if (info) {
    // Has selection/word — use it as alt text and filename
    altText = info.text;
    const filename = buildImageFilename(altText, 'png');
    let finalPath = path.join(dir, filename);
    finalFilename = filename;
    let counter = 1;
    while (await fileSystem.fileExists(finalPath)) {
      const nameWithoutExt = filename.replace(/\.png$/, '');
      finalFilename = `${nameWithoutExt}-${counter}.png`;
      finalPath = path.join(dir, finalFilename);
      counter++;
    }
  } else {
    // No selection — generate auto name from pattern
    const pattern = getConfig<string>('pasteImage.autoName', 'image-DDD');
    const result = await findNextAutoFilename(dir, pattern, 'png');
    finalFilename = result.filename;
    altText = result.altText;
  }

  const finalPath = path.join(dir, finalFilename);
  await fileSystem.writeFile(finalPath, imageData);

  const markdownImage = wrapWithImage(altText, finalFilename);
  const insertAt = info ? info.selection : new vscode.Selection(vscEditor.selection.active, vscEditor.selection.active);
  await vscEditor.edit(eb => eb.replace(insertAt, markdownImage));
  notify.showInfo(`Image saved as ${finalFilename}`);
  return true;
}

/**
 * Find the next available auto-generated filename.
 * Pattern uses D for digit placeholders: "image-DDD" → image-001, image-002, ...
 * Returns { filename, altText }.
 */
async function findNextAutoFilename(
  dir: string, pattern: string, ext: string
): Promise<{ filename: string; altText: string }> {
  // Count D's to determine zero-padding width
  const dMatch = pattern.match(/D+/);
  const padWidth = dMatch ? dMatch[0].length : 3;
  const prefix = pattern.replace(/D+/, '');

  for (let n = 1; n < 10000; n++) {
    const numStr = String(n).padStart(padWidth, '0');
    const name = pattern.replace(/D+/, numStr);
    const filename = `${name}.${ext}`;
    const fullPath = path.join(dir, filename);
    if (!(await fileSystem.fileExists(fullPath))) {
      return { filename, altText: `${prefix}${numStr}` };
    }
  }
  // Fallback
  const ts = Date.now();
  return { filename: `${prefix}${ts}.${ext}`, altText: `${prefix}${ts}` };
}

function getConfig<T>(key: string, defaultValue: T): T {
  return vscode.workspace.getConfiguration('marker').get<T>(key, defaultValue);
}

/** Check if Marker is globally enabled */
function isEnabled(): boolean {
  return getConfig<boolean>('enabled', true);
}

/**
 * Check if a file path is inside any of the current VS Code workspace folders.
 */
function isInWorkspace(filePath: string): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return false; }

  let resolved = filePath;
  // Expand ~/
  if (resolved.startsWith('~/') || resolved === '~') {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (home) { resolved = path.join(home, resolved.slice(1)); }
  }

  // Normalize for comparison
  resolved = path.resolve(resolved);

  for (const folder of folders) {
    const root = folder.uri.fsPath;
    if (resolved.startsWith(root + path.sep) || resolved === root) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve a file path to be relative to the current file's directory.
 * Relative paths always work for CMD+click in VS Code, regardless of workspace.
 * Falls back to original path if current file is unsaved or paths are on different drives.
 */
function toRelativePath(targetPath: string, currentFilePath: string | null): string {
  if (!currentFilePath) { return targetPath; }

  let resolved = targetPath;

  // Expand ~/
  if (resolved.startsWith('~/') || resolved === '~') {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (home) { resolved = path.join(home, resolved.slice(1)); }
  }

  // Only relativize absolute paths
  if (!path.isAbsolute(resolved)) { return resolved; }

  const currentDir = path.dirname(currentFilePath);
  const relative = path.relative(currentDir, resolved);

  // If still absolute (Windows: different drives), return original
  if (path.isAbsolute(relative)) { return resolved; }

  // Normalize to forward slashes for markdown
  return relative.replace(/\\/g, '/');
}

async function onEnter(): Promise<void> {
  if (enterBusy) { await defaultNewline(vscode.window.activeTextEditor); return; }
  enterBusy = true;
  try {
    const vscEditor = vscode.window.activeTextEditor;
    if (!vscEditor || !isEnabled() || !getConfig<boolean>('override.enter', true)) {
      await defaultNewline(vscEditor);
      return;
    }

    const doc = vscEditor.document;
    const pos = vscEditor.selection.active;
    const currentLine = doc.lineAt(pos.line).text;
    const current = parseListPrefix(currentLine);

    const bulletEnabled = getConfig<boolean>('autoList.bullet.enabled', true);
    const numberedEnabled = getConfig<boolean>('autoList.numbered.enabled', true);

    const shouldHandle =
      (current.type === 'bullet' && bulletEnabled) ||
      (current.type === 'number' && numberedEnabled);

    if (!shouldHandle) {
      await defaultNewline(vscEditor);
      return;
    }

    // If current item is empty (just marker, no text) → remove marker
    if (current.isEmpty) {
      const lineRange = doc.lineAt(pos.line).range;
      await vscEditor.edit(editBuilder => {
        editBuilder.replace(lineRange, '');
      });
      return;
    }

    // Determine previous number for auto mode (same indent level only)
    let previousNumber: number | null = null;
    if (current.type === 'number') {
      for (let j = pos.line - 1; j >= 0; j--) {
        const prev = parseListPrefix(doc.lineAt(j).text);
        if (prev.indent.length < current.indent.length) { break; }
        if (prev.indent.length === current.indent.length && prev.type === 'number') {
          previousNumber = prev.number!;
          break;
        }
      }
    }

    const numberedMode = getConfig<NumberedListMode>('autoList.numbered.mode', 'auto');
    const prefix = buildNextLinePrefix(current, previousNumber, numberedMode);

    // Split line at cursor: text after cursor moves to new line
    const textAfterCursor = currentLine.substring(pos.character);
    await vscEditor.edit(editBuilder => {
      const rangeAfterCursor = new vscode.Range(pos, new vscode.Position(pos.line, currentLine.length));
      editBuilder.replace(rangeAfterCursor, '\n' + prefix + textAfterCursor);
    });

    const newPos = new vscode.Position(pos.line + 1, prefix.length);
    vscEditor.selection = new vscode.Selection(newPos, newPos);

    // Renumber entire list block after inserting new item
    if (current.type === 'number') {
      await renumberSurroundingList(vscEditor);
      skipNextDebounce = true;
      // Restore cursor (renumber edit may have shifted it)
      vscEditor.selection = new vscode.Selection(newPos, newPos);
    }
  } finally {
    enterBusy = false;
  }
}

/** Insert a plain newline — direct edit, no executeCommand to avoid recursion */
async function defaultNewline(vscEditor: vscode.TextEditor | undefined): Promise<void> {
  if (!vscEditor) { return; }
  const pos = vscEditor.selection.active;
  const line = vscEditor.document.lineAt(pos.line).text;
  // Preserve indentation from current line
  const indentMatch = line.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : '';
  const textAfter = line.substring(pos.character);
  await vscEditor.edit(eb => {
    const range = new vscode.Range(pos, new vscode.Position(pos.line, line.length));
    eb.replace(range, '\n' + indent + textAfter);
  });
  const newPos = new vscode.Position(pos.line + 1, indent.length);
  vscEditor.selection = new vscode.Selection(newPos, newPos);
}

async function createTable(): Promise<void> {
  if (!isEnabled() || !getConfig<boolean>('table.enabled', true)) { return; }
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) { return; }

  const selection = vscEditor.selection;
  const selectedText = selection.isEmpty ? '' : vscEditor.document.getText(selection);

  if (selectedText) {
    // Analyze selected text
    const analysis = analyzeText(selectedText);

    if (analysis.isTable) {
      // Text looks like a table — show report and offer options
      const choice = await vscode.window.showQuickPick([
        {
          label: 'Convert to Markdown table',
          description: `${analysis.cols} cols x ${analysis.rows} rows, delimiter: ${getDelimiterLabel(analysis.delimiter)}, header: ${analysis.hasHeader ? 'yes' : 'no'}`,
          action: 'convert' as const,
        },
        {
          label: 'Customize and convert...',
          description: 'Change delimiter, rows, columns, header',
          action: 'customize' as const,
        },
        {
          label: 'Cancel',
          action: 'cancel' as const,
        },
      ], { title: 'Table detected in selection' });

      if (!choice || choice.action === 'cancel') { return; }

      if (choice.action === 'convert') {
        const table = generateMarkdownTable(analysis.cols, analysis.rows, analysis.hasHeader, analysis.data);
        await vscEditor.edit(eb => eb.replace(selection, table));
        return;
      }

      // 'customize' — fall through to manual flow, pre-filled
      await customizeTableFlow(vscEditor, selection, selectedText, analysis.cols, analysis.rows, analysis.hasHeader, analysis.delimiter);
      return;
    }

    // Text doesn't look like a table — go to manual flow with defaults
    await customizeTableFlow(vscEditor, selection, selectedText, 2, 2, true, 'comma');
    return;
  }

  // No selection — create empty table
  await createEmptyTableFlow(vscEditor);
}

async function customizeTableFlow(
  vscEditor: vscode.TextEditor,
  selection: vscode.Selection,
  text: string,
  defaultCols: number,
  defaultRows: number,
  defaultHeader: boolean,
  defaultDelimiter: Delimiter,
): Promise<void> {
  // Step 1: delimiter
  const delimiterItems = (['tab', 'semicolon', 'comma', 'pipe'] as Delimiter[]).map(d => ({
    label: getDelimiterLabel(d),
    picked: d === defaultDelimiter,
    value: d,
  }));
  const delimPick = await vscode.window.showQuickPick(delimiterItems, {
    title: 'Step 1/3: Column delimiter',
  });
  if (!delimPick) { return; }
  const delimiter = delimPick.value;

  // Re-parse with chosen delimiter
  const data = parseTextAsTable(text, delimiter);
  const detectedCols = data.length > 0 ? Math.max(...data.map(r => r.length)) : defaultCols;
  const detectedRows = data.length;

  // Step 2: columns x rows
  const sizeInput = await vscode.window.showInputBox({
    title: 'Step 2/3: Table size (columns x rows)',
    prompt: 'Format: columns x rows',
    value: `${detectedCols}x${detectedRows}`,
    validateInput: v => /^\d+x\d+$/.test(v.trim()) ? null : 'Format: NxN (e.g. 3x5)',
  });
  if (!sizeInput) { return; }
  const [cols, rows] = sizeInput.trim().split('x').map(Number);

  // Step 3: header
  const headerPick = await vscode.window.showQuickPick([
    { label: 'Yes — first row is header', value: true, picked: defaultHeader },
    { label: 'No — generate header', value: false, picked: !defaultHeader },
  ], { title: 'Step 3/3: First row as header?' });
  if (!headerPick) { return; }

  const table = generateMarkdownTable(cols, headerPick.value ? rows - 1 : rows, headerPick.value, data);
  await vscEditor.edit(eb => eb.replace(selection, table));
}

async function createEmptyTableFlow(vscEditor: vscode.TextEditor): Promise<void> {
  // Step 1: size
  const sizeInput = await vscode.window.showInputBox({
    title: 'Step 1/2: Table size (columns x rows)',
    prompt: 'Format: columns x rows',
    value: '3x3',
    validateInput: v => /^\d+x\d+$/.test(v.trim()) ? null : 'Format: NxN (e.g. 3x5)',
  });
  if (!sizeInput) { return; }
  const [cols, rows] = sizeInput.trim().split('x').map(Number);

  // Step 2: header
  const headerPick = await vscode.window.showQuickPick([
    { label: 'Yes — include header row', value: true },
    { label: 'No — data rows only', value: false },
  ], { title: 'Step 2/2: Include header row?' });
  if (!headerPick) { return; }

  const table = generateMarkdownTable(cols, rows, headerPick.value);
  const pos = vscEditor.selection.active;
  await vscEditor.edit(eb => eb.insert(pos, table));
}

/**
 * Get the effective selection for formatting:
 * 1. If text is selected → use it
 * 2. If cursor inside a wrapper → expand to include the wrapper
 * 3. If no selection → select the word under cursor
 */
function getFormatSelection(
  vscEditor: vscode.TextEditor,
  wrapper: string,
  isHtml: boolean
): vscode.Selection | null {
  const doc = vscEditor.document;
  const selection = vscEditor.selection;

  if (!selection.isEmpty) {
    return selection;
  }

  // No selection — try to find wrapper around cursor, then fall back to word
  const pos = selection.active;
  const lineText = doc.lineAt(pos.line).text;

  const range = isHtml
    ? findHtmlWrapperAround(lineText, pos.character, wrapper)
    : findWrapperAround(lineText, pos.character, wrapper);

  if (range) {
    return new vscode.Selection(
      new vscode.Position(pos.line, range[0]),
      new vscode.Position(pos.line, range[1])
    );
  }

  // No wrapper found — select the word under cursor
  const wordRange = doc.getWordRangeAtPosition(pos);
  if (wordRange) {
    return new vscode.Selection(wordRange.start, wordRange.end);
  }

  return null;
}

async function toggleFormat(wrapper: string, isHtml: boolean = false, configKey?: string): Promise<void> {
  if (!isEnabled()) { return; }
  if (configKey && !getConfig<boolean>(configKey, true)) { return; }
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) { return; }

  const sel = getFormatSelection(vscEditor, wrapper, isHtml);

  if (!sel) {
    // No selection, no word — insert empty wrapper and position cursor inside
    const pos = vscEditor.selection.active;
    let open: string, close: string;
    if (isHtml) {
      open = `<${wrapper}>`;
      close = `</${wrapper}>`;
    } else {
      open = wrapper;
      close = wrapper;
    }
    await vscEditor.edit(eb => eb.insert(pos, open + close));
    const cursorPos = new vscode.Position(pos.line, pos.character + open.length);
    vscEditor.selection = new vscode.Selection(cursorPos, cursorPos);
    return;
  }

  const text = vscEditor.document.getText(sel);
  const result = isHtml ? toggleHtmlWrap(text, wrapper) : toggleWrap(text, wrapper);

  await vscEditor.edit(editBuilder => {
    editBuilder.replace(sel, result);
  });
}

// --- Code span / block ---

async function toggleCodeSpanCmd(): Promise<void> {
  if (!isEnabled() || !getConfig<boolean>('formatting.codeSpan', true)) { return; }
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) { return; }

  const sel = getFormatSelection(vscEditor, '`', false);
  if (!sel) {
    // No selection — insert empty `` and position cursor inside
    const pos = vscEditor.selection.active;
    await vscEditor.edit(eb => eb.insert(pos, '``'));
    const cursorPos = new vscode.Position(pos.line, pos.character + 1);
    vscEditor.selection = new vscode.Selection(cursorPos, cursorPos);
    return;
  }

  const text = vscEditor.document.getText(sel);
  await vscEditor.edit(eb => eb.replace(sel, toggleCodeSpan(text)));
}

async function toggleCodeBlockCmd(): Promise<void> {
  if (!isEnabled() || !getConfig<boolean>('formatting.codeBlock', true)) { return; }
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor || vscEditor.selection.isEmpty) { return; }
  const text = vscEditor.document.getText(vscEditor.selection);
  const lang = getConfig<string>('codeBlock.defaultLanguage', 'sh');
  await vscEditor.edit(eb => eb.replace(vscEditor.selection, toggleCodeBlock(text, lang)));
}

// --- Heading level with cascade ---

async function changeHeadingLevel(direction: 'up' | 'down'): Promise<void> {
  if (!isEnabled() || !getConfig<boolean>('heading.enabled', true)) { return; }
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) { return; }

  const doc = vscEditor.document;
  const cursorLine = vscEditor.selection.active.line;
  const currentLevel = getHeadingLevel(doc.lineAt(cursorLine).text);

  if (currentLevel === 0 && direction === 'up') {
    // Not a heading — make it H1
    await vscEditor.edit(eb => {
      eb.replace(doc.lineAt(cursorLine).range, setHeadingLevel(doc.lineAt(cursorLine).text, 1));
    });
    return;
  }
  if (currentLevel === 0) { return; }

  const newLevel = direction === 'down' ? currentLevel + 1 : currentLevel - 1;
  if (newLevel > 6 || newLevel < 0) { return; }

  const delta = newLevel - currentLevel; // +1 or -1

  // Find sub-headings range: all lines after cursorLine until we hit a heading
  // of same or higher (smaller number) level, or end of document
  const edits: { line: number; newText: string }[] = [];

  // Edit current line
  edits.push({ line: cursorLine, newText: setHeadingLevel(doc.lineAt(cursorLine).text, newLevel) });

  // Edit sub-headings
  for (let i = cursorLine + 1; i < doc.lineCount; i++) {
    const lineText = doc.lineAt(i).text;
    const level = getHeadingLevel(lineText);
    if (level === 0) { continue; } // Skip non-heading lines
    if (level <= currentLevel) { break; } // Hit a peer or higher heading — stop

    const adjusted = level + delta;
    if (adjusted < 1 || adjusted > 6) { continue; } // Can't go beyond bounds
    edits.push({ line: i, newText: setHeadingLevel(lineText, adjusted) });
  }

  await vscEditor.edit(eb => {
    for (const edit of edits) {
      eb.replace(doc.lineAt(edit.line).range, edit.newText);
    }
  });
}

// --- Task list toggle ---

async function toggleTaskCmd(): Promise<void> {
  if (!isEnabled() || !getConfig<boolean>('task.enabled', true)) { return; }
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) { return; }

  const doc = vscEditor.document;
  const line = vscEditor.selection.active.line;
  const lineText = doc.lineAt(line).text;
  const result = toggleTaskCheck(lineText);

  if (result !== lineText) {
    await vscEditor.edit(eb => eb.replace(doc.lineAt(line).range, result));
  }
}

// --- List indent/outdent ---

let renumberBusy = false;
let renumberTimer: ReturnType<typeof setTimeout> | undefined;
let skipNextDebounce = false; // Prevents double-renumber when commands already handled it
let lastRenumberTime = 0;    // Cooldown to prevent ping-pong with other extensions

function getDocLines(doc: vscode.TextDocument): string[] {
  const lines: string[] = [];
  for (let i = 0; i < doc.lineCount; i++) { lines.push(doc.lineAt(i).text); }
  return lines;
}

/**
 * Renumber the entire list block around the cursor.
 * Called as post-processing after VS Code's indent/outdent/enter.
 */
async function renumberSurroundingList(vscEditor: vscode.TextEditor): Promise<void> {
  const doc = vscEditor.document;
  const tabSize = vscEditor.options.tabSize as number || 4;
  const mode = getConfig<NumberedListMode>('autoList.numbered.mode', 'auto');
  const cursorLine = vscEditor.selection.active.line;

  const allLines = getDocLines(doc);
  const [start, end] = findListBounds(allLines, cursorLine);
  const changes = renumberList(allLines, start, end, tabSize, mode);

  if (changes.size > 0) {
    renumberBusy = true;
    try {
      await vscEditor.edit(eb => {
        for (const [lineIdx, newText] of changes) {
          eb.replace(doc.lineAt(lineIdx).range, newText);
        }
      });
      lastRenumberTime = Date.now();
    } finally {
      renumberBusy = false;
    }
  }
}

async function indentListCmd(): Promise<void> {
  const vscEditor = vscode.window.activeTextEditor;

  // ALWAYS let VS Code handle the indent first — never block Tab
  if (!vscEditor || !isEnabled()) {
    await vscode.commands.executeCommand('editor.action.indentLines');
    return;
  }

  // VS Code does the actual indent
  await vscode.commands.executeCommand('editor.action.indentLines');

  // Post-process: renumber entire list block
  await renumberSurroundingList(vscEditor);
  skipNextDebounce = true;
}

async function outdentListCmd(): Promise<void> {
  const vscEditor = vscode.window.activeTextEditor;

  // ALWAYS let VS Code handle the outdent first — never block Shift+Tab
  if (!vscEditor || !isEnabled()) {
    await vscode.commands.executeCommand('editor.action.outdentLines');
    return;
  }

  // VS Code does the actual outdent
  await vscode.commands.executeCommand('editor.action.outdentLines');

  // Post-process: renumber entire list block
  await renumberSurroundingList(vscEditor);
  skipNextDebounce = true;
}

// --- Export to HTML ---

async function exportToHtml(): Promise<void> {
  if (!isEnabled() || !getConfig<boolean>('export.enabled', true)) { return; }
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor || vscEditor.document.languageId !== 'markdown') {
    notify.showError('No active Markdown file.');
    return;
  }

  const doc = vscEditor.document;
  if (doc.isUntitled) {
    notify.showError('Save the file first.');
    return;
  }

  const mdPath = doc.uri.fsPath;
  const defaultHtmlPath = mdPath.replace(/\.md$/i, '.html');

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(defaultHtmlPath),
    filters: { 'HTML': ['html'] },
  });
  if (!saveUri) { return; }

  const MarkdownIt = (await import('markdown-it')).default;
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
  const body = md.render(doc.getText());

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${path.basename(mdPath, '.md')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; line-height: 1.6; padding: 20px 40px; max-width: 900px; margin: 0 auto; color: #333; }
    h1 { border-bottom: 2px solid #ddd; padding-bottom: 0.3em; }
    h2 { border-bottom: 1px solid #ddd; padding-bottom: 0.3em; }
    a { color: #0366d6; }
    code { background: #f6f8fa; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
    pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #dfe2e5; margin: 0; padding: 0 16px; color: #6a737d; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #dfe2e5; padding: 8px 12px; text-align: left; }
    th { background: #f6f8fa; font-weight: 600; }
    img { max-width: 100%; height: auto; }
    ul, ol { padding-left: 2em; }
  </style>
</head>
<body>
${body}
</body>
</html>`;

  await fileSystem.writeFile(saveUri.fsPath, new TextEncoder().encode(html));
  const action = await vscode.window.showInformationMessage(
    `Exported to ${path.basename(saveUri.fsPath)}`,
    'Open'
  );
  if (action === 'Open') {
    const exportedDoc = await vscode.workspace.openTextDocument(saveUri);
    await vscode.window.showTextDocument(exportedDoc, vscode.ViewColumn.Beside);
  }
}

// --- Delete image (text + file) ---

async function deleteImageCmd(): Promise<void> {
  if (!isEnabled()) { return; }
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) { return; }

  const doc = vscEditor.document;
  const pos = vscEditor.selection.active;
  const lineText = doc.lineAt(pos.line).text;

  const link = findLinkAround(lineText, pos.character);
  if (!link || !link.isImage) {
    notify.showError('Cursor is not on an image (place cursor on ![alt](path)).');
    return;
  }

  // Resolve image path relative to current document
  const currentFile = doc.uri.fsPath;
  const dir = path.dirname(currentFile);
  const imageUrl = link.url;

  // Skip external URLs
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://') || imageUrl.startsWith('data:')) {
    // External image — just remove the markdown text
    const range = new vscode.Range(
      new vscode.Position(pos.line, link.start),
      new vscode.Position(pos.line, link.end)
    );
    await vscEditor.edit(eb => eb.delete(range));
    return;
  }

  const imagePath = path.resolve(dir, decodeURIComponent(imageUrl));
  const fileExists = await fileSystem.fileExists(imagePath);

  // Confirm deletion
  const fileName = path.basename(imagePath);
  const message = fileExists
    ? `Delete image "${fileName}" from disk and remove from document?`
    : `Image file "${fileName}" not found on disk. Remove reference from document?`;

  const choice = await vscode.window.showWarningMessage(message, { modal: true }, 'Delete');
  if (choice !== 'Delete') { return; }

  // Delete file from disk
  if (fileExists) {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(imagePath));
    } catch (err) {
      notify.showError(`Failed to delete file: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }

  // Remove markdown text from document
  const range = new vscode.Range(
    new vscode.Position(pos.line, link.start),
    new vscode.Position(pos.line, link.end)
  );
  await vscEditor.edit(eb => eb.delete(range));
  notify.showInfo(fileExists ? `Deleted ${fileName}` : `Removed image reference`);
}

/**
 * Wrap a command handler with error handling.
 * @param fallbackCmd — VS Code default command to execute if handler throws,
 *   so the standard key behavior is never blocked.
 */
function safe(fn: (...args: any[]) => Promise<any>, fallbackCmd?: string): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error('[Marker]', err);
      notify.showError(`Marker error: ${err instanceof Error ? err.message : String(err)}`);
      if (fallbackCmd) {
        try { await vscode.commands.executeCommand(fallbackCmd); } catch { /* best-effort */ }
      }
    }
  };
}

export function activate(context: vscode.ExtensionContext): void {
  // FIRST: clear any stale marker.active from a previous crash.
  // Context keys survive extension host crashes (they live in the renderer),
  // so a stale `true` would let keybindings fire before commands exist.
  vscode.commands.executeCommand('setContext', 'marker.active', false);

  try {
    context.subscriptions.push(
      vscode.commands.registerCommand('marker.pasteLink', safe(() => pasteLink(true))),
      vscode.commands.registerCommand('marker.pasteImage', safe(pasteImage)),
      vscode.commands.registerCommand('marker.smartPaste', safe(smartPaste, 'editor.action.clipboardPasteAction')),
      vscode.commands.registerCommand('marker.onEnter', safe(onEnter, 'type', /* Enter fallback */)),
      vscode.commands.registerCommand('marker.showPreview', safe(async () => {
        if (!isEnabled() || !getConfig<boolean>('preview.enabled', true)) {
          await vscode.commands.executeCommand('markdown.showPreview');
          return;
        }
        showPreview(context);
      }, 'markdown.showPreview')),
      vscode.commands.registerCommand('marker.toggleBold', safe(() => toggleFormat('**', false, 'formatting.bold'))),
      vscode.commands.registerCommand('marker.toggleItalic', safe(() => toggleFormat('*', false, 'formatting.italic'))),
      vscode.commands.registerCommand('marker.toggleUnderline', safe(() => toggleFormat('u', true, 'formatting.underline'))),
      vscode.commands.registerCommand('marker.toggleStrikethrough', safe(() => toggleFormat('~~', false, 'formatting.strikethrough'))),
      vscode.commands.registerCommand('marker.toggleCodeSpan', safe(toggleCodeSpanCmd)),
      vscode.commands.registerCommand('marker.toggleCodeBlock', safe(toggleCodeBlockCmd)),
      vscode.commands.registerCommand('marker.headingUp', safe(() => changeHeadingLevel('up'))),
      vscode.commands.registerCommand('marker.headingDown', safe(() => changeHeadingLevel('down'))),
      vscode.commands.registerCommand('marker.toggleTask', safe(toggleTaskCmd)),
      vscode.commands.registerCommand('marker.indentList', safe(indentListCmd, 'editor.action.indentLines')),
      vscode.commands.registerCommand('marker.outdentList', safe(outdentListCmd, 'editor.action.outdentLines')),
      vscode.commands.registerCommand('marker.createTable', safe(createTable)),
      vscode.commands.registerCommand('marker.exportHtml', safe(exportToHtml)),
      vscode.commands.registerCommand('marker.deleteImage', safe(deleteImageCmd))
    );

    // DocumentPasteEditProvider — replaces Cmd+V keybinding override.
    // If extension host crashes, VS Code skips the provider and does default paste.
    const pasteKind = vscode.DocumentDropOrPasteEditKind.Text.append('marker', 'smartPaste');
    context.subscriptions.push(
      vscode.languages.registerDocumentPasteEditProvider(
        { language: 'markdown' },
        {
          async provideDocumentPasteEdits(document, ranges, dataTransfer, _context, token) {
            if (!isEnabled() || !getConfig<boolean>('override.paste', true)) { return undefined; }

            const textItem = dataTransfer.get('text/plain');
            const range = ranges[0];

            if (textItem) {
              const raw = await textItem.asString();
              if (token.isCancellationRequested) { return undefined; }
              const trimmed = raw.trim();

              if (shouldPasteAsLink(trimmed, !range.isEmpty)) {
                let url: string;
                if (isUrl(trimmed)) {
                  url = trimmed;
                } else if (isFilePath(trimmed)) {
                  const mode = getConfig<RelativePathMode>('pasteLink.relativePaths', 'auto');
                  const currentFile = document.uri.fsPath;
                  const inWorkspace = isInWorkspace(trimmed);
                  if (shouldUseRelativePath(mode, false, inWorkspace)) {
                    url = filePathToMarkdownUrl(toRelativePath(trimmed, currentFile));
                  } else {
                    url = filePathToMarkdownUrl(trimmed);
                  }
                } else {
                  return undefined;
                }

                if (!range.isEmpty) {
                  // Selection → wrap as [selection](url)
                  const selectedText = document.getText(range);
                  const edit = new vscode.DocumentPasteEdit(
                    wrapWithLink(selectedText, url),
                    'Paste as Markdown Link',
                    pasteKind
                  );
                  return [edit];
                }

                // No selection → check word under cursor
                const pos = range.start;
                const lineText = document.lineAt(pos.line).text;
                const link = findLinkAround(lineText, pos.character);
                if (link) {
                  // Cursor inside existing link — update URL
                  const linkRange = new vscode.Range(pos.line, link.start, pos.line, link.end);
                  const updated = link.isImage
                    ? wrapWithImage(link.text, url)
                    : wrapWithLink(link.text, url);
                  const edit = new vscode.DocumentPasteEdit('', 'Paste as Markdown Link', pasteKind);
                  edit.additionalEdit = new vscode.WorkspaceEdit();
                  edit.additionalEdit.replace(document.uri, linkRange, updated);
                  return [edit];
                }

                const wordRange = document.getWordRangeAtPosition(pos);
                if (wordRange) {
                  // Word under cursor → wrap as [word](url)
                  const word = document.getText(wordRange);
                  const edit = new vscode.DocumentPasteEdit('', 'Paste as Markdown Link', pasteKind);
                  edit.additionalEdit = new vscode.WorkspaceEdit();
                  edit.additionalEdit.replace(document.uri, wordRange, wrapWithLink(word, url));
                  return [edit];
                }

                // No word → insert bare URL
                const edit = new vscode.DocumentPasteEdit(url, 'Paste Link', pasteKind);
                return [edit];
              }
            }

            // Image in clipboard (no text) → save as file and insert markdown image
            if (getConfig<boolean>('pasteImage.enabled', true)) {
              const imageItem = dataTransfer.get('image/png');
              if (imageItem) {
                const file = imageItem.asFile?.();
                if (file) {
                  const currentFile = document.uri.fsPath;
                  if (document.isUntitled) { return undefined; }
                  const dir = path.dirname(currentFile);

                  const fileData = await file.data();
                  if (token.isCancellationRequested) { return undefined; }

                  let altText: string;
                  let finalFilename: string;

                  if (!range.isEmpty) {
                    altText = document.getText(range);
                    const filename = buildImageFilename(altText, 'png');
                    let fp = path.join(dir, filename);
                    finalFilename = filename;
                    let counter = 1;
                    while (await fileSystem.fileExists(fp)) {
                      finalFilename = `${filename.replace(/\.png$/, '')}-${counter}.png`;
                      fp = path.join(dir, finalFilename);
                      counter++;
                    }
                  } else {
                    const pattern = getConfig<string>('pasteImage.autoName', 'image-DDD');
                    const result = await findNextAutoFilename(dir, pattern, 'png');
                    finalFilename = result.filename;
                    altText = result.altText;
                  }

                  const finalPath = path.join(dir, finalFilename);
                  await fileSystem.writeFile(finalPath, new Uint8Array(fileData));

                  const edit = new vscode.DocumentPasteEdit(
                    wrapWithImage(altText, finalFilename),
                    'Paste as Markdown Image',
                    pasteKind
                  );
                  return [edit];
                }
              }
            }

            return undefined; // default paste
          }
        },
        {
          providedPasteEditKinds: [pasteKind],
          pasteMimeTypes: ['text/plain', 'image/png']
        }
      )
    );

    // Set context key AFTER commands are registered so keybindings
    // cannot fire before the commands exist.
    const syncActiveContext = () => {
      const enabled = vscode.workspace.getConfiguration('marker').get<boolean>('enabled', true);
      vscode.commands.executeCommand('setContext', 'marker.active', enabled);
    };
    syncActiveContext();

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('marker.enabled')) {
          syncActiveContext();
        }
      }),

      // Auto-renumber lists on ANY document change (delete, cut, paste,
      // manual indent edit, etc.). Debounced — heavy check runs only after
      // 400ms of inactivity, not on every keystroke.
      vscode.workspace.onDidChangeTextDocument(e => {
        if (renumberBusy) { return; }
        if (e.document.languageId !== 'markdown') { return; }
        if (e.contentChanges.length === 0) { return; }
        // Never interfere with Undo/Redo — VS Code system operations are sacred
        if (e.reason === vscode.TextDocumentChangeReason.Undo ||
            e.reason === vscode.TextDocumentChangeReason.Redo) { return; }

        if (renumberTimer) { clearTimeout(renumberTimer); }
        renumberTimer = setTimeout(async () => {
          if (skipNextDebounce) { skipNextDebounce = false; return; }
          if (renumberBusy) { return; }
          const cooldown = getConfig<number>('autoList.numbered.renumberCooldownMs', 1000);
          if (cooldown > 0 && Date.now() - lastRenumberTime < cooldown) { return; }
          if (!isEnabled()) { return; }

          const editor = vscode.window.activeTextEditor;
          if (!editor || editor.document !== e.document) { return; }

          const cursorLine = editor.selection.active.line;
          if (cursorLine >= editor.document.lineCount) { return; }
          const allLines = getDocLines(editor.document);

          // Clean up empty list items: if the line above cursor is an
          // empty list prefix (e.g. "6. " with no content), clear it
          // AND remove the extra blank line that Enter created.
          // Result: "6. " → empty line, no extra newline.
          if (cursorLine > 0) {
            const prevLine = cursorLine - 1;
            const prevParsed = parseListPrefix(allLines[prevLine]);
            if (prevParsed.type !== 'none' && prevParsed.isEmpty) {
              // Delete from start of prefix line through end of current line (the extra newline)
              const deleteRange = new vscode.Range(prevLine, 0, cursorLine, allLines[cursorLine].length);
              renumberBusy = true;
              try {
                await editor.edit(eb => eb.replace(deleteRange, ''));
                // Cursor lands on the now-empty prevLine
                const newPos = new vscode.Position(prevLine, 0);
                editor.selection = new vscode.Selection(newPos, newPos);
              } catch { /* best-effort */ }
              finally { renumberBusy = false; }
              return;
            }
          }

          // Check if cursor is inside a list block with numbered items
          const [start, end] = findListBounds(allLines, cursorLine);
          let hasNumbered = false;
          for (let i = start; i <= end; i++) {
            if (parseListPrefix(allLines[i]).type === 'number') {
              hasNumbered = true;
              break;
            }
          }
          if (!hasNumbered) { return; }

          renumberBusy = true;
          try {
            await renumberSurroundingList(editor);
          } catch { /* best-effort */ }
          finally { renumberBusy = false; }
        }, 400);
      })
    );
  } catch (err) {
    // Activation failed — keep marker.active=false so keybindings
    // fall through to VS Code defaults and system keys are never blocked.
    console.error('[Marker] Activation failed:', err);
  }
}

export function deactivate(): void {
  vscode.commands.executeCommand('setContext', 'marker.active', false);
}
