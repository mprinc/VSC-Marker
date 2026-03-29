import * as vscode from 'vscode';
import * as path from 'path';
import {
  wrapWithLink, wrapWithImage, isUrl, buildImageFilename,
  parseListPrefix, buildNextLinePrefix, NumberedListMode,
  toggleWrap, toggleHtmlWrap, findWrapperAround, findHtmlWrapperAround,
  findLinkAround,
  analyzeText, generateMarkdownTable, getDelimiterLabel,
  Delimiter, parseTextAsTable,
  toggleCodeSpan, toggleCodeBlock,
  getHeadingLevel, setHeadingLevel,
  toggleTaskCheck,
  indentLine, outdentLine
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

async function pasteLink(): Promise<void> {
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) { return; }

  const clipboardText = await clipboard.readText();
  if (!clipboardText || !isUrl(clipboardText.trim())) {
    notify.showError('Clipboard does not contain a valid URL.');
    return;
  }

  const url = clipboardText.trim();
  const info = getPasteSelection(vscEditor);

  if (!info) {
    // No selection, no word under cursor — insert bare URL at cursor
    const pos = vscEditor.selection.active;
    await vscEditor.edit(eb => eb.insert(pos, url));
    return;
  }

  if (info.existingLink) {
    // Cursor inside existing link — update the URL
    const updated = info.existingLink.isImage
      ? wrapWithImage(info.existingLink.text, url)
      : wrapWithLink(info.existingLink.text, url);
    await vscEditor.edit(eb => eb.replace(info.selection, updated));
  } else {
    const markdownLink = wrapWithLink(info.text, url);
    await vscEditor.edit(eb => eb.replace(info.selection, markdownLink));
  }
}

async function smartPaste(): Promise<void> {
  if (!getConfig<boolean>('smartPaste.enabled', true)) {
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
    return;
  }

  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) {
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
    return;
  }

  // Check if we have text (selected or word under cursor) for link/image wrapping
  const info = getPasteSelection(vscEditor);

  if (info) {
    // Text available + URL in clipboard → paste as link
    if (getConfig<boolean>('pasteLink.enabled', true)) {
      const clipboardText = await clipboard.readText();
      if (clipboardText && isUrl(clipboardText.trim())) {
        await pasteLink();
        return;
      }
    }

    // Text available + image in clipboard → paste as image
    if (getConfig<boolean>('pasteImage.enabled', true) && editor.getSelectedText()) {
      const imageData = await clipboard.readImage();
      if (imageData) {
        await pasteImage();
        return;
      }
    }
  }

  // Fallback: default paste
  await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
}

async function pasteImage(): Promise<void> {
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) { return; }

  const info = getPasteSelection(vscEditor);
  if (!info) {
    notify.showError('No text selected. Select text or place cursor on a word.');
    return;
  }

  const currentFile = editor.getCurrentFilePath();
  if (!currentFile) {
    notify.showError('Save the file first. Image needs to be placed in the same folder.');
    return;
  }

  const imageData = await clipboard.readImage();
  if (!imageData) {
    notify.showError('Clipboard does not contain an image.');
    return;
  }

  const dir = fileSystem.getDirname(currentFile);
  const filename = buildImageFilename(info.text, 'png');
  const imagePath = path.join(dir, filename);

  // If file already exists, add a numeric suffix
  let finalPath = imagePath;
  let finalFilename = filename;
  let counter = 1;
  while (await fileSystem.fileExists(finalPath)) {
    const nameWithoutExt = filename.replace(/\.png$/, '');
    finalFilename = `${nameWithoutExt}-${counter}.png`;
    finalPath = path.join(dir, finalFilename);
    counter++;
  }

  await fileSystem.writeFile(finalPath, imageData);

  const markdownImage = wrapWithImage(info.text, finalFilename);
  await vscEditor.edit(eb => eb.replace(info.selection, markdownImage));
  notify.showInfo(`Image saved as ${finalFilename}`);
}

function getConfig<T>(key: string, defaultValue: T): T {
  return vscode.workspace.getConfiguration('marker').get<T>(key, defaultValue);
}

async function onEnter(): Promise<void> {
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) {
    await vscode.commands.executeCommand('type', { text: '\n' });
    return;
  }

  const doc = vscEditor.document;
  const pos = vscEditor.selection.active;
  const currentLine = doc.lineAt(pos.line).text;
  const current = parseListPrefix(currentLine);

  const bulletEnabled = getConfig<boolean>('autoList.bullet.enabled', true);
  const numberedEnabled = getConfig<boolean>('autoList.numbered.enabled', true);

  // Check if we should handle this line
  const shouldHandle =
    (current.type === 'bullet' && bulletEnabled) ||
    (current.type === 'number' && numberedEnabled);

  if (!shouldHandle) {
    await vscode.commands.executeCommand('type', { text: '\n' });
    return;
  }

  // If current item is empty (just marker, no text) → remove marker and add blank line
  if (current.isEmpty) {
    const lineRange = doc.lineAt(pos.line).range;
    await vscEditor.edit(editBuilder => {
      editBuilder.replace(lineRange, '');
    });
    return;
  }

  // Determine previous number for auto mode
  let previousNumber: number | null = null;
  if (current.type === 'number' && pos.line > 0) {
    const prevLine = doc.lineAt(pos.line - 1).text;
    const prev = parseListPrefix(prevLine);
    if (prev.type === 'number' && prev.number !== undefined) {
      previousNumber = prev.number;
    }
  }

  const numberedMode = getConfig<NumberedListMode>('autoList.numbered.mode', 'auto');
  const prefix = buildNextLinePrefix(current, previousNumber, numberedMode);

  // Split line at cursor: text after cursor moves to new line
  const textAfterCursor = currentLine.substring(pos.character);
  await vscEditor.edit(editBuilder => {
    // Remove text from cursor to end of line, then insert newline + prefix + that text
    const rangeAfterCursor = new vscode.Range(pos, new vscode.Position(pos.line, currentLine.length));
    editBuilder.replace(rangeAfterCursor, '\n' + prefix + textAfterCursor);
  });

  // Move cursor to end of inserted prefix (before the carried-over text)
  const newPos = new vscode.Position(pos.line + 1, prefix.length);
  vscEditor.selection = new vscode.Selection(newPos, newPos);
}

async function createTable(): Promise<void> {
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

async function toggleFormat(wrapper: string, isHtml: boolean = false): Promise<void> {
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) { return; }

  const sel = getFormatSelection(vscEditor, wrapper, isHtml);
  if (!sel) { return; }

  const text = vscEditor.document.getText(sel);
  const result = isHtml ? toggleHtmlWrap(text, wrapper) : toggleWrap(text, wrapper);

  await vscEditor.edit(editBuilder => {
    editBuilder.replace(sel, result);
  });
}

// --- Code span / block ---

async function toggleCodeSpanCmd(): Promise<void> {
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) { return; }

  const sel = getFormatSelection(vscEditor, '`', false);
  if (!sel) { return; }

  const text = vscEditor.document.getText(sel);
  await vscEditor.edit(eb => eb.replace(sel, toggleCodeSpan(text)));
}

async function toggleCodeBlockCmd(): Promise<void> {
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor || vscEditor.selection.isEmpty) { return; }
  const text = vscEditor.document.getText(vscEditor.selection);
  const lang = getConfig<string>('codeBlock.defaultLanguage', 'sh');
  await vscEditor.edit(eb => eb.replace(vscEditor.selection, toggleCodeBlock(text, lang)));
}

// --- Heading level with cascade ---

async function changeHeadingLevel(direction: 'up' | 'down'): Promise<void> {
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

async function indentListCmd(): Promise<void> {
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) {
    await vscode.commands.executeCommand('tab');
    return;
  }

  const doc = vscEditor.document;
  const sel = vscEditor.selection;
  const startLine = sel.start.line;
  const endLine = sel.end.line;

  // Only handle if at least one line is a list item
  let hasListItem = false;
  for (let i = startLine; i <= endLine; i++) {
    if (parseListPrefix(doc.lineAt(i).text).type !== 'none') {
      hasListItem = true;
      break;
    }
  }

  if (!hasListItem) {
    await vscode.commands.executeCommand('tab');
    return;
  }

  const tabSize = vscEditor.options.tabSize as number || 2;
  await vscEditor.edit(eb => {
    for (let i = startLine; i <= endLine; i++) {
      eb.replace(doc.lineAt(i).range, indentLine(doc.lineAt(i).text, tabSize));
    }
  });
}

async function outdentListCmd(): Promise<void> {
  const vscEditor = vscode.window.activeTextEditor;
  if (!vscEditor) {
    await vscode.commands.executeCommand('outdent');
    return;
  }

  const doc = vscEditor.document;
  const sel = vscEditor.selection;
  const startLine = sel.start.line;
  const endLine = sel.end.line;

  let hasListItem = false;
  for (let i = startLine; i <= endLine; i++) {
    if (parseListPrefix(doc.lineAt(i).text).type !== 'none') {
      hasListItem = true;
      break;
    }
  }

  if (!hasListItem) {
    await vscode.commands.executeCommand('outdent');
    return;
  }

  const tabSize = vscEditor.options.tabSize as number || 2;
  await vscEditor.edit(eb => {
    for (let i = startLine; i <= endLine; i++) {
      eb.replace(doc.lineAt(i).range, outdentLine(doc.lineAt(i).text, tabSize));
    }
  });
}

// --- Export to HTML ---

async function exportToHtml(): Promise<void> {
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

function safe(fn: (...args: any[]) => Promise<void>): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error('[Marker]', err);
      notify.showError(`Marker error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('marker.pasteLink', safe(pasteLink)),
    vscode.commands.registerCommand('marker.pasteImage', safe(pasteImage)),
    vscode.commands.registerCommand('marker.smartPaste', safe(smartPaste)),
    vscode.commands.registerCommand('marker.onEnter', safe(onEnter)),
    vscode.commands.registerCommand('marker.showPreview', () => showPreview(context)),
    vscode.commands.registerCommand('marker.toggleBold', safe(() => toggleFormat('**'))),
    vscode.commands.registerCommand('marker.toggleItalic', safe(() => toggleFormat('*'))),
    vscode.commands.registerCommand('marker.toggleUnderline', safe(() => toggleFormat('u', true))),
    vscode.commands.registerCommand('marker.toggleStrikethrough', safe(() => toggleFormat('~~'))),
    vscode.commands.registerCommand('marker.toggleCodeSpan', safe(toggleCodeSpanCmd)),
    vscode.commands.registerCommand('marker.toggleCodeBlock', safe(toggleCodeBlockCmd)),
    vscode.commands.registerCommand('marker.headingUp', safe(() => changeHeadingLevel('up'))),
    vscode.commands.registerCommand('marker.headingDown', safe(() => changeHeadingLevel('down'))),
    vscode.commands.registerCommand('marker.toggleTask', safe(toggleTaskCmd)),
    vscode.commands.registerCommand('marker.indentList', safe(indentListCmd)),
    vscode.commands.registerCommand('marker.outdentList', safe(outdentListCmd)),
    vscode.commands.registerCommand('marker.createTable', safe(createTable)),
    vscode.commands.registerCommand('marker.exportHtml', safe(exportToHtml))
  );
}

export function deactivate(): void {}
