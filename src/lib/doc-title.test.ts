import { describe, expect, it } from 'vitest';

import { extractDocTitle, firstHeading, frontmatterTitle, isMarkdownName } from './doc-title';

describe('frontmatterTitle', () => {
  it('reads a quoted title', () => {
    expect(frontmatterTitle('---\ntitle: "제주 여행"\ntags: [a]\n---\n\n# 본문')).toBe('제주 여행');
  });

  it('reads an unquoted title', () => {
    expect(frontmatterTitle('---\ntitle: 제주 여행\n---\n')).toBe('제주 여행');
  });

  it('returns null without frontmatter', () => {
    expect(frontmatterTitle('# 제목만 있음')).toBeNull();
  });

  it('returns null when the block has no title key', () => {
    expect(frontmatterTitle('---\ntags: [a]\n---\n# 제목')).toBeNull();
  });
});

describe('firstHeading', () => {
  it('takes the first H1', () => {
    expect(firstHeading('# 첫 제목\n\n# 두 번째')).toBe('첫 제목');
  });

  it('ignores a comment inside a fenced code block', () => {
    const markdown = '```py\n# 이건 주석\n```\n\n# 진짜 제목';

    expect(firstHeading(markdown)).toBe('진짜 제목');
  });

  it('ignores deeper headings', () => {
    expect(firstHeading('## 소제목\n\n# 제목')).toBe('제목');
  });

  it('returns null when there is no H1', () => {
    expect(firstHeading('본문만 있습니다.\n\n## 소제목')).toBeNull();
  });
});

describe('extractDocTitle', () => {
  it('prefers frontmatter over the first heading', () => {
    expect(extractDocTitle('---\ntitle: 정해진 제목\n---\n\n# 본문 제목')).toBe('정해진 제목');
  });

  it('falls back to the first heading', () => {
    expect(extractDocTitle('---\ntags: [a]\n---\n\n# 본문 제목')).toBe('본문 제목');
  });

  it('returns null so the caller can use the filename', () => {
    expect(extractDocTitle('제목이 없는 메모')).toBeNull();
  });
});

describe('isMarkdownName', () => {
  it('accepts .md and .markdown', () => {
    expect(isMarkdownName('note.md')).toBe(true);
    expect(isMarkdownName('note.markdown')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isMarkdownName('NOTE.MD')).toBe(true);
  });

  it('rejects images and other files', () => {
    expect(isMarkdownName('diagram.svg')).toBe(false);
    expect(isMarkdownName('photo.png')).toBe(false);
    expect(isMarkdownName('archive.zip')).toBe(false);
  });

  it('rejects a name that merely contains md', () => {
    expect(isMarkdownName('md')).toBe(false);
    expect(isMarkdownName('readme.md.png')).toBe(false);
  });
});
