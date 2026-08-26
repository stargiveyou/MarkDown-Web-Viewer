/**
 * 문서 제목 규칙 — 한 곳에서만 정한다.
 *
 * 뷰어의 탭 타이틀, 검색 색인, 캘린더 목록이 같은 제목을 보여야 하므로
 * 서버·클라이언트가 함께 쓰는 순수 모듈로 둔다(`server-only` 금지).
 *
 * 우선순위: frontmatter `title` > 본문 첫 H1 > (호출부가 파일명으로 폴백)
 */

/**
 * 마크다운 문서인지 — 제목을 가질 수 있는 파일인지 판정한다.
 *
 * 이미지·SVG 같은 파일은 제목 개념이 없으므로 언제나 파일명으로 보여야 한다.
 * 색인이 md만 담고 있다는 사실에 기대지 않고, 제목을 붙이는 쪽에서 명시적으로 막는다.
 */
export function isMarkdownName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

/**
 * 본문에서 첫 H1을 찾는다.
 *
 * 코드 블록 안의 `# 주석`을 제목으로 오인하지 않도록 펜스 블록을 먼저 걷어낸다.
 * frontmatter가 붙어 있어도 그 안에는 `# `로 시작하는 줄이 없으므로 그대로 넘겨도 된다.
 */
export function firstHeading(markdown: string): string | null {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '');
  const heading = withoutCode.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : null;
}

/**
 * frontmatter 블록에서 `title` 값을 읽는다.
 *
 * YAML 파서 없이(클라이언트 번들에 넣지 않으려고) 첫 블록만 훑는다.
 * 서버처럼 이미 파싱된 frontmatter가 있으면 그 값을 쓰고 이 함수는 건너뛴다.
 */
export function frontmatterTitle(markdown: string): string | null {
  const block = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return null;

  const title = block[1].match(/^title:\s*(['"]?)(.+?)\1\s*$/m);
  return title ? title[2].trim() : null;
}

/**
 * 마크다운 원문에서 문서 제목을 뽑는다.
 * 둘 다 없으면 `null` — 호출부가 파일명으로 대체한다.
 */
export function extractDocTitle(markdown: string): string | null {
  return frontmatterTitle(markdown) || firstHeading(markdown);
}
