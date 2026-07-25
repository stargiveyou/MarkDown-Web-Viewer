/**
 * 파일 타입 분류·스니펫 추출·썸네일 URL 빌더.
 *
 * GridView 카드 렌더링과 /api/files 응답 구성에 쓰인다.
 */

import 'server-only';

import type { EntryType } from '@/types/api';

// ---------------------------------------------------------------------------
// 확장자 분류
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);

/** sharp가 처리할 수 있는 래스터 이미지(SVG 제외). */
const THUMBNAIL_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** 파일/디렉터리의 `EntryType`을 결정한다. */
export function classifyEntry(name: string, isDirectory: boolean): EntryType {
  if (isDirectory) return 'folder';
  const ext = extOf(name);
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return 'other';
}

/** sharp 리사이즈가 가능한 래스터 이미지인지 확인한다. */
export function isThumbnailable(name: string): boolean {
  return THUMBNAIL_EXTENSIONS.has(extOf(name));
}

// ---------------------------------------------------------------------------
// 썸네일 URL
// ---------------------------------------------------------------------------

/** /api/thumbnail URL을 생성한다. `subpath`는 MARKDOWN_ROOT 기준 상대 경로. */
export function buildThumbnailUrl(subpath: string, width: number): string {
  return `/api/thumbnail?path=${encodeURIComponent(subpath)}&w=${width}`;
}

// ---------------------------------------------------------------------------
// 마크다운 스니펫
// ---------------------------------------------------------------------------

/**
 * 마크다운 본문에서 구문을 제거하고 최대 `maxLength`자, 2줄까지 추출한다.
 * gray-matter 파싱 후의 `content`(frontmatter 제거 완료)를 넘기면 된다.
 */
export function extractSnippet(markdownBody: string, maxLength = 200): string {
  const lines = markdownBody
    .split('\n')
    .map((l) => stripMarkdownSyntax(l).trim())
    .filter((l) => l.length > 0);

  let result = '';
  let lineCount = 0;

  for (const line of lines) {
    if (lineCount >= 2) break;
    const remaining = maxLength - result.length;
    if (remaining <= 0) break;

    if (result.length > 0) result += '\n';
    result += line.length > remaining ? line.slice(0, remaining) + '…' : line;
    lineCount += 1;
  }

  return result;
}

/** 마크다운 인라인/블록 구문을 대략적으로 제거한다. */
function stripMarkdownSyntax(line: string): string {
  return (
    line
      // headings
      .replace(/^#{1,6}\s+/, '')
      // images ![alt](url)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // links [text](url)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // bold/italic
      .replace(/(\*{1,3}|_{1,3})(.+?)\1/g, '$2')
      // strikethrough
      .replace(/~~(.+?)~~/g, '$1')
      // inline code
      .replace(/`([^`]+)`/g, '$1')
      // blockquotes
      .replace(/^>\s?/gm, '')
      // horizontal rules
      .replace(/^[-*_]{3,}\s*$/g, '')
      // list markers
      .replace(/^[\s]*[-+*]\s+/, '')
      .replace(/^[\s]*\d+\.\s+/, '')
  );
}
