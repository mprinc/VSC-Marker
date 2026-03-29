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

/**
 * Find a markdown link [text](url) or image ![text](url) around cursor position.
 * Returns { start, end, text, url, isImage } or null.
 */
export interface LinkMatch {
  start: number;
  end: number;
  text: string;
  url: string;
  isImage: boolean;
}

export function findLinkAround(lineText: string, cursorCol: number): LinkMatch | null {
  // Match all links/images in the line: ![alt](url) or [text](url)
  const regex = /(!\[([^\]]*)\]\(([^)]*)\)|\[([^\]]*)\]\(([^)]*)\))/g;
  let match;
  while ((match = regex.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (cursorCol >= start && cursorCol <= end) {
      const isImage = match[0].startsWith('!');
      return {
        start,
        end,
        text: isImage ? match[2] : match[4],
        url: isImage ? match[3] : match[5],
        isImage,
      };
    }
  }
  return null;
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

// --- Table ---

export type Delimiter = 'tab' | 'semicolon' | 'comma' | 'pipe';

export interface TableAnalysis {
  isTable: boolean;
  rows: number;
  cols: number;
  delimiter: Delimiter;
  hasHeader: boolean;
  data: string[][];
}

const DELIMITER_MAP: Record<Delimiter, string> = {
  tab: '\t',
  semicolon: ';',
  comma: ',',
  pipe: '|',
};

const DELIMITER_LABELS: Record<Delimiter, string> = {
  tab: 'Tab',
  semicolon: 'Semicolon (;)',
  comma: 'Comma (,)',
  pipe: 'Pipe (|)',
};

export function getDelimiterLabel(d: Delimiter): string {
  return DELIMITER_LABELS[d];
}

export function detectDelimiter(text: string): Delimiter {
  const lines = text.split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0) { return 'comma'; }

  const counts: Record<Delimiter, number> = { tab: 0, semicolon: 0, comma: 0, pipe: 0 };
  for (const line of lines) {
    counts.tab += (line.match(/\t/g) || []).length;
    counts.semicolon += (line.match(/;/g) || []).length;
    counts.comma += (line.match(/,/g) || []).length;
    counts.pipe += (line.match(/\|/g) || []).length;
  }

  // Check consistency: a good delimiter has the same count per line
  const delimiters: Delimiter[] = ['tab', 'pipe', 'semicolon', 'comma'];
  for (const d of delimiters) {
    if (counts[d] === 0) { continue; }
    const perLine = lines.map(l => (l.match(new RegExp(escapeRegex(DELIMITER_MAP[d]), 'g')) || []).length);
    const allSame = perLine.every(c => c === perLine[0] && c > 0);
    if (allSame) { return d; }
  }

  // Fallback: highest total count
  let best: Delimiter = 'comma';
  let max = 0;
  for (const d of delimiters) {
    if (counts[d] > max) { max = counts[d]; best = d; }
  }
  return best;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseTextAsTable(text: string, delimiter: Delimiter): string[][] {
  const sep = DELIMITER_MAP[delimiter];
  const lines = text.split('\n').filter(l => l.trim() !== '');
  return lines.map(line => {
    let cells = line.split(sep).map(c => c.trim());
    // For pipe delimiter, remove empty first/last cells from leading/trailing pipes
    if (delimiter === 'pipe' && cells.length > 0) {
      if (cells[0] === '') { cells = cells.slice(1); }
      if (cells.length > 0 && cells[cells.length - 1] === '') { cells = cells.slice(0, -1); }
    }
    return cells;
  });
}

export function analyzeText(text: string): TableAnalysis {
  const lines = text.split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) {
    return { isTable: false, rows: 0, cols: 0, delimiter: 'comma', hasHeader: false, data: [] };
  }

  const delimiter = detectDelimiter(text);
  const data = parseTextAsTable(text, delimiter);

  // Check if all rows have the same number of columns
  const colCounts = data.map(r => r.length);
  const consistentCols = colCounts.every(c => c === colCounts[0]);

  if (!consistentCols || colCounts[0] < 2) {
    return { isTable: false, rows: 0, cols: 0, delimiter, hasHeader: false, data: [] };
  }

  // Heuristic: if first row looks different (shorter cells, no numbers) → likely header
  const firstRowAvgLen = data[0].reduce((s, c) => s + c.length, 0) / data[0].length;
  const restAvgLen = data.slice(1).reduce((s, row) => s + row.reduce((rs, c) => rs + c.length, 0) / row.length, 0) / (data.length - 1);
  const hasHeader = firstRowAvgLen <= restAvgLen * 1.5;

  return {
    isTable: true,
    rows: hasHeader ? data.length - 1 : data.length,
    cols: colCounts[0],
    delimiter,
    hasHeader,
    data,
  };
}

export function generateMarkdownTable(
  cols: number,
  rows: number,
  hasHeader: boolean,
  data?: string[][]
): string {
  const lines: string[] = [];

  if (hasHeader && data && data.length > 0) {
    // Use first row as header
    const header = padRow(data[0], cols);
    lines.push(formatRow(header));
    lines.push(formatSeparator(cols, header));
    const bodyData = data.slice(1);
    for (let r = 0; r < rows; r++) {
      const row = r < bodyData.length ? padRow(bodyData[r], cols) : new Array(cols).fill('');
      lines.push(formatRow(row));
    }
  } else if (data && data.length > 0) {
    // No header, generate generic header
    const header = Array.from({ length: cols }, (_, i) => `Col ${i + 1}`);
    lines.push(formatRow(header));
    lines.push(formatSeparator(cols, header));
    for (let r = 0; r < rows; r++) {
      const row = r < data.length ? padRow(data[r], cols) : new Array(cols).fill('');
      lines.push(formatRow(row));
    }
  } else {
    // Empty table
    const header = Array.from({ length: cols }, (_, i) => `Col ${i + 1}`);
    lines.push(formatRow(header));
    lines.push(formatSeparator(cols, header));
    for (let r = 0; r < rows; r++) {
      lines.push(formatRow(new Array(cols).fill('     ')));
    }
  }

  return lines.join('\n');
}

function padRow(row: string[], cols: number): string[] {
  const result = [...row];
  while (result.length < cols) { result.push(''); }
  return result.slice(0, cols);
}

function formatRow(cells: string[]): string {
  const padded = cells.map(c => ` ${c || ' '} `);
  return `|${padded.join('|')}|`;
}

function formatSeparator(cols: number, headerCells: string[]): string {
  const seps = headerCells.slice(0, cols).map(c => {
    const len = Math.max(c.length + 2, 3);
    return '-'.repeat(len);
  });
  return `|${seps.join('|')}|`;
}

// --- Code wrapping ---

export function toggleCodeSpan(text: string): string {
  if (text.startsWith('`') && text.endsWith('`') && !text.startsWith('```')) {
    return text.slice(1, -1);
  }
  return `\`${text}\``;
}

export function toggleCodeBlock(text: string, lang: string = 'sh'): string {
  const lines = text.split('\n');
  if (lines[0].startsWith('```') && lines[lines.length - 1].trimEnd() === '```') {
    return lines.slice(1, -1).join('\n');
  }
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

// --- Heading ---

const HEADING_REGEX = /^(#{1,6})\s+(.*)$/;

export function getHeadingLevel(line: string): number {
  const match = line.match(HEADING_REGEX);
  return match ? match[1].length : 0;
}

export function setHeadingLevel(line: string, level: number): string {
  const match = line.match(HEADING_REGEX);
  const content = match ? match[2] : line.trimStart();
  if (level <= 0) { return content; }
  return `${'#'.repeat(Math.min(level, 6))} ${content}`;
}

// --- Task list ---

const TASK_UNCHECKED_REGEX = /^(\s*[-+*])\s\[\s\]\s(.*)$/;
const TASK_CHECKED_REGEX = /^(\s*[-+*])\s\[x\]\s(.*)$/i;
const PLAIN_BULLET_REGEX = /^(\s*[-+*])\s(.*)$/;

export function toggleTaskCheck(line: string): string {
  const unchecked = line.match(TASK_UNCHECKED_REGEX);
  if (unchecked) {
    return `${unchecked[1]} [x] ${unchecked[2]}`;
  }

  const checked = line.match(TASK_CHECKED_REGEX);
  if (checked) {
    return `${checked[1]} [ ] ${checked[2]}`;
  }

  // Plain bullet → convert to unchecked task
  const bullet = line.match(PLAIN_BULLET_REGEX);
  if (bullet) {
    return `${bullet[1]} [ ] ${bullet[2]}`;
  }

  return line;
}

// --- List indentation ---

export function indentLine(line: string, tabSize: number = 2): string {
  return ' '.repeat(tabSize) + line;
}

export function outdentLine(line: string, tabSize: number = 2): string {
  const match = line.match(/^(\s+)/);
  if (!match) { return line; }
  const currentIndent = match[1].length;
  const newIndent = Math.max(0, currentIndent - tabSize);
  return ' '.repeat(newIndent) + line.trimStart();
}

// --- Text formatting ---

export function toggleWrap(text: string, wrapper: string): string {
  if (text.startsWith(wrapper) && text.endsWith(wrapper) && text.length > wrapper.length * 2) {
    return text.slice(wrapper.length, -wrapper.length);
  }
  return `${wrapper}${text}${wrapper}`;
}

export function toggleHtmlWrap(text: string, tag: string): string {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  if (text.startsWith(openTag) && text.endsWith(closeTag)) {
    return text.slice(openTag.length, -closeTag.length);
  }
  return `${openTag}${text}${closeTag}`;
}

/**
 * Find a symmetric wrapper (e.g. **, ~~, `) around a position in a line.
 * Returns [start, end] offsets of the full wrapped region (including wrappers),
 * or null if not found.
 */
export function findWrapperAround(
  lineText: string,
  cursorCol: number,
  wrapper: string
): [number, number] | null {
  const wLen = wrapper.length;
  // Find all wrapper positions in the line
  const positions: number[] = [];
  for (let i = 0; i <= lineText.length - wLen; i++) {
    if (lineText.substring(i, i + wLen) === wrapper) {
      positions.push(i);
      i += wLen - 1; // skip past this wrapper
    }
  }
  // Pair them up (1st+2nd, 3rd+4th, ...) and check if cursor is within any pair
  for (let i = 0; i + 1 < positions.length; i += 2) {
    const start = positions[i];
    const end = positions[i + 1] + wLen;
    if (cursorCol >= start && cursorCol <= end) {
      return [start, end];
    }
  }
  return null;
}

/**
 * Find an HTML tag wrapper (e.g. <u>...</u>) around a position in a line.
 */
export function findHtmlWrapperAround(
  lineText: string,
  cursorCol: number,
  tag: string
): [number, number] | null {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;

  // Search backwards for opening tag
  let openIdx = -1;
  for (let i = cursorCol - 1; i >= 0; i--) {
    if (lineText.substring(i, i + openTag.length) === openTag) {
      openIdx = i;
      break;
    }
  }
  if (openIdx === -1) { return null; }

  // Search for closing tag after the opening (not after cursor)
  let closeIdx = -1;
  for (let i = openIdx + openTag.length; i <= lineText.length - closeTag.length; i++) {
    if (lineText.substring(i, i + closeTag.length) === closeTag) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) { return null; }

  const end = closeIdx + closeTag.length;
  if (cursorCol >= openIdx && cursorCol <= end) {
    return [openIdx, end];
  }
  return null;
}

// --- List continuation ---

export interface ListPrefix {
  type: 'bullet' | 'number' | 'none';
  marker: string;      // "-", "+", or "1."
  indent: string;      // leading whitespace
  number?: number;     // parsed number for numbered lists
  isEmpty: boolean;    // true if line is just the marker with no content
}

const BULLET_REGEX = /^(\s*)([-+])\s(.*)$/;
const NUMBER_REGEX = /^(\s*)(\d+)\.\s(.*)$/;

export function parseListPrefix(line: string): ListPrefix {
  const bulletMatch = line.match(BULLET_REGEX);
  if (bulletMatch) {
    return {
      type: 'bullet',
      marker: bulletMatch[2],
      indent: bulletMatch[1],
      isEmpty: bulletMatch[3].trim() === '',
    };
  }

  const numberMatch = line.match(NUMBER_REGEX);
  if (numberMatch) {
    return {
      type: 'number',
      marker: `${numberMatch[2]}.`,
      indent: numberMatch[1],
      number: parseInt(numberMatch[2], 10),
      isEmpty: numberMatch[3].trim() === '',
    };
  }

  return { type: 'none', marker: '', indent: '', isEmpty: true };
}

export type NumberedListMode = 'auto' | 'increment';

export function getNextNumber(
  currentNumber: number,
  previousNumber: number | null,
  mode: NumberedListMode
): number {
  if (mode === 'increment') {
    return currentNumber + 1;
  }

  // "auto" mode
  if (previousNumber === null) {
    // First line — depends on mode, default to increment
    return currentNumber + 1;
  }

  if (previousNumber === currentNumber) {
    // Last two are the same → keep same
    return currentNumber;
  }

  // Last two are different → increment
  return currentNumber + 1;
}

export function buildNextLinePrefix(
  current: ListPrefix,
  previousNumber: number | null,
  numberedMode: NumberedListMode
): string {
  if (current.type === 'bullet') {
    return `${current.indent}${current.marker} `;
  }

  if (current.type === 'number' && current.number !== undefined) {
    const next = getNextNumber(current.number, previousNumber, numberedMode);
    return `${current.indent}${next}. `;
  }

  return '';
}
