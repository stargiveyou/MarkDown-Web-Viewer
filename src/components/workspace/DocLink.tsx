'use client';

/**
 * 뷰어 본문의 `<a>` 렌더러 — 문서 간 링크를 앱 안 이동으로 바꾼다.
 *
 *   - `[[위키링크]]` (remark-wikilinks가 `data-wikilink`를 단 링크)
 *       → `/api/links`가 알려준 실제 문서로 이동. 없는 문서면 점선 "아직 없는 문서" 표시
 *   - 상대 `.md` 링크 → 현재 문서 기준으로 해석해 뷰어로 이동
 *   - 외부 URL → 새 탭 (`noopener noreferrer`)
 *   - 그 밖(`#앵커` 등) → 기본 동작
 *
 * 링크 해석 결과는 컨텍스트로 받는다. 렌더러 함수를 `useMemo` 의존성에 넣으면
 * 링크 정보가 도착할 때 본문 전체가 리마운트되어 스크롤이 무너지기 때문이다.
 */

import Link from 'next/link';
import { createContext, useContext } from 'react';

import { resolveMarkdownHref } from '@/lib/wikilinks';
import type { LinksResponse } from '@/types/api';

export interface DocLinkContextValue {
  /** 현재 문서 subpath — 상대 링크 해석 기준 */
  sourcePath: string;
  /** 서버 해석 결과. 아직 도착 전이면 `null` */
  links: LinksResponse | null;
}

export const DocLinkContext = createContext<DocLinkContextValue>({ sourcePath: '', links: null });

export function viewerHref(subpath: string): string {
  return `/workspace/view?path=${encodeURIComponent(subpath)}`;
}

const INTERNAL_CLASS = 'text-amber-300 decoration-amber-500/50 hover:text-amber-200';
const GHOST_CLASS =
  'cursor-help text-zinc-500 underline decoration-dashed decoration-zinc-600 underline-offset-4';

type AnchorProps = React.ComponentPropsWithoutRef<'a'> & {
  'data-wikilink'?: string;
  node?: unknown;
};

// `node`는 react-markdown이 넘기는 hast 노드다. DOM 속성으로 흘리지 않도록 받아서 버린다.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function DocLink({ href, children, node: _node, ...rest }: AnchorProps) {
  const { sourcePath, links } = useContext(DocLinkContext);
  const wikiKey = rest['data-wikilink'];

  // --- 위키링크 ---------------------------------------------------------------
  if (wikiKey !== undefined) {
    const entry = links?.outgoing.find((l) => l.kind === 'wiki' && l.raw === wikiKey);
    if (entry?.resolved) {
      return (
        <Link href={viewerHref(entry.resolved)} className={INTERNAL_CLASS} title={entry.title}>
          {children}
        </Link>
      );
    }
    // 링크 정보가 아직 없거나(로딩·색인 전) 대상 문서가 없다.
    const pending = links === null;
    return (
      <span
        className={pending ? 'text-zinc-400' : GHOST_CLASS}
        title={pending ? undefined : '아직 없는 문서입니다'}
        data-wikilink={wikiKey}
      >
        {children}
      </span>
    );
  }

  if (typeof href !== 'string' || href === '') {
    return <a {...rest}>{children}</a>;
  }

  // --- 외부 URL ----------------------------------------------------------------
  if (/^https?:\/\//i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }

  // --- 상대 .md 링크 ---------------------------------------------------------------
  const target = resolveMarkdownHref(href, sourcePath);
  if (target) {
    return (
      <Link href={viewerHref(target)} className={INTERNAL_CLASS}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
