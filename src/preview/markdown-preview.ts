import * as vscode from 'vscode';
import * as path from 'path';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: true,        // Allow inline HTML tags and styles
  linkify: true,     // Auto-convert URL-like text to links
  typographer: true, // Smart quotes, dashes
  breaks: false,     // Don't convert \n to <br>
});

// Track open preview panels per document
const openPanels = new Map<string, vscode.WebviewPanel>();

export function showPreview(context: vscode.ExtensionContext): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active Markdown file.');
    return;
  }

  const doc = editor.document;
  if (doc.languageId !== 'markdown') {
    vscode.window.showErrorMessage('Active file is not Markdown.');
    return;
  }

  const docKey = doc.uri.toString();

  // If panel already open for this doc, reveal it
  const existing = openPanels.get(docKey);
  if (existing) {
    existing.reveal(vscode.ViewColumn.Beside);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'marker.preview',
    `Preview: ${path.basename(doc.fileName)}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      localResourceRoots: [vscode.Uri.file(path.dirname(doc.fileName))],
    }
  );

  openPanels.set(docKey, panel);

  // Initial render
  panel.webview.html = renderHtml(panel.webview, doc);

  // Debounced update on document change
  const debounceMs = vscode.workspace.getConfiguration('marker').get<number>('preview.debounceMs', 300);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const changeListener = vscode.workspace.onDidChangeTextDocument(e => {
    if (e.document.uri.toString() === docKey) {
      if (debounceTimer) { clearTimeout(debounceTimer); }
      debounceTimer = setTimeout(() => {
        panel.webview.html = renderHtml(panel.webview, e.document);
      }, debounceMs);
    }
  });

  panel.onDidDispose(() => {
    if (debounceTimer) { clearTimeout(debounceTimer); }
    openPanels.delete(docKey);
    changeListener.dispose();
  });
}

function renderHtml(webview: vscode.Webview, doc: vscode.TextDocument): string {
  const markdownText = doc.getText();
  const docDir = path.dirname(doc.uri.fsPath);

  // Render markdown to HTML
  let html = md.render(markdownText);

  // Resolve relative image paths to webview URIs
  // markdown-it percent-encodes non-ASCII chars (e.g. Cyrillic), so we decode first
  html = html.replace(
    /(<img\s+[^>]*src=")([^"]+)(")/g,
    (_match, before, src, after) => {
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
        return `${before}${src}${after}`;
      }
      const decoded = decodeURIComponent(src);
      const absPath = path.resolve(docDir, decoded);
      const webviewUri = webview.asWebviewUri(vscode.Uri.file(absPath));
      return `${before}${webviewUri}${after}`;
    }
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.6;
      padding: 20px 40px;
      max-width: 900px;
      margin: 0 auto;
      color: var(--vscode-editor-foreground, #333);
      background: var(--vscode-editor-background, #fff);
    }
    h1 { border-bottom: 2px solid var(--vscode-panel-border, #ddd); padding-bottom: 0.3em; }
    h2 { border-bottom: 1px solid var(--vscode-panel-border, #ddd); padding-bottom: 0.3em; }
    a { color: var(--vscode-textLink-foreground, #0366d6); }
    code {
      background: var(--vscode-textCodeBlock-background, #f6f8fa);
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-size: 0.9em;
    }
    pre {
      background: var(--vscode-textCodeBlock-background, #f6f8fa);
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
    }
    pre code { background: none; padding: 0; }
    blockquote {
      border-left: 4px solid var(--vscode-panel-border, #dfe2e5);
      margin: 0;
      padding: 0 16px;
      color: var(--vscode-descriptionForeground, #6a737d);
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 16px 0;
    }
    th, td {
      border: 1px solid var(--vscode-panel-border, #dfe2e5);
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background: var(--vscode-textCodeBlock-background, #f6f8fa);
      font-weight: 600;
    }
    tr:nth-child(even) {
      background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.03));
    }
    img {
      max-width: 100%;
      height: auto;
      border-radius: 4px;
    }
    hr {
      border: none;
      border-top: 1px solid var(--vscode-panel-border, #dfe2e5);
      margin: 24px 0;
    }
    ul, ol { padding-left: 2em; }
    li + li { margin-top: 0.25em; }
  </style>
</head>
<body>
${html}
</body>
</html>`;
}
