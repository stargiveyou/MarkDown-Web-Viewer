'use client';

/**
 * 워크스페이스 데이터 훅 — 파일 목록, 사이드바 폴더, 태그, 검색 상태를 관리한다.
 *
 * workspace/page.tsx에서 21개 useState + 4개 useEffect를 추출.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, toApiRequestError } from '@/lib/fetcher';
import { emitToast } from '@/components/ui/toast-bus';
import type {
  FileEntry,
  FilesResponse,
  SearchResult,
  SortKey,
  TagCount,
  TagsResponse,
} from '@/types/api';

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

export interface WorkspaceData {
  // 파일 목록
  entries: FileEntry[];
  setEntries: React.Dispatch<React.SetStateAction<FileEntry[]>>;
  breadcrumb: string[];
  loading: boolean;
  error: string;

  // 정렬
  sort: SortKey;
  setSort: (s: SortKey) => void;

  // 사이드바
  rootFolders: { name: string; subpath: string }[];

  // 검색
  searchResults: SearchResult[] | null;
  searchQuery: string;
  searchIndexing: boolean;
  isSearchMode: boolean;
  handleSearchResults: (results: SearchResult[], query: string, indexing: boolean) => void;
  handleSearchClear: () => void;

  // 태그
  tags: TagCount[];
  activeTag: string | null;
  handleTagSelect: (tag: string | null) => void;

  // 갱신
  refresh: () => void;
}

export function useWorkspaceData(currentPath: string): WorkspaceData {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>('ctime');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rootFolders, setRootFolders] = useState<{ name: string; subpath: string }[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // 검색 상태
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndexing, setSearchIndexing] = useState(false);

  // 태그 상태
  const [tags, setTags] = useState<TagCount[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // 브라우저 탭 타이틀
  useEffect(() => {
    const folderName = currentPath.split('/').filter(Boolean).pop();
    document.title = folderName ? `Husky Works MDs - ${folderName}` : 'Husky Works MDs';
    return () => {
      document.title = 'Husky Works MDs';
    };
  }, [currentPath]);

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

  const refresh = useCallback(() => {
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

  const handleTagSelect = useCallback((tag: string | null) => {
    setActiveTag(tag);
  }, []);

  return {
    entries,
    setEntries,
    breadcrumb,
    loading,
    error,
    sort,
    setSort,
    rootFolders,
    searchResults,
    searchQuery,
    searchIndexing,
    isSearchMode: searchResults !== null,
    handleSearchResults,
    handleSearchClear,
    tags,
    activeTag,
    handleTagSelect,
    refresh,
  };
}
