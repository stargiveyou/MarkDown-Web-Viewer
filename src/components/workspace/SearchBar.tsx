'use client';

/**
 * SearchBar -- 검색 입력 필드.
 *
 * - Cmd+K (Mac) / Ctrl+K (기타)로 포커스
 * - Escape로 검색 해제 (입력 초기화 + GridView 복귀)
 * - 300ms 디바운스 후 2자 이상이면 GET /api/search?q=... 호출
 * - 로딩 중 스피너 표시
 * - X 버튼으로 검색어 초기화
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Loader2, X } from 'lucide-react';
import { apiFetch } from '@/lib/fetcher';
import type { SearchResult, SearchResponse } from '@/types/api';

export interface SearchBarProps {
  /** 검색 결과를 부모에 전달. 결과가 있으면 부모가 GridView 대신 SearchResults를 렌더. */
  onResults: (results: SearchResult[], query: string, indexing: boolean) => void;
  /** 검색 해제(검색어 비워짐). 부모가 GridView로 복귀. */
  onClear: () => void;
}

export function SearchBar({ onResults, onClear }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  // 디바운스 타이머 ref
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 취소 토큰: 이전 요청이 도착해도 무시하기 위한 카운터
  const reqIdRef = useRef(0);

  // Cmd+K / Ctrl+K 전역 단축키
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 디바운스 검색 실행
  const doSearch = useCallback(
    async (q: string) => {
      const id = ++reqIdRef.current;
      setLoading(true);
      try {
        const data = await apiFetch<SearchResponse>(
          `/api/search?q=${encodeURIComponent(q)}`,
        );
        // 이미 다음 요청이 나갔으면 이 결과는 무시
        if (reqIdRef.current !== id) return;
        onResults(data.results, data.query, data.indexing ?? false);
      } catch {
        // fetcher가 401/429를 자동 처리한다. 그 외 에러는 토스트로 표시됨.
        // 검색 실패 시 결과를 비우지 않고 현재 상태 유지.
      } finally {
        if (reqIdRef.current === id) setLoading(false);
      }
    },
    [onResults],
  );

  // query 변경 시 디바운스 처리
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (query.length < 2) {
      // 2자 미만이면 검색 해제 + 인플라이트 요청 취소
      reqIdRef.current++;
      // onClear와 setLoading은 이벤트 핸들러(handleClear, onChange)에서 처리한다.
      // 여기서는 타이머만 정리한다.
      return;
    }

    timerRef.current = setTimeout(() => {
      doSearch(query);
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, doSearch]);

  /** 검색어 변경 핸들러. 2자 미만이면 즉시 검색 해제. */
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setQuery(value);

    // 2자 미만으로 줄어들면 검색 해제 + 로딩 리셋
    if (value.length < 2) {
      setLoading(false);
      onClear();
    }
  }

  // Escape 키 처리 (input 내에서)
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setQuery('');
      setLoading(false);
      onClear();
      inputRef.current?.blur();
    }
  }

  // 클리어 버튼 클릭
  function handleClear() {
    setQuery('');
    setLoading(false);
    onClear();
    inputRef.current?.focus();
  }

  return (
    <div className="relative flex items-center">
      <div className="pointer-events-none absolute left-2.5 flex items-center">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400 dark:text-zinc-500" />
        ) : (
          <Search className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
        )}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="검색... (Cmd+K)"
        aria-label="문서 검색"
        className="w-40 rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-8 text-sm text-zinc-900 outline-none transition-all placeholder:text-zinc-400 focus:w-56 focus-visible:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus-visible:border-zinc-100 dark:focus-visible:ring-zinc-100/20 md:w-48 md:focus:w-64"
      />
      {query.length > 0 && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="검색어 지우기"
          className="absolute right-2 flex items-center rounded p-0.5 text-zinc-400 transition-colors hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-500 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
