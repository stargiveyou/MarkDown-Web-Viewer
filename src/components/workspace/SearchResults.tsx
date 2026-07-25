'use client';

/**
 * SearchResults -- 검색 결과 카드 목록.
 *
 * - SearchResult[]를 카드로 렌더
 * - snippet 내 [[hl]]...[[/hl]] 마커를 <mark>로 변환 (dangerouslySetInnerHTML 사용 금지)
 * - 카드 클릭 시 /workspace/view?path=... 로 이동
 * - 결과 0건이면 안내 메시지
 * - indexing 상태이면 색인 구축 중 안내
 */

import { useRouter } from 'next/navigation';
import { AlertTriangle, FileText } from 'lucide-react';
import { SNIPPET_MARK } from '@/types/api';
import type { SearchResult } from '@/types/api';
import type { ReactNode } from 'react';

export interface SearchResultsProps {
  query: string;
  results: SearchResult[];
  indexing: boolean;
}

/**
 * snippet 내 [[hl]]...[[/hl]] 구간을 파싱하여 React 엘리먼트로 조립한다.
 * dangerouslySetInnerHTML을 사용하지 않는다.
 */
function parseSnippet(snippet: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let remaining = snippet;
  let key = 0;

  while (remaining.length > 0) {
    const openIdx = remaining.indexOf(SNIPPET_MARK.open);
    if (openIdx === -1) {
      parts.push(remaining);
      break;
    }

    // 마커 앞 텍스트
    if (openIdx > 0) {
      parts.push(remaining.slice(0, openIdx));
    }

    // 마커 뒤 닫는 마커까지
    const afterOpen = remaining.slice(openIdx + SNIPPET_MARK.open.length);
    const closeIdx = afterOpen.indexOf(SNIPPET_MARK.close);
    if (closeIdx === -1) {
      // 닫는 마커 없으면 나머지 텍스트를 그대로 출력
      parts.push(remaining);
      break;
    }

    const highlighted = afterOpen.slice(0, closeIdx);
    parts.push(
      <mark key={key++} className="bg-yellow-200 dark:bg-yellow-700/50 rounded-sm px-0.5">
        {highlighted}
      </mark>,
    );
    remaining = afterOpen.slice(closeIdx + SNIPPET_MARK.close.length);
  }

  return parts;
}

/** epoch ms를 사람이 읽기 좋은 형태로 포맷한다. */
function formatRelativeTime(epochMs: number): string {
  const now = Date.now();
  const diff = now - epochMs;

  if (diff < 0) return '방금';

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return '방금';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;

  // 7일 이상이면 날짜 표시
  const date = new Date(epochMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function SearchResults({ query, results, indexing }: SearchResultsProps) {
  const router = useRouter();

  function handleCardClick(subpath: string) {
    router.push(`/workspace/view?path=${encodeURIComponent(subpath)}`);
  }

  return (
    <div className="space-y-4">
      {/* 검색 결과 건수 */}
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">&quot;{query}&quot;</span>
        {' '}검색 결과 {results.length}건
      </p>

      {/* 색인 구축 중 안내 */}
      {indexing && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-950/20">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-amber-700 dark:text-amber-300">
            색인 구축 중입니다. 일부 결과가 누락될 수 있습니다.
          </p>
        </div>
      )}

      {/* 결과 0건 */}
      {results.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
          <FileText className="mx-auto h-10 w-10 text-zinc-400 dark:text-zinc-600" />
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            검색 결과가 없습니다.
          </p>
        </div>
      )}

      {/* 검색 결과 카드 목록 */}
      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((result) => (
            <button
              key={result.subpath}
              type="button"
              onClick={() => handleCardClick(result.subpath)}
              className="group flex w-full gap-4 rounded-xl border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-zinc-300 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
            >
              {/* 커버 썸네일 (있으면) */}
              {result.coverThumbUrl && (
                <div className="hidden shrink-0 overflow-hidden rounded-lg sm:block">
                  {/* eslint-disable-next-line @next/next/no-img-element -- D2-1: SVG XSS 방어를 위해 <img>만 사용 */}
                  <img
                    src={result.coverThumbUrl}
                    alt=""
                    loading="lazy"
                    className="h-20 w-20 object-cover"
                  />
                </div>
              )}

              {/* 텍스트 영역 */}
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {/* 제목 */}
                <span className="truncate text-sm font-medium text-zinc-900 group-hover:text-zinc-700 dark:text-zinc-100 dark:group-hover:text-zinc-300">
                  {result.title}
                </span>

                {/* 하이라이트된 snippet */}
                {result.snippet && (
                  <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {parseSnippet(result.snippet)}
                  </p>
                )}

                {/* 태그 + 수정일 */}
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {result.tags && result.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {result.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {formatRelativeTime(result.mtime)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
