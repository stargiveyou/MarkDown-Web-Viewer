'use client';

/**
 * 뷰어 목차(TOC) 사이드바 -- 마크다운 원문에서 제목을 파싱해 앵커 목록을 렌더한다.
 *
 * - rehype-slug와 동일한 github-slugger로 id를 생성하므로 앵커가 본문과 항상 일치한다.
 * - IntersectionObserver로 현재 화면에 보이는 섹션을 하이라이트한다(scroll spy).
 * - xl 미만 화면에서는 숨긴다 (본문 가독성 우선).
 * - xl 이상에서는 화면 왼쪽 끝에 고정 레일로 붙어 본문 폭을 최대한 양보한다.
 */

import { useEffect, useMemo, useState } from 'react';
import GithubSlugger from 'github-slugger';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

/** 마크다운 원문에서 ATX 제목(#~######)을 추출한다. */
function extractHeadings(markdown: string): TocItem[] {
  let source = markdown;

  // frontmatter 제거
  source = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  // fenced code block 제거 (코드 내부의 #이 제목으로 잡히는 것 방지)
  source = source.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1\s*$/gm, '');

  const slugger = new GithubSlugger();
  const items: TocItem[] = [];
  const headingRegex = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(source)) !== null) {
    const level = match[1].length;
    // 인라인 마크다운 표기를 걷어내 렌더된 텍스트와 근사시킨다
    const text = match[2]
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .trim();
    if (!text) continue;
    items.push({ id: slugger.slug(text), text, level });
  }
  return items;
}

export function TocSidebar({ content }: { content: string }) {
  const items = useMemo(() => extractHeadings(content), [content]);
  const [activeId, setActiveId] = useState('');

  useEffect(() => {
    if (items.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      // 상단 sticky 헤더(약 3.5rem) 아래 ~25% 지점에 들어온 제목을 활성으로 본다
      { rootMargin: '-64px 0px -70% 0px', threshold: 0 },
    );

    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  const minLevel = Math.min(...items.map((item) => item.level));

  return (
    <aside
      className="hidden w-64 shrink-0 border-r border-zinc-800 xl:block"
      aria-label="목차"
    >
      {/* 헤더(3.5rem) 바로 아래에 붙는 좌측 레일. 본문과 독립적으로 스크롤한다. */}
      <nav className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto px-4 py-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          목차
        </p>
        <ul className="space-y-1 border-l border-zinc-800 text-sm">
          {items.map((item, index) => (
            <li key={`${item.id}-${index}`}>
              <a
                href={`#${item.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  document
                    .getElementById(item.id)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  history.replaceState(null, '', `#${item.id}`);
                  setActiveId(item.id);
                }}
                className={`block truncate border-l-2 py-1 pr-2 transition-colors ${
                  activeId === item.id
                    ? 'border-amber-500 font-medium text-amber-400'
                    : 'border-transparent text-zinc-500 hover:text-zinc-200'
                }`}
                style={{ paddingLeft: `${(item.level - minLevel) * 12 + 12}px` }}
                title={item.text}
              >
                {item.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
