'use client';

/**
 * 워크스페이스 메인 페이지 — Split-Sidebar Bento Grid 대시보드.
 *
 * 레이아웃: 좌측 고정 사이드바 + 우측 메인(Sticky Header + Bento Grid).
 * 하위 폴더 진입 시에도 동일 사이드바 유지, 메인 영역만 갱신.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { UploadModal } from '@/components/upload/UploadModal';
import { Sidebar } from '@/components/workspace/Sidebar';
import { Breadcrumb } from '@/components/workspace/Breadcrumb';
import { BentoGrid } from '@/components/workspace/BentoGrid';
import { SearchBar } from '@/components/workspace/SearchBar';
import { SearchResults } from '@/components/workspace/SearchResults';
import { TagBar } from '@/components/workspace/TagBar';
import { emitToast } from '@/components/ui/toast-bus';
import { apiFetch, toApiRequestError } from '@/lib/fetcher';
import { Loader2, Plus, Search } from 'lucide-react';
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

/** 파일 목록을 API에서 가져온다. */
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
  const [sort, setSort] = useState<SortKey>('name');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 사이드바 폴더 목록 (루트 폴더들)
  const [rootFolders, setRootFolders] = useState<{ name: string; subpath: string }[]>([]);

  const [refreshKey, setRefreshKey] = useState(0);

  // 검색 상태
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndexing, setSearchIndexing] = useState(false);

  // 태그 상태
  const [tags, setTags] = useState<TagCount[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // 모바일 사이드바 토글
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // 루트 폴더 목록 로드 (사이드바용)
  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<FilesResponse>('/api/files?sort=name');
        setRootFolders(
          data.entries
            .filter((e) => e.type === 'folder')
            .map((e) => ({ name: e.name, subpath: e.subpath })),
        );
      } catch {
        // 사이드바 폴더 로딩 실패는 치명적이지 않음
      }
    })();
  }, [refreshKey]);

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

  // 태그 목록 조회
  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<TagsResponse>('/api/tags');
        setTags(data.tags);
      } catch {
        // 태그 로딩 실패는 치명적이지 않음
      }
    })();
  }, [refreshKey]);

  const handleUploaded = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleRetry = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

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
      if (err.code !== 401) {
        emitToast({ message: '로그아웃에 실패했습니다. 다시 시도해 주세요.', variant: 'error' });
        setLoggingOut(false);
      }
    }
  }

  function handleBreadcrumbNavigate(pathUpTo: number) {
    if (pathUpTo === -1) {
      router.push('/workspace');
    } else {
      const targetPath = breadcrumb.slice(0, pathUpTo + 1).join('/');
      router.push(`/workspace?path=${encodeURIComponent(targetPath)}`);
    }
  }

  function handleFolderClick(subpath: string) {
    router.push(`/workspace?path=${encodeURIComponent(subpath)}`);
    setMobileMenuOpen(false);
  }

  function handleFileClick(entry: FileEntry) {
    if (entry.type === 'markdown') {
      router.push(`/workspace/view?path=${encodeURIComponent(entry.subpath)}`);
    } else if (entry.type === 'image') {
      window.open(`/api/thumbnail?path=${encodeURIComponent(entry.subpath)}&w=1200`, '_blank');
    }
  }

  const isSearchMode = searchResults !== null;

  return (
    <div className="flex min-h-screen bg-slate-900">
      {/* 좌측 사이드바 (Desktop) */}
      <Sidebar
        folders={rootFolders}
        currentPath={currentPath}
        onFolderClick={handleFolderClick}
        onHomeClick={() => { router.push('/workspace'); setMobileMenuOpen(false); }}
        onLogout={handleLogout}
        loggingOut={loggingOut}
      />

      {/* 모바일 사이드바 오버레이 */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-50 flex w-64 h-full bg-slate-950 border-r border-slate-800 p-5 flex-col justify-between">
            <Sidebar
              folders={rootFolders}
              currentPath={currentPath}
              onFolderClick={handleFolderClick}
              onHomeClick={() => { router.push('/workspace'); setMobileMenuOpen(false); }}
              onLogout={handleLogout}
              loggingOut={loggingOut}
            />
          </aside>
        </div>
      )}

      {/* 우측 메인 영역 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Sticky Header */}
        <header className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
          <div className="flex items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-center gap-3">
              {/* 모바일 햄버거 */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {/* 검색 바 */}
              <div className="relative">
                <SearchBar onResults={handleSearchResults} onClear={handleSearchClear} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* 정렬 드롭다운 */}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                disabled={isSearchMode}
                aria-label="정렬 기준"
                className="hidden sm:block rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 outline-none focus-visible:border-amber-500 focus-visible:ring-1 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {/* 업로드 버튼 */}
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">새 문서 업로드</span>
              </button>
            </div>
          </div>
        </header>

        {/* 메인 컨텐츠 */}
        <main className="flex-1 p-8 space-y-6 no-scrollbar overflow-y-auto">
          {/* 브레드크럼 — 하위 폴더에 있을 때만 표시 */}
          {breadcrumb.length > 0 && (
            <Breadcrumb segments={breadcrumb} onNavigate={handleBreadcrumbNavigate} />
          )}

          {/* 태그 칩 바 */}
          {!isSearchMode && tags.length > 0 && (
            <TagBar tags={tags} activeTag={activeTag} onTagSelect={handleTagSelect} />
          )}

          {/* 검색 모드 */}
          {isSearchMode ? (
            <SearchResults
              query={searchQuery}
              results={searchResults}
              indexing={searchIndexing}
            />
          ) : (
            <>
              {/* 로딩 */}
              {loading && (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
                  <span className="ml-2 text-sm text-slate-500">
                    파일 목록을 불러오는 중...
                  </span>
                </div>
              )}

              {/* 에러 */}
              {error && !loading && (
                <div className="rounded-2xl border border-red-500/30 bg-red-950/20 px-6 py-8 text-center">
                  <p className="text-sm text-red-400">{error}</p>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="mt-4 rounded-xl border border-red-500/30 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-950/30"
                  >
                    다시 시도
                  </button>
                </div>
              )}

              {/* Bento Grid */}
              {!loading && !error && (
                <BentoGrid
                  entries={entries}
                  onFolderClick={handleFolderClick}
                  onFileClick={handleFileClick}
                />
              )}
            </>
          )}
        </main>
      </div>

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
        <div className="flex min-h-screen items-center justify-center bg-slate-900">
          <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
          <span className="ml-2 text-sm text-slate-500">
            워크스페이스를 불러오는 중...
          </span>
        </div>
      }
    >
      <WorkspacePageInner />
    </Suspense>
  );
}
