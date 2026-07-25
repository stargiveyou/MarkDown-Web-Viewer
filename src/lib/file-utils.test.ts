import { describe, expect, it } from 'vitest';

import { buildThumbnailUrl, classifyEntry, extractSnippet, isThumbnailable } from './file-utils';

// ---------------------------------------------------------------------------
// classifyEntry
// ---------------------------------------------------------------------------

describe('classifyEntry', () => {
  it('returns "folder" for directories', () => {
    expect(classifyEntry('Photos', true)).toBe('folder');
  });

  it('returns "markdown" for .md files', () => {
    expect(classifyEntry('README.md', false)).toBe('markdown');
  });

  it('returns "markdown" for .markdown files', () => {
    expect(classifyEntry('notes.markdown', false)).toBe('markdown');
  });

  it('returns "image" for known image extensions', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']) {
      expect(classifyEntry(`photo.${ext}`, false)).toBe('image');
    }
  });

  it('returns "image" case-insensitively', () => {
    expect(classifyEntry('photo.PNG', false)).toBe('image');
    expect(classifyEntry('photo.Jpg', false)).toBe('image');
  });

  it('returns "other" for unknown extensions', () => {
    expect(classifyEntry('data.csv', false)).toBe('other');
    expect(classifyEntry('archive.zip', false)).toBe('other');
  });

  it('returns "other" for files without extension', () => {
    expect(classifyEntry('Makefile', false)).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// isThumbnailable
// ---------------------------------------------------------------------------

describe('isThumbnailable', () => {
  it('returns true for raster images', () => {
    expect(isThumbnailable('photo.png')).toBe(true);
    expect(isThumbnailable('photo.jpg')).toBe(true);
    expect(isThumbnailable('photo.jpeg')).toBe(true);
    expect(isThumbnailable('photo.gif')).toBe(true);
    expect(isThumbnailable('photo.webp')).toBe(true);
  });

  it('returns false for SVG (not reliably resizable by sharp)', () => {
    expect(isThumbnailable('icon.svg')).toBe(false);
  });

  it('returns false for non-image files', () => {
    expect(isThumbnailable('doc.md')).toBe(false);
    expect(isThumbnailable('data.json')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildThumbnailUrl
// ---------------------------------------------------------------------------

describe('buildThumbnailUrl', () => {
  it('builds a properly encoded URL', () => {
    expect(buildThumbnailUrl('photos/sunset.jpg', 400)).toBe(
      '/api/thumbnail?path=photos%2Fsunset.jpg&w=400',
    );
  });

  it('encodes Korean characters', () => {
    const url = buildThumbnailUrl('사진/제주도.png', 200);
    expect(url).toContain('path=');
    expect(url).toContain('&w=200');
    expect(url).toBe(
      `/api/thumbnail?path=${encodeURIComponent('사진/제주도.png')}&w=200`,
    );
  });
});

// ---------------------------------------------------------------------------
// extractSnippet
// ---------------------------------------------------------------------------

describe('extractSnippet', () => {
  it('extracts plain text from markdown', () => {
    const md = '# Hello World\n\nThis is a paragraph.';
    const snippet = extractSnippet(md);
    expect(snippet).toBe('Hello World\nThis is a paragraph.');
  });

  it('strips inline formatting', () => {
    const md = 'This is **bold** and *italic* text.';
    expect(extractSnippet(md)).toBe('This is bold and italic text.');
  });

  it('strips links', () => {
    const md = 'Click [here](https://example.com) to visit.';
    expect(extractSnippet(md)).toBe('Click here to visit.');
  });

  it('strips images', () => {
    const md = '![alt text](image.png)\nSome text below.';
    expect(extractSnippet(md)).toBe('alt text\nSome text below.');
  });

  it('limits to 2 lines', () => {
    const md = 'Line 1\nLine 2\nLine 3\nLine 4';
    expect(extractSnippet(md)).toBe('Line 1\nLine 2');
  });

  it('truncates long lines with ellipsis', () => {
    const long = 'A'.repeat(300);
    const snippet = extractSnippet(long, 100);
    expect(snippet.length).toBeLessThanOrEqual(101); // 100 + ellipsis
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('returns empty string for empty input', () => {
    expect(extractSnippet('')).toBe('');
  });

  it('skips blank lines', () => {
    const md = '\n\n\nActual content\n\nMore content';
    expect(extractSnippet(md)).toBe('Actual content\nMore content');
  });

  it('strips blockquotes', () => {
    const md = '> This is a quote\n> Another line';
    expect(extractSnippet(md)).toBe('This is a quote\nAnother line');
  });

  it('strips list markers', () => {
    const md = '- Item 1\n- Item 2\n- Item 3';
    expect(extractSnippet(md)).toBe('Item 1\nItem 2');
  });
});
