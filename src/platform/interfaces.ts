/**
 * Platform-agnostic interfaces.
 * These abstractions allow the core logic to work independently of VS Code,
 * making it possible to test without VS Code or port to other editors.
 */

export interface ClipboardService {
  readText(): Promise<string>;
  readImage(): Promise<Uint8Array | null>;
}

export interface EditorService {
  getSelectedText(): string | null;
  replaceSelection(newText: string): Promise<boolean>;
  getCurrentFilePath(): string | null;
}

export interface FileSystemService {
  writeFile(path: string, data: Uint8Array): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  getDirname(filePath: string): string;
}

export interface NotificationService {
  showInfo(message: string): void;
  showError(message: string): void;
}
