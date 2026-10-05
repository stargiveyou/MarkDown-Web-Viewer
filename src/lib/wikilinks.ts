/**
 * 문서 간 링크 추출·해석 — 서버(색인)와 클라이언트(뷰어)가 함께 쓰는 순수 모듈.
 *
 * 두 종류의 링크를 다룬다.
 *   - 위키링크  `[[문서명]]`, `[[폴더/문서명]]`, `[[문서명#소제목]]`, `[[문서명|보일 이름]]`
 *   - 마크다운 링크 `[글](./다른문서.md)` — 상대 경로의 `.md`/`.markdown`만 문서 링크로 본다
 *
 * 해석 규칙(Obsidian과 같은 방향):
 *   - 위키링크는 **파일명(확장자 제외)** 으로 찾는다. 대소문자는 구분하지 않는다.
 *     같은 이름이 여럿이면 원본과 **같은 폴더** → **경로가 짧은 것** → 사전순으로 고른다.
 *     `/`가 들어 있으면 경로 끝부분 일치로 찾는다.
 *   - 마크다운 링크는 원본 문서 폴더 기준 상대 경로로 해석한다. 루트 밖으로 나가면 버린다.
 *
 * `node:path`를 쓰지 않는다 — 브라우저 번들에도 들어가기 때문이다.
 * 경로는 항상 MARKDOWN_ROOT 기준 POSIX 상대 경로(`toSubpath()` 형식)다.
 * 이 모듈은 문자열만 다루며 파일 시스템에 접근하지 않는다(보안 불변식 2의 검증은 호출부 몫).
 */

export type LinkKind = 'wiki' | 'md';

export interface ExtractedLink {
  kind: LinkKind;
  /**
   * 위키링크: 정규화한 대상 이름(소제목·별칭·`.md` 제거). 해석 전 원문 키.
   * 마크다운 링크: 원본 기준으로 해석한 대상 subpath(존재 여부는 모른다).
   */
  target: string;
  /** 링크가 있던 줄(앞뒤 공백 제거, 최대 `CONTEXT_MAX`자). 백링크 목록에 보여준다. */
  context: string;
}

/** 백링크 문맥 길이 상한. */
const CONTEXT_MAX = 140;

const MARKDOWN_EXT = /\.(md|markdown)$/i;

/**
 * 위키링크가 가리켜도 **문서가 아닌** 첨부 확장자. `[[v1.2]]` 같은 이름을 첨부로 오인하지 않도록
 * "점 뒤 아무 글자"가 아니라 알려진 확장자만 거른다.
 */
const ATTACHMENT_EXT =
  /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|heic|pdf|mp4|mov|webm|mp3|wav|ogg|m4a|zip|csv|xlsx?|docx?|pptx?|canvas|excalidraw)$/i;

/**
 * 위키링크 정규식.
 *   1: `!` (임베드 표시)  2: 대상  3: 별칭
 * 대상에는 `[ ] | # 개행`이 올 수 없다. `#소제목`은 대상에서 떼어낸다.
 */
export const WIKILINK_PATTERN = /(!?)\[\[([^[\]|#\n]+)(?:#[^[\]|\n]*)?(?:\|([^[\]\n]*))?\]\]/g;

/** 인라인 마크다운 링크 `[글](주소 "제목")`. 1: `!`(이미지)  2: 주소 */
const MD_LINK_PATTERN = /(!?)\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

// ---------------------------------------------------------------------------
// 경로 유틸 (POSIX, 루트 기준)
// ---------------------------------------------------------------------------

/** `a/b/../c/./d` → `a/c/d`. 루트 위로 올라가면 `null`. */
export function normalizeSubpath(raw: string): string | null {
  const out: string[] = [];
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

function dirnameOf(subpath: string): string {
  const i = subpath.lastIndexOf('/');
  return i === -1 ? '' : subpath.slice(0, i);
}

function basenameOf(subpath: string): string {
  return subpath.slice(subpath.lastIndexOf('/') + 1);
}

/** 위키링크 비교 키 — 유니코드 정규화(NFC) + 소문자 + `.md` 제거. */
export function wikiKey(name: string): string {
  return name.normalize('NFC').trim().replace(MARKDOWN_EXT, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// 추출
// ---------------------------------------------------------------------------

/**
 * 코드 블록·인라인 코드·frontmatter를 **같은 길이의 공백**으로 지운다.
 * 줄 번호와 위치가 보존되어야 문맥 줄을 그대로 뽑을 수 있다.
 */
function maskNonProse(markdown: string): string {
  let text = markdown;

  // frontmatter — 문서 맨 앞 `---` 블록만
  const fm = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
  if (fm) text = fm[0].replace(/[^\n]/g, ' ') + text.slice(fm[0].length);

  // 펜스 코드 블록 (``` 또는 ~~~)
  text = text.replace(/^(\s*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1?\2[^\n]*$/gm, (m) =>
    m.replace(/[^\n]/g, ' '),
  );

  // 인라인 코드
  text = text.replace(/(`+)[^`\n]+?\1/g, (m) => ' '.repeat(m.length));
  return text;
}

function contextAt(original: string, index: number): string {
  const start = original.lastIndexOf('\n', index - 1) + 1;
  const endRaw = original.indexOf('\n', index);
  const line = original.slice(start, endRaw === -1 ? undefined : endRaw).trim();
  return line.length > CONTEXT_MAX ? `${line.slice(0, CONTEXT_MAX - 1)}…` : line;
}

/** 마크다운 링크 주소를 원본 기준 subpath로 해석한다. 문서 링크가 아니면 `null`. */
export function resolveMarkdownHref(href: string, sourceSubpath: string): string | null {
  // 스킴(http:, mailto: …)·프로토콜 상대(//)·문서 내 앵커는 문서 링크가 아니다.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) {
    return null;
  }

  let clean = href.split('#')[0].split('?')[0];
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // 잘못된 % 인코딩은 원문 그대로 둔다.
  }
  if (!MARKDOWN_EXT.test(clean)) return null;

  // `/a.md`는 저장소 루트 기준, 그 외는 원본 폴더 기준
  const joined = clean.startsWith('/') ? clean : `${dirnameOf(sourceSubpath)}/${clean}`;
  const normalized = normalizeSubpath(joined);
  return normalized ? normalized.normalize('NFC') : null;
}

/**
 * 본문에서 문서 링크를 뽑는다. 같은 (종류, 대상)은 첫 등장 1건만 남긴다.
 *
 * - 코드 블록·인라인 코드·frontmatter 안의 `[[…]]`는 링크가 아니다.
 * - 이미지 임베드 `![[그림.png]]`, `![](a.png)`는 문서 링크가 아니다.
 *   문서 임베드 `![[다른문서]]`는 링크로 센다(Obsidian과 같다).
 */
export function extractLinks(markdown: string, sourceSubpath: string): ExtractedLink[] {
  const masked = maskNonProse(markdown);
  const seen = new Set<string>();
  const links: ExtractedLink[] = [];

  const push = (kind: LinkKind, target: string, index: number) => {
    const key = `${kind}\u0000${target}`;
    if (target === '' || seen.has(key)) return;
    seen.add(key);
    links.push({ kind, target, context: contextAt(markdown, index) });
  };

  for (const m of masked.matchAll(WIKILINK_PATTERN)) {
    const name = m[2].trim();
    // 첨부(그림·PDF 등)를 가리키는 위키링크·임베드는 문서 링크가 아니다.
    if (ATTACHMENT_EXT.test(name)) continue;
    push('wiki', wikiKey(name), m.index ?? 0);
  }

  for (const m of masked.matchAll(MD_LINK_PATTERN)) {
    const [, image, href] = m;
    if (image) continue;
    const resolved = resolveMarkdownHref(href, sourceSubpath);
    if (resolved) push('md', resolved, m.index ?? 0);
  }

  return links;
}

// ---------------------------------------------------------------------------
// 위키링크 해석
// ---------------------------------------------------------------------------

export interface WikiIndex {
  /** 파일명 키 → 그 이름을 가진 문서 subpath들 */
  byName: Map<string, string[]>;
  /** 확장자 없는 전체 경로 키 → subpath (`폴더/문서` 형식 위키링크용) */
  byPath: Map<string, string>;
}

/** 존재하는 문서 목록으로 위키링크 해석용 색인을 만든다. */
export function buildWikiIndex(subpaths: Iterable<string>): WikiIndex {
  const byName = new Map<string, string[]>();
  const byPath = new Map<string, string>();
  for (const sub of subpaths) {
    const nameKey = wikiKey(basenameOf(sub));
    const list = byName.get(nameKey);
    if (list) list.push(sub);
    else byName.set(nameKey, [sub]);
    byPath.set(wikiKey(sub), sub);
  }
  return { byName, byPath };
}

/** 두 경로의 공통 상위 폴더 단계 수. */
function sharedDirDepth(a: string, b: string): number {
  const as = dirnameOf(a).split('/');
  const bs = dirnameOf(b).split('/');
  let n = 0;
  while (n < as.length && n < bs.length && as[n] !== '' && as[n] === bs[n]) n += 1;
  return n;
}

/**
 * 후보 중 원본에 가장 가까운 문서를 고른다:
 * 원본과 공유하는 상위 폴더가 깊은 것 → 경로가 짧은 것 → 사전순.
 * (같은 폴더의 문서가 있으면 공유 깊이가 가장 크므로 자연히 먼저 뽑힌다.)
 */
function pickNearest(candidates: string[], sourceSubpath: string): string {
  if (candidates.length === 1) return candidates[0];
  return [...candidates].sort((a, b) => {
    const shared = sharedDirDepth(b, sourceSubpath) - sharedDirDepth(a, sourceSubpath);
    if (shared !== 0) return shared;
    const depth = a.split('/').length - b.split('/').length;
    if (depth !== 0) return depth;
    return a < b ? -1 : a > b ? 1 : 0;
  })[0];
}

/**
 * 위키링크 대상 키를 실제 문서 subpath로 해석한다. 없으면 `null`(아직 없는 문서).
 *
 * @param targetKey `extractLinks()`가 돌려준 위키링크 `target` (이미 `wikiKey` 형식)
 */
export function resolveWikiTarget(
  targetKey: string,
  sourceSubpath: string,
  index: WikiIndex,
): string | null {
  if (targetKey.includes('/')) {
    const normalized = normalizeSubpath(targetKey);
    if (!normalized) return null;
    const exact = index.byPath.get(normalized);
    if (exact) return exact;
    // 경로 끝부분 일치 (`폴더/문서`가 `상위/폴더/문서`를 가리키는 경우)
    const name = basenameOf(normalized);
    const candidates = (index.byName.get(name) ?? []).filter((sub) =>
      wikiKey(sub).endsWith(`/${normalized}`),
    );
    return candidates.length > 0 ? pickNearest(candidates, sourceSubpath) : null;
  }

  const candidates = index.byName.get(targetKey);
  return candidates && candidates.length > 0 ? pickNearest(candidates, sourceSubpath) : null;
}
