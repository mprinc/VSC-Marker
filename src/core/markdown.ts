/**
 * Pure functions for Markdown text transformations.
 * No dependencies on VS Code or any platform-specific APIs.
 */

export function wrapWithLink(selectedText: string, url: string): string {
  return `[${selectedText}](${url})`;
}

export function wrapWithImage(altText: string, imagePath: string): string {
  return `![${altText}](${imagePath})`;
}

export function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitizeFilename(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff\-_\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildImageFilename(altText: string, extension: string = 'png'): string {
  const sanitized = sanitizeFilename(altText);
  const name = sanitized || 'image';
  return `${name}.${extension}`;
}
