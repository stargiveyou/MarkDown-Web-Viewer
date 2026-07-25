'use client';

/**
 * 워크스페이스 메인 페이지 -- /workspace 또는 /workspace?path=subfolder
 *
 * Stage 1 골격(업로드 모달, 로그아웃)을 유지하면서 Stage 2/3에서 확장:
 * - useSearchParams로 path 쿼리 읽기
 * - GET /api/files?path=...&sort=...&tag=... 호출하여 파일 목록 로드
 * - Breadcrumb + GridView 렌더링
 * - 정렬 드롭다운 (mtime/name/size/ctime)
 * - 업로드 성공 후 파일 목록 재조회
 * - Stage 3: 검색 바 + 검색 결과 + 태그 칩 바
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { UploadModal } from '@/components/upload/UploadModal';
import { Breadcrumb } from '@/components/workspace/Breadcrumb';
import { GridView } from '@/components/workspace/GridView';
import { SearchBar } from '@/components/workspace/SearchBar';
import { SearchResults } from '@/components/workspace/SearchResults';
import { TagBar } from '@/components/workspace/TagBar';
import { emitToast } from '@/components/ui/toast-bus';
import { apiFetch, toApiRequestError } from '@/lib/fetcher';
import { Loader2 } from 'lucide-react';
import type {
  FileEntry,
  FilesResponse,
  SearchResult,
  SortKey,
  TagCount,
  TagsResponse,
} from '@/types/api';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'mtime', label: '수정일' },
  { value: 'name', label: '이름 A-Z' },
  { value: 'size', label: '파일 크기' },
  { value: 'ctime', label: '생성일' },
];

/** 파일 목록을 API에서 가져온다. tag 파라미터 지원. */
async function loadFiles(
  path: string,
  sortKey: SortKey,
  tag?: string,
): Promise<FilesResponse> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  params.set('sort', sortKey);
  if (tag) params.set('tag', tag);
  return apiFetch<FilesResponse>(`/api/files?${params.toString()}`);
}

function WorkspacePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentPath = searchParams.get('path') || '';

  const [uploadOpen, setUploadOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>('mtime');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 재조회 트리거용 카운터
  const [refreshKey, setRefreshKey] = useState(0);

  // 검색 상태
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndexing, setSearchIndexing] = useState(false);

  // 태그 상태
  const [tags, setTags] = useState<TagCount[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // path, sort, refreshKey, activeTag 변경 시 목록 재조회
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const data = await loadFiles(currentPath, sort, activeTag ?? undefined);
        if (cancelled) return;
        setEntries(data.entries);
        setBreadcrumb(data.breadcrumb);
        setError('');
      } catch (caught) {
        if (cancelled) return;
        const err = toApiRequestError(caught);
        if (err.code !== 401) {
          setError(err.message);
          emitToast({ message: err.message, variant: 'error' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [currentPath, sort, refreshKey, activeTag]);

  // 마운트 시 + refreshKey 변경 시 태그 목록 조회
  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<TagsResponse>('/api/tags');
        setTags(data.tags);
      } catch {
        // 태그 로딩 실패는 치명적이지 않음 -- 바를 숨기면 된다
      }
    })();
  }, [refreshKey]);

  /**
   * 업로드 성공 훅 지점.
   * Stage 2: refreshKey를 증가시켜 파일 목록을 재조회한다.
   */
  const handleUploaded = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  /** 에러 상태에서 "다시 시도" 클릭. */
  const handleRetry = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // 검색 콜백
  const handleSearchResults = useCallback(
    (results: SearchResult[], query: string, indexing: boolean) => {
      setSearchResults(results);
      setSearchQuery(query);
      setSearchIndexing(indexing);
    },
    [],
  );

  const handleSearchClear = useCallback(() => {
    setSearchResults(null);
    setSearchQuery('');
    setSearchIndexing(false);
  }, []);

  // 태그 선택
  function handleTagSelect(tag: string | null) {
    setActiveTag(tag);
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);

    try {
      await apiFetch<{ ok: true }>('/api/auth/logout', { method: 'POST' });
      router.replace('/login');
      router.refresh();
    } catch (caught) {
      const err = toApiRequestError(caught);
      // 401이면 fetcher가 이미 /login으로 보내는 중이다.
      if (err.code !== 401) {
        emitToast({ message: '로그아웃에 실패했습니다. 다시 시도해 주세요.', variant: 'error' });
        setLoggingOut(false);
      }
    }
  }

  // 브레드크럼 내비게이션
  function handleBreadcrumbNavigate(pathUpTo: number) {
    if (pathUpTo === -1) {
      // 루트로 이동
      router.push('/workspace');
    } else {
      const targetPath = breadcrumb.slice(0, pathUpTo + 1).join('/');
      router.push(`/workspace?path=${encodeURIComponent(targetPath)}`);
    }
  }

  // 폴더 클릭
  function handleFolderClick(subpath: string) {
    router.push(`/workspace?path=${encodeURIComponent(subpath)}`);
  }

  // 파일 클릭
  function handleFileClick(entry: FileEntry) {
    if (entry.type === 'markdown') {
      router.push(`/workspace/view?path=${encodeURIComponent(entry.subpath)}`);
    } else if (entry.type === 'image') {
      // 이미지 새 탭에서 원본 열기
      window.open(`/api/thumbnail?path=${encodeURIComponent(entry.subpath)}&w=1200`, '_blank');
    }
  }

  const isSearchMode = searchResults !== null;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-black/80">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <h1 className="shrink-0 text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Husky Works MDs
          </h1>

          <div className="flex flex-wrap items-center gap-2">
            {/* 검색 바 */}
            <SearchBar onResults={handleSearchResults} onClear={handleSearchClear} />

            {/* 정렬 드롭다운 -- 검색 모드에서는 비활성화 */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              disabled={isSearchMode}
              aria-label="정렬 기준"
              className="rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm text-zinc-700 outline-none focus-visible:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:focus-visible:border-zinc-100 dark:focus-visible:ring-zinc-100/20"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-100"
            >
              업로드
            </button>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-lg border border-zinc-300 px-3.5 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-100"
            >
              {loggingOut ? '로그아웃 중...' : '로그아웃'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {/* 브레드크럼 */}
        <div className="mb-6">
          <Breadcrumb segments={breadcrumb} onNavigate={handleBreadcrumbNavigate} />
        </div>

        {/* 태그 칩 바 -- 검색 모드가 아닐 때만 표시 */}
        {!isSearchMode && tags.length > 0 && (
          <div className="mb-6">
            <TagBar tags={tags} activeTag={activeTag} onTagSelect={handleTagSelect} />
          </div>
        )}

        {/* 검색 모드: SearchResults 표시 */}
        {isSearchMode ? (
          <SearchResults
            query={searchQuery}
            results={searchResults}
            indexing={searchIndexing}
          />
        ) : (
          <>
            {/* 로딩 상태 */}
            {loading && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
                  파일 목록을 불러오는 중...
                </span>
              </div>
            )}

            {/* 에러 상태 */}
            {error && !loading && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center dark:border-red-800/40 dark:bg-red-950/20">
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="mt-4 rounded-lg border border-red-300 px-3.5 py-2 text-sm text-red-700 transition-colors hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/30"
                >
                  다시 시도
                </button>
              </div>
            )}

            {/* 파일 그리드 */}
            {!loading && !error && (
              <GridView
                entries={entries}
                onFolderClick={handleFolderClick}
                onFileClick={handleFileClick}
              />
            )}
          </>
        )}
      </main>

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        initialTargetPath={currentPath}
        onUploaded={handleUploaded}
      />
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
            워크스페이스를 불러오는 중...
          </span>
        </div>
      }
    >
      <WorkspacePageInner />
    </Suspense>
  );
}
