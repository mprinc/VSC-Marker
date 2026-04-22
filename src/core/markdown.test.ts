import { describe, it, expect } from 'vitest';
import {
  wrapWithLink, wrapWithImage,
  findLinkAround,
  isFilePath, shouldPasteAsLink, shouldUseRelativePath, RelativePathMode, filePathToMarkdownUrl,
  isUrl,
  sanitizeFilename, buildImageFilename,
  detectDelimiter, parseTextAsTable, analyzeText, generateMarkdownTable, getDelimiterLabel,
  toggleCodeSpan, toggleCodeBlock,
  getHeadingLevel, setHeadingLevel,
  toggleTaskCheck,
  indentLine, outdentLine,
  toggleWrap, toggleHtmlWrap,
  findWrapperAround, findHtmlWrapperAround,
  parseListPrefix, getNextNumber, buildNextLinePrefix,
} from './markdown';

// ─── wrapWithLink / wrapWithImage ────────────────────────────────────

describe('wrapWithLink', () => {
  it('wraps text with markdown link', () => {
    expect(wrapWithLink('click here', 'https://example.com'))
      .toBe('[click here](https://example.com)');
  });

  it('handles empty text', () => {
    expect(wrapWithLink('', 'https://x.com')).toBe('[](https://x.com)');
  });
});

describe('wrapWithImage', () => {
  it('wraps text with markdown image', () => {
    expect(wrapWithImage('photo', 'img.png')).toBe('![photo](img.png)');
  });
});

// ─── findLinkAround ──────────────────────────────────────────────────

describe('findLinkAround', () => {
  it('finds a link when cursor is on the text part', () => {
    const line = 'see [hello](https://x.com) here';
    const match = findLinkAround(line, 6); // on 'e' in hello
    expect(match).not.toBeNull();
    expect(match!.text).toBe('hello');
    expect(match!.url).toBe('https://x.com');
    expect(match!.isImage).toBe(false);
  });

  it('finds a link when cursor is on the URL part', () => {
    const line = '[hello](https://x.com)';
    const match = findLinkAround(line, 15);
    expect(match).not.toBeNull();
    expect(match!.url).toBe('https://x.com');
  });

  it('returns null when cursor is outside any link', () => {
    const line = 'no link here';
    expect(findLinkAround(line, 3)).toBeNull();
  });

  it('finds an image link', () => {
    const line = '![alt](img.png)';
    const match = findLinkAround(line, 3);
    expect(match).not.toBeNull();
    expect(match!.isImage).toBe(true);
    expect(match!.text).toBe('alt');
    expect(match!.url).toBe('img.png');
  });

  it('returns correct textStart/textEnd for link', () => {
    const line = '[hello](https://x.com)';
    const match = findLinkAround(line, 3);
    expect(match!.textStart).toBe(1);   // after [
    expect(match!.textEnd).toBe(6);     // before ]
  });

  it('returns correct textStart/textEnd for image', () => {
    const line = '![alt text](img.png)';
    const match = findLinkAround(line, 4);
    expect(match!.textStart).toBe(2);   // after ![
    expect(match!.textEnd).toBe(10);    // before ]
  });

  it('finds second link on the same line', () => {
    const line = '[a](x.com) [b](y.com)';
    const match = findLinkAround(line, 13);
    expect(match!.text).toBe('b');
    expect(match!.url).toBe('y.com');
  });

  it('handles link with empty text', () => {
    const line = '[](https://x.com)';
    const match = findLinkAround(line, 0);
    expect(match).not.toBeNull();
    expect(match!.text).toBe('');
    expect(match!.textStart).toBe(1);
    expect(match!.textEnd).toBe(1);
  });
});

// ─── isFilePath ──────────────────────────────────────────────────────

describe('isFilePath', () => {
  it('detects absolute Unix paths', () => {
    expect(isFilePath('/Users/mprinc/file.ts')).toBe(true);
    expect(isFilePath('/etc/hosts')).toBe(true);
  });

  it('rejects single-segment absolute paths', () => {
    expect(isFilePath('/api')).toBe(false);
  });

  it('detects home-relative paths', () => {
    expect(isFilePath('~/Documents/file.md')).toBe(true);
  });

  it('rejects bare ~/', () => {
    expect(isFilePath('~/')).toBe(false);
  });

  it('detects Windows absolute paths', () => {
    expect(isFilePath('C:\\Users\\file.ts')).toBe(true);
    expect(isFilePath('D:/projects/app.js')).toBe(true);
  });

  it('detects relative ./ and ../ paths', () => {
    expect(isFilePath('./src/main.ts')).toBe(true);
    expect(isFilePath('../lib/utils.js')).toBe(true);
  });

  it('detects paths with separator and extension', () => {
    expect(isFilePath('src/core/markdown.ts')).toBe(true);
    expect(isFilePath('lib\\helpers.js')).toBe(true);
  });

  it('rejects URLs', () => {
    expect(isFilePath('https://example.com/path')).toBe(false);
    expect(isFilePath('http://localhost:3000')).toBe(false);
    expect(isFilePath('ftp://files.example.com')).toBe(false);
  });

  it('rejects plain text without separators', () => {
    expect(isFilePath('hello world')).toBe(false);
    expect(isFilePath('justAWord')).toBe(false);
  });

  it('rejects multiline text', () => {
    expect(isFilePath('/path/to/file\nmore text')).toBe(false);
  });

  it('rejects path-like text without extension and without absolute prefix', () => {
    expect(isFilePath('some/directory/')).toBe(false);
  });

  it('detects bare filenames with any extension', () => {
    expect(isFilePath('INSTALL_PUZZLES.md')).toBe(true);
    expect(isFilePath('config.json')).toBe(true);
    expect(isFilePath('README.md')).toBe(true);
    expect(isFilePath('app.ts')).toBe(true);
    expect(isFilePath('INSTALL.c')).toBe(true);
    expect(isFilePath('INSTALL.py')).toBe(true);
  });

  it('detects IPs and domains as file-like', () => {
    expect(isFilePath('192.168.1.1')).toBe(true);
    expect(isFilePath('example.com')).toBe(true);
  });

  it('detects bare filenames (link requires explicit selection in smartPaste)', () => {
    // isFilePath returns true, but smartPaste only creates a link
    // when text is explicitly selected — no word-under-cursor auto-select
    expect(isFilePath('BUILD.md')).toBe(true);
    expect(isFilePath('package.json')).toBe(true);
  });

  it('rejects text without any dot', () => {
    expect(isFilePath('Makefile')).toBe(false);
    expect(isFilePath('justAWord')).toBe(false);
  });
});

// ─── shouldPasteAsLink (paste decision logic) ────────────────────────

describe('shouldPasteAsLink', () => {
  // URLs always trigger link creation, regardless of selection
  it('returns true for URL with explicit selection', () => {
    expect(shouldPasteAsLink('https://example.com', true)).toBe(true);
  });

  it('returns true for URL without selection (word-under-cursor OK)', () => {
    expect(shouldPasteAsLink('https://example.com', false)).toBe(true);
  });

  // File paths require explicit selection
  it('returns true for absolute file path WITH explicit selection', () => {
    expect(shouldPasteAsLink('/Users/mprinc/path/README.md', true)).toBe(true);
  });

  it('returns false for absolute file path WITHOUT selection (no auto word select)', () => {
    expect(shouldPasteAsLink('/Users/mprinc/path/README.md', false)).toBe(false);
  });

  it('returns true for bare filename WITH explicit selection', () => {
    expect(shouldPasteAsLink('README.md', true)).toBe(true);
  });

  it('returns false for bare filename WITHOUT selection', () => {
    expect(shouldPasteAsLink('README.md', false)).toBe(false);
  });

  it('returns true for relative path WITH explicit selection', () => {
    expect(shouldPasteAsLink('./src/main.ts', true)).toBe(true);
  });

  // Edge cases
  it('returns false for empty clipboard', () => {
    expect(shouldPasteAsLink('', true)).toBe(false);
    expect(shouldPasteAsLink('  ', true)).toBe(false);
  });

  it('returns false for plain text (neither URL nor file path)', () => {
    expect(shouldPasteAsLink('hello world', true)).toBe(false);
    expect(shouldPasteAsLink('just text', false)).toBe(false);
  });

  it('handles clipboard with surrounding whitespace', () => {
    expect(shouldPasteAsLink('  https://example.com  ', false)).toBe(true);
    expect(shouldPasteAsLink('  /Users/mprinc/file.ts  ', true)).toBe(true);
  });
});

// ─── shouldUseRelativePath (Cmd+V vs Cmd+Alt+V) ─────────────────────

describe('shouldUseRelativePath', () => {
  describe('mode: auto (default) — uses workspace membership', () => {
    it('Cmd+V, file in workspace → relative', () => {
      expect(shouldUseRelativePath('auto', false, true)).toBe(true);
    });

    it('Cmd+V, file outside workspace → absolute', () => {
      expect(shouldUseRelativePath('auto', false, false)).toBe(false);
    });

    it('Cmd+Alt+V, file in workspace → absolute (inverted)', () => {
      expect(shouldUseRelativePath('auto', true, true)).toBe(false);
    });

    it('Cmd+Alt+V, file outside workspace → relative (inverted)', () => {
      expect(shouldUseRelativePath('auto', true, false)).toBe(true);
    });
  });

  describe('mode: always — always relative', () => {
    it('Cmd+V → relative regardless of workspace', () => {
      expect(shouldUseRelativePath('always', false, false)).toBe(true);
      expect(shouldUseRelativePath('always', false, true)).toBe(true);
    });

    it('Cmd+Alt+V → absolute (inverted)', () => {
      expect(shouldUseRelativePath('always', true, false)).toBe(false);
      expect(shouldUseRelativePath('always', true, true)).toBe(false);
    });
  });

  describe('mode: never — always absolute', () => {
    it('Cmd+V → absolute regardless of workspace', () => {
      expect(shouldUseRelativePath('never', false, true)).toBe(false);
      expect(shouldUseRelativePath('never', false, false)).toBe(false);
    });

    it('Cmd+Alt+V → relative (inverted)', () => {
      expect(shouldUseRelativePath('never', true, true)).toBe(true);
      expect(shouldUseRelativePath('never', true, false)).toBe(true);
    });
  });
});

// ─── filePathToMarkdownUrl ───────────────────────────────────────────

describe('filePathToMarkdownUrl', () => {
  it('prepends file:// for absolute Unix paths', () => {
    expect(filePathToMarkdownUrl('/Users/mprinc/file.ts'))
      .toBe('file:///Users/mprinc/file.ts');
  });

  it('prepends file:/// for Windows paths and normalizes backslashes', () => {
    expect(filePathToMarkdownUrl('C:\\Users\\file.ts'))
      .toBe('file:///C:/Users/file.ts');
  });

  it('encodes spaces', () => {
    expect(filePathToMarkdownUrl('/path/My Documents/file.ts'))
      .toBe('file:///path/My%20Documents/file.ts');
  });

  it('encodes parentheses', () => {
    expect(filePathToMarkdownUrl('/path/(files)/test.ts'))
      .toBe('file:///path/%28files%29/test.ts');
  });

  it('encodes existing percent signs first', () => {
    expect(filePathToMarkdownUrl('/path/100%done/file.ts'))
      .toBe('file:///path/100%25done/file.ts');
  });

  it('leaves relative paths without file:// prefix', () => {
    expect(filePathToMarkdownUrl('src/main.ts')).toBe('src/main.ts');
    expect(filePathToMarkdownUrl('./src/main.ts')).toBe('./src/main.ts');
  });
});

// ─── isUrl ───────────────────────────────────────────────────────────

describe('isUrl', () => {
  it('accepts http URLs', () => {
    expect(isUrl('http://example.com')).toBe(true);
  });

  it('accepts https URLs', () => {
    expect(isUrl('https://example.com/path?q=1')).toBe(true);
  });

  it('rejects ftp URLs', () => {
    expect(isUrl('ftp://files.com')).toBe(false);
  });

  it('rejects plain text', () => {
    expect(isUrl('not a url')).toBe(false);
  });

  it('rejects file paths', () => {
    expect(isUrl('/Users/mprinc/file.ts')).toBe(false);
  });
});

// ─── sanitizeFilename / buildImageFilename ───────────────────────────

describe('sanitizeFilename', () => {
  it('lowercases and removes special chars', () => {
    expect(sanitizeFilename('Hello World!')).toBe('hello-world');
  });

  it('keeps Cyrillic characters', () => {
    expect(sanitizeFilename('Слика тест')).toBe('слика-тест');
  });

  it('collapses multiple dashes', () => {
    expect(sanitizeFilename('a--b---c')).toBe('a-b-c');
  });

  it('trims leading/trailing dashes', () => {
    expect(sanitizeFilename('--hello--')).toBe('hello');
  });
});

describe('buildImageFilename', () => {
  it('builds filename from alt text', () => {
    expect(buildImageFilename('My Photo')).toBe('my-photo.png');
  });

  it('uses custom extension', () => {
    expect(buildImageFilename('screenshot', 'jpg')).toBe('screenshot.jpg');
  });

  it('falls back to "image" for empty text', () => {
    expect(buildImageFilename('')).toBe('image.png');
  });
});

// ─── Table functions ─────────────────────────────────────────────────

describe('getDelimiterLabel', () => {
  it('returns human-readable labels', () => {
    expect(getDelimiterLabel('tab')).toBe('Tab');
    expect(getDelimiterLabel('comma')).toBe('Comma (,)');
    expect(getDelimiterLabel('pipe')).toBe('Pipe (|)');
    expect(getDelimiterLabel('semicolon')).toBe('Semicolon (;)');
  });
});

describe('detectDelimiter', () => {
  it('detects tabs', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('tab');
  });

  it('detects commas', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe('comma');
  });

  it('detects semicolons', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe('semicolon');
  });

  it('detects pipes', () => {
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('pipe');
  });

  it('returns comma for empty text', () => {
    expect(detectDelimiter('')).toBe('comma');
  });
});

describe('parseTextAsTable', () => {
  it('parses CSV', () => {
    const result = parseTextAsTable('a,b,c\n1,2,3', 'comma');
    expect(result).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('parses pipe-delimited and trims leading/trailing empties', () => {
    const result = parseTextAsTable('|a|b|\n|1|2|', 'pipe');
    expect(result).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('skips empty lines', () => {
    const result = parseTextAsTable('a,b\n\n1,2', 'comma');
    expect(result).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('analyzeText', () => {
  it('detects a valid table', () => {
    const analysis = analyzeText('Name,Age\nAlice,30\nBob,25');
    expect(analysis.isTable).toBe(true);
    expect(analysis.cols).toBe(2);
    expect(analysis.delimiter).toBe('comma');
  });

  it('rejects single-line text', () => {
    expect(analyzeText('just one line').isTable).toBe(false);
  });

  it('rejects inconsistent columns', () => {
    expect(analyzeText('a,b,c\n1,2').isTable).toBe(false);
  });
});

describe('generateMarkdownTable', () => {
  it('generates empty table', () => {
    const table = generateMarkdownTable(2, 1, false);
    const lines = table.split('\n');
    expect(lines.length).toBe(3); // header + separator + 1 row
    expect(lines[0]).toContain('Col 1');
    expect(lines[1]).toMatch(/^[\s|:-]+$/);
  });

  it('generates table with header data', () => {
    const data = [['Name', 'Age'], ['Alice', '30']];
    const table = generateMarkdownTable(2, 1, true, data);
    expect(table).toContain('Name');
    expect(table).toContain('Alice');
  });

  it('generates table without header from data', () => {
    const data = [['a', 'b'], ['c', 'd']];
    const table = generateMarkdownTable(2, 2, false, data);
    expect(table).toContain('Col 1');
    expect(table).toContain('a');
  });
});

// ─── Code wrapping ───────────────────────────────────────────────────

describe('toggleCodeSpan', () => {
  it('wraps text in backticks', () => {
    expect(toggleCodeSpan('code')).toBe('`code`');
  });

  it('unwraps backtick-wrapped text', () => {
    expect(toggleCodeSpan('`code`')).toBe('code');
  });

  it('does not unwrap triple backticks', () => {
    expect(toggleCodeSpan('```code```')).toBe('````code````');
  });
});

describe('toggleCodeBlock', () => {
  it('wraps text in fenced code block', () => {
    expect(toggleCodeBlock('console.log()', 'js')).toBe('```js\nconsole.log()\n```');
  });

  it('unwraps fenced code block', () => {
    expect(toggleCodeBlock('```js\nconsole.log()\n```', 'js')).toBe('console.log()');
  });

  it('uses default language sh', () => {
    expect(toggleCodeBlock('ls -la')).toBe('```sh\nls -la\n```');
  });
});

// ─── Headings ────────────────────────────────────────────────────────

describe('getHeadingLevel', () => {
  it('returns level for H1-H6', () => {
    expect(getHeadingLevel('# Title')).toBe(1);
    expect(getHeadingLevel('## Section')).toBe(2);
    expect(getHeadingLevel('###### Deep')).toBe(6);
  });

  it('returns 0 for non-headings', () => {
    expect(getHeadingLevel('regular text')).toBe(0);
    expect(getHeadingLevel('')).toBe(0);
  });
});

describe('setHeadingLevel', () => {
  it('sets heading level', () => {
    expect(setHeadingLevel('## Hello', 3)).toBe('### Hello');
  });

  it('removes heading when level is 0', () => {
    expect(setHeadingLevel('## Hello', 0)).toBe('Hello');
  });

  it('converts plain text to heading', () => {
    expect(setHeadingLevel('Hello', 1)).toBe('# Hello');
  });

  it('caps at level 6', () => {
    expect(setHeadingLevel('# X', 8)).toBe('###### X');
  });
});

// ─── Task list ───────────────────────────────────────────────────────

describe('toggleTaskCheck', () => {
  it('checks unchecked task', () => {
    expect(toggleTaskCheck('- [ ] todo')).toBe('- [x] todo');
  });

  it('unchecks checked task', () => {
    expect(toggleTaskCheck('- [x] done')).toBe('- [ ] done');
  });

  it('unchecks uppercase X', () => {
    expect(toggleTaskCheck('- [X] done')).toBe('- [ ] done');
  });

  it('converts plain bullet to unchecked task', () => {
    expect(toggleTaskCheck('- item')).toBe('- [ ] item');
  });

  it('handles indented tasks', () => {
    expect(toggleTaskCheck('  - [ ] nested')).toBe('  - [x] nested');
  });

  it('returns unchanged line for non-list text', () => {
    expect(toggleTaskCheck('plain text')).toBe('plain text');
  });
});

// ─── Indentation ─────────────────────────────────────────────────────

describe('indentLine', () => {
  it('adds spaces', () => {
    expect(indentLine('- item', 2)).toBe('  - item');
  });

  it('uses custom tab size', () => {
    expect(indentLine('- item', 4)).toBe('    - item');
  });
});

describe('outdentLine', () => {
  it('removes spaces', () => {
    expect(outdentLine('  - item', 2)).toBe('- item');
  });

  it('does not go below zero indent', () => {
    expect(outdentLine(' - item', 4)).toBe('- item');
  });

  it('returns unindented line unchanged', () => {
    expect(outdentLine('- item', 2)).toBe('- item');
  });
});

// ─── Text formatting ─────────────────────────────────────────────────

describe('toggleWrap', () => {
  it('wraps text', () => {
    expect(toggleWrap('hello', '**')).toBe('**hello**');
  });

  it('unwraps text', () => {
    expect(toggleWrap('**hello**', '**')).toBe('hello');
  });

  it('does not unwrap if text is just wrappers', () => {
    expect(toggleWrap('****', '**')).toBe('********');
  });
});

describe('toggleHtmlWrap', () => {
  it('wraps text with HTML tag', () => {
    expect(toggleHtmlWrap('hello', 'u')).toBe('<u>hello</u>');
  });

  it('unwraps HTML-wrapped text', () => {
    expect(toggleHtmlWrap('<u>hello</u>', 'u')).toBe('hello');
  });
});

// ─── findWrapperAround ───────────────────────────────────────────────

describe('findWrapperAround', () => {
  it('finds ** wrapper around cursor', () => {
    const line = 'some **bold** text';
    const result = findWrapperAround(line, 8, '**');
    expect(result).toEqual([5, 13]);
  });

  it('returns null when cursor is outside wrapper', () => {
    const line = 'some **bold** text';
    expect(findWrapperAround(line, 2, '**')).toBeNull();
  });

  it('finds single-char wrapper', () => {
    const line = 'some *italic* text';
    const result = findWrapperAround(line, 7, '*');
    expect(result).toEqual([5, 13]);
  });
});

describe('findHtmlWrapperAround', () => {
  it('finds <u> wrapper around cursor', () => {
    const line = 'some <u>underline</u> text';
    const result = findHtmlWrapperAround(line, 10, 'u');
    expect(result).toEqual([5, 21]);
  });

  it('returns null when cursor is outside', () => {
    const line = 'some <u>underline</u> text';
    expect(findHtmlWrapperAround(line, 2, 'u')).toBeNull();
  });
});

// ─── List parsing ────────────────────────────────────────────────────

describe('parseListPrefix', () => {
  it('parses bullet list with -', () => {
    const result = parseListPrefix('- item');
    expect(result.type).toBe('bullet');
    expect(result.marker).toBe('-');
    expect(result.isEmpty).toBe(false);
  });

  it('parses bullet list with +', () => {
    const result = parseListPrefix('+ item');
    expect(result.type).toBe('bullet');
    expect(result.marker).toBe('+');
  });

  it('parses indented bullet', () => {
    const result = parseListPrefix('  - nested');
    expect(result.type).toBe('bullet');
    expect(result.indent).toBe('  ');
  });

  it('parses numbered list', () => {
    const result = parseListPrefix('3. third item');
    expect(result.type).toBe('number');
    expect(result.number).toBe(3);
    expect(result.marker).toBe('3.');
  });

  it('detects empty bullet item', () => {
    const result = parseListPrefix('- ');
    expect(result.type).toBe('bullet');
    expect(result.isEmpty).toBe(true);
  });

  it('detects empty numbered item', () => {
    const result = parseListPrefix('1. ');
    expect(result.type).toBe('number');
    expect(result.isEmpty).toBe(true);
  });

  it('returns none for regular text', () => {
    const result = parseListPrefix('just text');
    expect(result.type).toBe('none');
  });
});

// ─── getNextNumber ───────────────────────────────────────────────────

describe('getNextNumber', () => {
  it('increments in increment mode', () => {
    expect(getNextNumber(3, 2, 'increment')).toBe(4);
  });

  it('increments when no previous in auto mode', () => {
    expect(getNextNumber(1, null, 'auto')).toBe(2);
  });

  it('keeps same when previous equals current in auto mode', () => {
    expect(getNextNumber(1, 1, 'auto')).toBe(1);
  });

  it('increments when previous differs from current in auto mode', () => {
    expect(getNextNumber(2, 1, 'auto')).toBe(3);
  });
});

// ─── buildNextLinePrefix ─────────────────────────────────────────────

describe('buildNextLinePrefix', () => {
  it('builds bullet prefix', () => {
    const prefix = buildNextLinePrefix(
      { type: 'bullet', marker: '-', indent: '  ', isEmpty: false },
      null, 'auto'
    );
    expect(prefix).toBe('  - ');
  });

  it('builds numbered prefix with increment', () => {
    const prefix = buildNextLinePrefix(
      { type: 'number', marker: '3.', indent: '', number: 3, isEmpty: false },
      2, 'auto'
    );
    expect(prefix).toBe('4. ');
  });

  it('returns empty string for none type', () => {
    const prefix = buildNextLinePrefix(
      { type: 'none', marker: '', indent: '', isEmpty: true },
      null, 'auto'
    );
    expect(prefix).toBe('');
  });
});
