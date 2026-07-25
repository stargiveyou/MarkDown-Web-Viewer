'use client';

/**
 * TagBar -- 수평 스크롤 태그 칩 바.
 *
 * - "전체" 칩이 맨 앞 (필터 해제용, onTagSelect(null))
 * - 각 칩: 태그명 (count) 형태
 * - 활성 태그: 배경 반전
 * - 태그가 없으면 렌더하지 않음 (return null)
 */

import type { TagCount } from '@/types/api';

export interface TagBarProps {
  tags: TagCount[];
  /** 현재 활성 태그. null이면 "전체" 선택 상태. */
  activeTag: string | null;
  onTagSelect: (tag: string | null) => void;
}

export function TagBar({ tags, activeTag, onTagSelect }: TagBarProps) {
  if (tags.length === 0) return null;

  return (
    <nav
      aria-label="태그 필터"
      className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin"
    >
      {/* "전체" 칩 */}
      <button
        type="button"
        onClick={() => onTagSelect(null)}
        className={chipClass(activeTag === null)}
      >
        전체
      </button>

      {/* 태그 칩 */}
      {tags.map(({ tag, count }) => (
        <button
          key={tag}
          type="button"
          onClick={() => onTagSelect(tag)}
          className={chipClass(activeTag === tag)}
        >
          {tag}
          <span className="ml-1 opacity-60">({count})</span>
        </button>
      ))}
    </nav>
  );
}

/** 활성/비활성 칩 클래스 생성 */
function chipClass(active: boolean): string {
  const base =
    'inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 whitespace-nowrap';

  if (active) {
    return `${base} bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900`;
  }
  return `${base} bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700`;
}
