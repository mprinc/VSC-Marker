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
  parseListPrefix, emptyListItemAction, computeOutdentPrefix, adaptMarkerForLevel, getNextNumber, buildNextLinePrefix,
  findListBounds, renumberList,
  visualIndent,
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

describe('visualIndent', () => {
  it('counts spaces', () => {
    expect(visualIndent('    ', 4)).toBe(4);
  });

  it('counts tabs as tabSize width', () => {
    expect(visualIndent('\t', 4)).toBe(4);
    expect(visualIndent('\t\t', 4)).toBe(8);
  });

  it('handles mixed tabs and spaces', () => {
    expect(visualIndent('\t  ', 4)).toBe(6);
  });

  it('returns 0 for empty string', () => {
    expect(visualIndent('', 4)).toBe(0);
  });
});

describe('indentLine', () => {
  it('adds spaces', () => {
    expect(indentLine('- item', 2)).toBe('  - item');
  });

  it('uses custom tab size', () => {
    expect(indentLine('- item', 4)).toBe('    - item');
  });

  it('adds tab when useTabs is true', () => {
    expect(indentLine('1. item', 4, true)).toBe('\t1. item');
  });

  it('adds tab to already tab-indented line', () => {
    expect(indentLine('\t1. item', 4, true)).toBe('\t\t1. item');
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

  it('removes one tab from tab-indented line', () => {
    expect(outdentLine('\t1. item', 4)).toBe('1. item');
  });

  it('removes one tab from double-tab-indented line', () => {
    expect(outdentLine('\t\t1. item', 4)).toBe('\t1. item');
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

  it('adds italic to bold text', () => {
    expect(toggleWrap('**hello**', '*')).toBe('***hello***');
  });

  it('removes italic from bold+italic text', () => {
    expect(toggleWrap('***hello***', '*')).toBe('**hello**');
  });

  it('adds bold to italic text', () => {
    expect(toggleWrap('*hello*', '**')).toBe('***hello***');
  });

  it('removes bold from bold+italic text', () => {
    expect(toggleWrap('***hello***', '**')).toBe('*hello*');
  });

  it('wraps plain text with italic', () => {
    expect(toggleWrap('hello', '*')).toBe('*hello*');
  });

  it('removes italic from italic text', () => {
    expect(toggleWrap('*hello*', '*')).toBe('hello');
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

// ─── emptyListItemAction ─────────────────────────────────────────────

describe('emptyListItemAction', () => {
  // Root-level empty → 'delete'
  it('deletes empty numbered at root', () => {
    expect(emptyListItemAction('1. ', '')).toBe('delete');
  });
  it('deletes empty bullet at root', () => {
    expect(emptyListItemAction('- ', '')).toBe('delete');
  });

  // Indented empty → 'outdent'
  it('outdents empty indented item (spaces)', () => {
    expect(emptyListItemAction('  1. ', '')).toBe('outdent');
  });
  it('outdents empty indented item (tab)', () => {
    expect(emptyListItemAction('\t- ', '')).toBe('outdent');
  });

  // Non-empty / non-list → 'none'
  it('ignores non-empty list item', () => {
    expect(emptyListItemAction('1. some text', '')).toBe('none');
  });
  it('ignores non-list line', () => {
    expect(emptyListItemAction('just text', '')).toBe('none');
  });

  // CRITICAL: split line (user bug report) → 'none'
  it('ignores split line — cursor line has content', () => {
    expect(emptyListItemAction('5. ', 'Certainly, new and emergent sources (e.g., social networking interactions) have challenged')).toBe('none');
  });

  // Edge cases
  it('whitespace-only cursor line counts as empty', () => {
    expect(emptyListItemAction('1. ', '   ')).toBe('delete');
  });
  it('trailing spaces in prefix counts as empty', () => {
    expect(emptyListItemAction('1.   ', '')).toBe('delete');
  });
});

// ─── computeOutdentPrefix ────────────────────────────────────────────

describe('computeOutdentPrefix', () => {
  it('adapts empty bullet to numbered parent (user scenario: Enter on empty "- ")', () => {
    // User has nested bullet under numbered, presses Enter on empty "    - "
    const lines = [
      '5. **ANALYZE DATA** integrating inductive and deductive strategies',
      '    - **masking the names** of respondents',
      '    - trying to **make sense** of the data.',
      '    - ',  // line 3: empty bullet, will outdent → should become "6. "
    ];
    const parsed = parseListPrefix(lines[3]);
    const result = computeOutdentPrefix(lines, 3, parsed, 4);
    expect(result).toBe('6. ');
  });

  it('adapts empty numbered to bullet parent (reverse direction)', () => {
    const lines = [
      '- Parent bullet item',
      '    1. sub-item one',
      '    2. ',  // line 2: empty numbered, will outdent → should become "- "
    ];
    const parsed = parseListPrefix(lines[2]);
    const result = computeOutdentPrefix(lines, 2, parsed, 4);
    expect(result).toBe('- ');
  });

  it('keeps same type when parent is same type', () => {
    const lines = [
      '- Parent',
      '    - child',
      '    - ',  // empty bullet → outdent to bullet
    ];
    const parsed = parseListPrefix(lines[2]);
    const result = computeOutdentPrefix(lines, 2, parsed, 4);
    expect(result).toBe('- ');
  });

  it('increments parent number correctly', () => {
    const lines = [
      '1. first',
      '2. second',
      '    - sub-bullet',
      '    - ',  // outdent → should be 3.
    ];
    const parsed = parseListPrefix(lines[3]);
    const result = computeOutdentPrefix(lines, 3, parsed, 4);
    expect(result).toBe('3. ');
  });

  it('handles tab indentation', () => {
    const lines = [
      '1. Parent',
      '\t- child',
      '\t- ',
    ];
    const parsed = parseListPrefix(lines[2]);
    const result = computeOutdentPrefix(lines, 2, parsed, 4);
    expect(result).toBe('2. ');
  });

  it('falls back to current marker when no parent found', () => {
    const lines = [
      '    - orphan item',
      '    - ',
    ];
    const parsed = parseListPrefix(lines[1]);
    const result = computeOutdentPrefix(lines, 1, parsed, 4);
    expect(result).toBe('- ');
  });

  it('skips empty lines when looking for parent', () => {
    const lines = [
      '3. Parent item',
      '',
      '    - child',
      '    - ',
    ];
    const parsed = parseListPrefix(lines[3]);
    const result = computeOutdentPrefix(lines, 3, parsed, 4);
    expect(result).toBe('4. ');
  });
});

// ─── adaptMarkerForLevel ─────────────────────────────────────────────

describe('adaptMarkerForLevel', () => {
  it('adapts numbered to bullet after Shift+Tab (user scenario: full list)', () => {
    // User presses Shift+Tab on "3. One helpful way..." which was at 8-space indent.
    // After VS Code outdent it's at 4-space indent, where siblings are bullets.
    const lines = [
      '5. **ANALYZE DATA** integrating inductive and deductive strategies',
      '    - **masking the names** of respondents',
      '    - trying to **make sense** of the data.',
      '    - We analyze the qualitative data',
      '        1. working **inductively** (to engage in meaning-making of the data) from particulars to more general perspectives',
      '        2. working **deductively** to gather evidence to support the themes and the interpretations.',
      '    3. One helpful way to see this process is to recognize it as working through multiple levels of abstraction, starting',
    ];
    // Line 6 was outdented from 8-space to 4-space. Siblings at 4-space are bullets.
    expect(adaptMarkerForLevel(lines, 6, 4))
      .toBe('    - One helpful way to see this process is to recognize it as working through multiple levels of abstraction, starting');
  });

  it('adapts bullet to numbered after Shift+Tab', () => {
    const lines = [
      '1. first item',
      '2. second item',
      '- was indented, now outdented to root',
    ];
    expect(adaptMarkerForLevel(lines, 2, 4)).toBe('3. was indented, now outdented to root');
  });

  it('returns null when same type as siblings', () => {
    const lines = [
      '- first',
      '- second',
    ];
    expect(adaptMarkerForLevel(lines, 1, 4)).toBeNull();
  });

  it('returns null when no siblings found', () => {
    const lines = [
      'plain text',
      '- lonely item',
    ];
    expect(adaptMarkerForLevel(lines, 1, 4)).toBeNull();
  });

  it('returns null for non-list lines', () => {
    const lines = ['just text'];
    expect(adaptMarkerForLevel(lines, 0, 4)).toBeNull();
  });

  it('skips empty lines when looking for siblings', () => {
    const lines = [
      '1. first',
      '',
      '- outdented item',
    ];
    expect(adaptMarkerForLevel(lines, 2, 4)).toBe('2. outdented item');
  });

  it('handles empty list items', () => {
    const lines = [
      '- parent',
      '    1. ',
    ];
    // After outdent, "1. " at root, sibling is "- parent"
    // Since isEmpty, content is ''
    const adapted = adaptMarkerForLevel(
      ['- parent', '1. '], 1, 4
    );
    expect(adapted).toBe('- ');
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

// ─── findListBounds ─────────────────────────────────────────────────

describe('findListBounds', () => {
  it('finds bounds of a simple list', () => {
    const lines = ['1. A', '2. B', '3. C'];
    expect(findListBounds(lines, 1)).toEqual([0, 2]);
  });

  it('stops at blank lines', () => {
    const lines = ['text', '', '1. A', '2. B', '', 'more'];
    expect(findListBounds(lines, 2)).toEqual([2, 3]);
  });

  it('includes nested items and continuation text', () => {
    const lines = [
      '1. A',
      '    1. Sub',
      '    continued',
      '2. B',
    ];
    expect(findListBounds(lines, 0)).toEqual([0, 3]);
  });

  it('single line list', () => {
    const lines = ['text', '1. Only', 'text'];
    expect(findListBounds(lines, 1)).toEqual([1, 1]);
  });
});

// ─── renumberList ───────────────────────────────────────────────────

describe('renumberList', () => {
  it('fixes sequential numbering (increment mode)', () => {
    const lines = ['1. A', '1. B', '5. C'];
    const changes = renumberList(lines, 0, 2, 4, 'increment');
    expect(changes.get(1)).toBe('2. B');
    expect(changes.get(2)).toBe('3. C');
    expect(changes.has(0)).toBe(false); // 1 already correct
  });

  it('keeps same-number pattern in auto mode (1. 1. 1.)', () => {
    const lines = ['1. A', '1. B', '1. C'];
    const changes = renumberList(lines, 0, 2, 4, 'auto');
    expect(changes.size).toBe(0); // all already 1, pattern = keep same
  });

  it('fixes gaps in auto mode when pattern is sequential', () => {
    const lines = ['1. A', '2. B', '5. C', '7. D'];
    const changes = renumberList(lines, 0, 3, 4, 'auto');
    expect(changes.get(2)).toBe('3. C');
    expect(changes.get(3)).toBe('4. D');
  });

  it('renumbers nested list with independent sub-groups', () => {
    const lines = [
      '1. A',
      '    1. Sub1',
      '    3. Sub2',
      '2. B',
      '    1. Sub3',
      '    1. Sub4',
    ];
    const changes = renumberList(lines, 0, 5, 4, 'increment');
    // Top level: 1, 2 → correct
    // First sub-group (under A): 1, 3 → should be 1, 2
    expect(changes.get(2)).toBe('    2. Sub2');
    // Second sub-group (under B): 1, 1 → should be 1, 2
    expect(changes.get(5)).toBe('    2. Sub4');
  });

  it('resets sub-list counters at new parent', () => {
    const lines = [
      '1. A',
      '    1. X',
      '    2. Y',
      '2. B',
      '    5. Z',
    ];
    const changes = renumberList(lines, 0, 4, 4, 'increment');
    // Sub under B: 5 → should be 1 (new parent, counter reset)
    expect(changes.get(4)).toBe('    1. Z');
  });

  it('preserves same-number sub-list in auto mode', () => {
    const lines = [
      '1. A',
      '    1. X',
      '    1. Y',
      '    1. Z',
    ];
    const changes = renumberList(lines, 0, 3, 4, 'auto');
    // Sub-list first=1, second=1 → keep same pattern
    expect(changes.size).toBe(0);
  });

  it('handles tab-indented document', () => {
    const lines = [
      '1. A',
      '\t1. Sub1',
      '\t5. Sub2',
      '2. B',
    ];
    const changes = renumberList(lines, 0, 3, 4, 'increment');
    expect(changes.get(2)).toBe('\t2. Sub2');
  });

  it('handles deeply nested list (3 levels)', () => {
    const lines = [
      '1. A',
      '    1. B',
      '        1. C',
      '        3. D',
      '    2. E',
      '        1. F',
      '2. G',
    ];
    const changes = renumberList(lines, 0, 6, 4, 'increment');
    // Level 0: 1, 2 → ok
    // Level 4 under A: 1, 2 → ok
    // Level 8 under B: 1, 3 → fix to 1, 2
    expect(changes.get(3)).toBe('        2. D');
    // Level 8 under E: 1 → ok (single, counter reset)
    expect(changes.has(5)).toBe(false);
  });

  it('skips bullet items', () => {
    const lines = [
      '1. A',
      '- bullet',
      '3. B',
    ];
    const changes = renumberList(lines, 0, 2, 4, 'increment');
    expect(changes.get(2)).toBe('2. B');
  });

  it('real-world user scenario: full document renumber', () => {
    const lines = [
      '1. Visual workflow language',
      '    1. understand the needs',
      '    2. design and establish',
      '    3. evaluate',
      '        1. CoPI4P facilitators',
      '        2. CoPI4P practitioners',
      '        3. DH researchers',
      '    4. Technical prerequisites',
      '        1. Stabilize TopiChat',
      '        2. Finalize CoLaboFlow',
      '        2. Finalize DataTalks',
      '2. Democratize the systems',
      '    1. understand the needs',
      '        1. hard + expensive',
      '        2. simpler + cheap interviews',
      '        3. simpler + cheap collect',
      '    2. evaluate the usability',
      '        1. CoPI4P facilitators',
      '        1. CoPI4P practitioners',
      '        3. DH researchers',
      '3. Transparency',
      '4. AI as facilitator',
    ];
    const changes = renumberList(lines, 0, 21, 4, 'increment');
    // Fix: line 10 "2. Finalize DataTalks" → "3. Finalize DataTalks"
    expect(changes.get(10)).toBe('        3. Finalize DataTalks');
    // Fix: line 18 "1. CoPI4P practitioners" → "2."
    expect(changes.get(18)).toBe('        2. CoPI4P practitioners');
    // Fix: line 19 "3. DH researchers" → "3." (already correct)
    expect(changes.has(19)).toBe(false);
    // Top level unchanged
    expect(changes.has(0)).toBe(false);
    expect(changes.has(11)).toBe(false);
    expect(changes.has(20)).toBe(false);
    expect(changes.has(21)).toBe(false);
  });

  it('returns empty map when no numbered items', () => {
    const lines = ['- A', '- B', 'text'];
    const changes = renumberList(lines, 0, 2, 4, 'increment');
    expect(changes.size).toBe(0);
  });

  it('renumbers sub-items correctly after mid-list outdent (auto mode)', () => {
    // After outdenting item 3 from sub-list, remaining sub-items form new group
    const lines = [
      '\t3. **Technical prerequisites**',
      '\t\t1. Support ColaboFlow',
      '\t\t2. Finalize ColaboFlow',
      '\t4. Make ColaboFlow lighter',           // was outdented from sub-list
      '\t\t4. Integrate LLM AI tasks',          // should become 1
      '\t\t5. Integrate generative AI',          // should become 2
      '\t\t6. Provide sandbox execution',        // should become 3
    ];
    const changes = renumberList(lines, 0, 6, 4, 'auto');
    expect(changes.get(4)).toBe('\t\t1. Integrate LLM AI tasks');
    expect(changes.get(5)).toBe('\t\t2. Integrate generative AI');
    expect(changes.get(6)).toBe('\t\t3. Provide sandbox execution');
    // Parent level items stay unchanged
    expect(changes.has(0)).toBe(false);
    expect(changes.has(3)).toBe(false);
  });

  it('renumbers sub-items correctly after mid-list outdent (increment mode)', () => {
    const lines = [
      '\t3. **Technical prerequisites**',
      '\t\t1. Support ColaboFlow',
      '\t\t2. Finalize ColaboFlow',
      '\t4. Make ColaboFlow lighter',
      '\t\t4. Integrate LLM AI tasks',
      '\t\t5. Integrate generative AI',
      '\t\t6. Provide sandbox execution',
    ];
    const changes = renumberList(lines, 0, 6, 4, 'increment');
    expect(changes.get(0)).toBe('\t1. **Technical prerequisites**');
    expect(changes.get(3)).toBe('\t2. Make ColaboFlow lighter');
    expect(changes.get(4)).toBe('\t\t1. Integrate LLM AI tasks');
    expect(changes.get(5)).toBe('\t\t2. Integrate generative AI');
    expect(changes.get(6)).toBe('\t\t3. Provide sandbox execution');
  });

  it('preserves 1. 1. 1. pattern in sub-group after parent reset', () => {
    const lines = [
      '1. A',
      '    1. X',
      '    1. Y',
      '2. B',
      '    1. Z',
      '    1. W',
    ];
    const changes = renumberList(lines, 0, 5, 4, 'auto');
    // Both sub-groups have 1,1 pattern → keep same
    expect(changes.size).toBe(0);
  });

  it('new sub-item after Enter+Tab starts at 1, not parent number', () => {
    // User pressed Enter on item 4, then Tab — new line got number 5
    const lines = [
      '1. How visual workflow language...',
      '2. How workflows can democratize...',
      '3. How workflows can be used...',
      '4. **What role AI can play** in',
      '    5. the process of co-creating...',
    ];
    const changes = renumberList(lines, 0, 4, 4, 'auto');
    // Sub-item under 4 should start at 1, not keep 5
    expect(changes.get(4)).toBe('    1. the process of co-creating...');
    // Top-level items unchanged
    expect(changes.has(0)).toBe(false);
    expect(changes.has(1)).toBe(false);
    expect(changes.has(2)).toBe(false);
    expect(changes.has(3)).toBe(false);
  });

  it('single sub-item under parent starts at 1 (increment mode)', () => {
    const lines = [
      '1. Parent',
      '    7. Only child',
    ];
    const changes = renumberList(lines, 0, 1, 4, 'increment');
    expect(changes.get(1)).toBe('    1. Only child');
  });
});
