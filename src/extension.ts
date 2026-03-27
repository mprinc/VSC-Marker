import * as vscode from 'vscode';
import * as path from 'path';
import { wrapWithLink, wrapWithImage, isUrl, buildImageFilename } from './core/markdown';
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

async function pasteLink(): Promise<void> {
  const selectedText = editor.getSelectedText();
  if (!selectedText) {
    notify.showError('No text selected. Select text first, then paste a link.');
    return;
  }

  const clipboardText = await clipboard.readText();
  if (!clipboardText || !isUrl(clipboardText.trim())) {
    notify.showError('Clipboard does not contain a valid URL.');
    return;
  }

  const markdownLink = wrapWithLink(selectedText, clipboardText.trim());
  await editor.replaceSelection(markdownLink);
}

async function pasteImage(): Promise<void> {
  const selectedText = editor.getSelectedText();
  if (!selectedText) {
    notify.showError('No text selected. Select text to use as alt text for the image.');
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
  const filename = buildImageFilename(selectedText, 'png');
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

  const markdownImage = wrapWithImage(selectedText, finalFilename);
  await editor.replaceSelection(markdownImage);
  notify.showInfo(`Image saved as ${finalFilename}`);
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('marker.pasteLink', pasteLink),
    vscode.commands.registerCommand('marker.pasteImage', pasteImage)
  );
}

export function deactivate(): void {}
