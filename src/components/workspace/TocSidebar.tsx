'use client';

/**
 * 뷰어 목차(TOC) 사이드바 -- 렌더된 본문의 제목 엘리먼트에서 직접 목차를 만든다.
 *
 * - 마크다운 원문을 따로 파싱하지 않고 rehype-slug가 실제로 붙인 id를 그대로 쓴다.
 *   원문 파싱과 렌더 결과가 어긋나는 경우(setext 제목, 제목 속 HTML, frontmatter 오인식 등)
 *   앵커가 존재하지 않아 클릭이 먹통이 되는데, DOM에서 읽으면 그 틈이 사라진다.
 * - MarkdownHooks는 비동기로 렌더되므로 MutationObserver로 본문이 채워지는 시점을 기다린다.
 * - 이동은 브라우저 기본 프래그먼트 내비게이션에 맡긴다. history.replaceState()를 부르면
 *   App Router가 패치해 둔 구현이 이를 히스토리 복원 내비게이션으로 처리해서
 *   진행 중이던 스크롤을 되돌리거나 하드 내비게이션(새로고침)을 일으킨다.
 * - IntersectionObserver로 현재 화면에 보이는 섹션을 하이라이트한다(scroll spy).
 * - xl 미만 화면에서는 숨긴다 (본문 가독성 우선).
 * - xl 이상에서는 화면 왼쪽 끝에 고정 레일로 붙어 본문 폭을 최대한 양보한다.
 */

import { useEffect, useRef, useState } from 'react';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

const HEADING_SELECTOR = 'h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]';

function sameItems(a: TocItem[], b: TocItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, i) => item.id === b[i].id && item.text === b[i].text)
  );
}

export function TocSidebar({
  content,
  containerId = 'doc-article',
}: {
  /** 본문 원문. 파싱에는 쓰지 않고, 문서가 바뀌었을 때 다시 훑는 신호로만 쓴다. */
  content: string;
  containerId?: string;
}) {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const hashApplied = useRef(false);

  // 본문이 (비동기로) 그려지거나 바뀔 때마다 제목을 다시 읽는다.
  useEffect(() => {
    const container = document.getElementById(containerId);
    if (!container) return;

    let frame = 0;

    const read = () => {
      frame = 0;
      const next = Array.from(
        container.querySelectorAll<HTMLElement>(HEADING_SELECTOR),
      )
        .map((el) => ({
          id: el.id,
          text: (el.textContent || '').trim(),
          level: Number(el.tagName.slice(1)),
        }))
        .filter((item) => item.id && item.text);
      setItems((prev) => (sameItems(prev, next) ? prev : next));
    };

    // mermaid·코드 하이라이트가 DOM을 계속 건드리므로 프레임 단위로 묶는다.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(read);
    };

    read();
    const observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [containerId, content]);

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

  // 해시가 붙은 URL로 바로 들어온 경우. 본문이 늦게 그려져 브라우저의 자동 이동은
  // 이미 실패한 뒤이므로, 제목이 생긴 다음 한 번만 직접 맞춰준다.
  useEffect(() => {
    if (hashApplied.current || items.length === 0) return;
    hashApplied.current = true;

    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    // 하이라이트는 아래 scroll spy가 이어서 잡아준다.
    el.scrollIntoView({ block: 'start' });
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
                href={`#${encodeURIComponent(item.id)}`}
                onClick={() => setActiveId(item.id)}
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
