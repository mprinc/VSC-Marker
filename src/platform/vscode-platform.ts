/**
 * VS Code implementation of platform interfaces.
 * All VS Code API usage is contained in this file.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  ClipboardService,
  EditorService,
  FileSystemService,
  NotificationService
} from './interfaces';

export class VscClipboardService implements ClipboardService {
  async readText(): Promise<string> {
    return vscode.env.clipboard.readText();
  }

  async readImage(): Promise<Uint8Array | null> {
    // VS Code clipboard API does not support reading binary image data directly.
    // We use the clipboard paste command approach: the image is available
    // through the VS Code paste API (DocumentPasteEditProvider) since VS Code 1.82+.
    // For this extension we use an alternative: execute a native clipboard read.
    return readClipboardImageNative();
  }
}

export class VscEditorService implements EditorService {
  getSelectedText(): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return null; }
    const selection = editor.selection;
    if (selection.isEmpty) { return null; }
    return editor.document.getText(selection);
  }

  async replaceSelection(newText: string): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return false; }
    return editor.edit(editBuilder => {
      editBuilder.replace(editor.selection, newText);
    });
  }

  getCurrentFilePath(): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return null; }
    if (editor.document.isUntitled) { return null; }
    return editor.document.uri.fsPath;
  }
}

export class VscFileSystemService implements FileSystemService {
  async writeFile(filePath: string, data: Uint8Array): Promise<void> {
    await fs.writeFile(filePath, data);
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  getDirname(filePath: string): string {
    return path.dirname(filePath);
  }
}

export class VscNotificationService implements NotificationService {
  showInfo(message: string): void {
    vscode.window.showInformationMessage(message);
  }

  showError(message: string): void {
    vscode.window.showErrorMessage(message);
  }
}

/**
 * Read image from system clipboard using native tools.
 * macOS: uses osascript + pbpaste workaround to detect clipboard image,
 *        then uses a Swift helper or pngpaste if available.
 * For cross-platform support, this could be extended.
 */
async function readClipboardImageNative(): Promise<Uint8Array | null> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const { tmpdir } = await import('os');
  const execAsync = promisify(exec);
  const tmpPath = path.join(tmpdir(), `marker-clipboard-${Date.now()}.png`);

  if (process.platform === 'darwin') {
    try {
      // Use osascript to save clipboard image as PNG
      const script = `
        use framework "AppKit"
        set pb to current application's NSPasteboard's generalPasteboard()
        set imgData to pb's dataForType:(current application's NSPasteboardTypePNG)
        if imgData is missing value then
          set tiffData to pb's dataForType:(current application's NSPasteboardTypeTIFF)
          if tiffData is missing value then
            error "No image in clipboard"
          end if
          set bitmapRep to current application's NSBitmapImageRep's imageRepWithData:tiffData
          set imgData to bitmapRep's representationUsingType:(current application's NSBitmapImageFileTypePNG) properties:(missing value)
        end if
        imgData's writeToFile:"${tmpPath}" atomically:true
      `;
      await execAsync(`osascript -l AppleScript -e '${script.replace(/'/g, "'\\''")}'`);
      const data = await fs.readFile(tmpPath);
      await fs.unlink(tmpPath).catch(() => {});
      return new Uint8Array(data);
    } catch {
      return null;
    }
  } else if (process.platform === 'linux') {
    try {
      await execAsync(`xclip -selection clipboard -t image/png -o > "${tmpPath}"`);
      const data = await fs.readFile(tmpPath);
      await fs.unlink(tmpPath).catch(() => {});
      return new Uint8Array(data);
    } catch {
      return null;
    }
  } else if (process.platform === 'win32') {
    try {
      const psScript = `Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img -ne $null) { $img.Save('${tmpPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png) }`;
      await execAsync(`powershell -Command "${psScript}"`);
      const data = await fs.readFile(tmpPath);
      await fs.unlink(tmpPath).catch(() => {});
      return new Uint8Array(data);
    } catch {
      return null;
    }
  }

  return null;
}
