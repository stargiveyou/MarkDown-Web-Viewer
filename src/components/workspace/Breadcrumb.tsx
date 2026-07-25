'use client';

/**
 * 브레드크럼 내비게이션 -- FilesResponse.breadcrumb 세그먼트를 순서대로 렌더한다.
 *
 * - "Home" 클릭 -> onNavigate(-1) (루트로)
 * - 중간 세그먼트 클릭 -> onNavigate(index) -> path = segments.slice(0, index+1).join('/')
 * - 마지막 세그먼트는 일반 텍스트 (현재 위치)
 * - 빈 배열이면 "Home"만 텍스트로 표시 (루트에 이미 있으므로 링크 아님)
 */

import { ChevronRight } from 'lucide-react';

export interface BreadcrumbProps {
  segments: string[];
  onNavigate: (pathUpTo: number) => void;
}

export function Breadcrumb({ segments, onNavigate }: BreadcrumbProps) {
  // 루트에 있을 때: "Home"만 텍스트로 표시
  if (segments.length === 0) {
    return (
      <nav aria-label="브레드크럼" className="flex items-center gap-1 text-sm">
        <span className="text-zinc-900 dark:text-zinc-100 font-medium">Home</span>
      </nav>
    );
  }

  return (
    <nav aria-label="브레드크럼" className="flex items-center gap-1 text-sm flex-wrap">
      {/* Home 링크 */}
      <button
        type="button"
        onClick={() => onNavigate(-1)}
        className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 rounded"
      >
        Home
      </button>

      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <span key={index} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-600 shrink-0" />
            {isLast ? (
              <span className="text-zinc-900 dark:text-zinc-100 font-medium truncate max-w-48">
                {segment}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(index)}
                className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 rounded truncate max-w-48"
              >
                {segment}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
