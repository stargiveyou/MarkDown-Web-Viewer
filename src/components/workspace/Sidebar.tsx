'use client';

/**
 * 좌측 고정 사이드바 — Split-Sidebar Bento Grid 레이아웃.
 *
 * Desktop(md+)에서만 표시되며 h-screen sticky로 고정된다.
 * 상단: 브랜드 로고 + 폴더 탐색 트리 메뉴 (서브폴더 펼치기 지원)
 * 하단: 서버 상태 칩
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Folder, Home, Server } from 'lucide-react';
import { apiFetch } from '@/lib/fetcher';
import type { FilesResponse } from '@/types/api';

export interface SidebarProps {
  /** 루트 폴더 목록 (이름 배열) */
  folders: { name: string; subpath: string }[];
  /** 현재 활성 경로 */
  currentPath: string;
  /** 폴더 클릭 핸들러 */
  onFolderClick: (subpath: string) => void;
  /** 홈(루트) 클릭 */
  onHomeClick: () => void;
  /** 로그아웃 */
  onLogout: () => void;
  loggingOut: boolean;
}

interface FolderNode {
  name: string;
  subpath: string;
}

function FolderTreeItem({
  folder,
  currentPath,
  onFolderClick,
  depth,
}: {
  folder: FolderNode;
  currentPath: string;
  onFolderClick: (subpath: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FolderNode[]>([]);
  const [loaded, setLoaded] = useState(false);

  const isActive = currentPath === folder.subpath;
  const isAncestor = currentPath.startsWith(folder.subpath + '/');

  // 현재 경로가 이 폴더의 하위에 있으면 자동 펼치기
  useEffect(() => {
    if (isAncestor && !expanded) {
      setExpanded(true);
    }
  }, [isAncestor, expanded]);

  // 펼칠 때 서브폴더 로드
  useEffect(() => {
    if (!expanded || loaded) return;

    (async () => {
      try {
        const data = await apiFetch<FilesResponse>(
          `/api/files?path=${encodeURIComponent(folder.subpath)}&sort=name`,
        );
        setChildren(
          data.entries
            .filter((e) => e.type === 'folder')
            .map((e) => ({ name: e.name, subpath: e.subpath })),
        );
      } catch {
        // 실패 시 빈 배열
      }
      setLoaded(true);
    })();
  }, [expanded, loaded, folder.subpath]);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpanded((prev) => !prev);
    },
    [],
  );

  const handleClick = useCallback(() => {
    onFolderClick(folder.subpath);
    if (!expanded) {
      setExpanded(true);
    }
  }, [folder.subpath, onFolderClick, expanded]);

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className={`flex items-center gap-2 w-full rounded-xl text-sm transition-colors truncate ${
          isActive
            ? 'bg-slate-800 text-amber-400'
            : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px`, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}
      >
        <button
          type="button"
          onClick={handleToggle}
          className="shrink-0 p-0.5 rounded hover:bg-slate-700/50 transition-colors"
          tabIndex={-1}
        >
          <ChevronRight
            className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''} ${
              isActive ? 'text-amber-400' : 'text-slate-600'
            }`}
          />
        </button>
        <Folder className="h-4 w-4 shrink-0" />
        <span className="truncate">{folder.name}</span>
      </button>

      {expanded && children.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {children.map((child) => (
            <FolderTreeItem
              key={child.subpath}
              folder={child}
              currentPath={currentPath}
              onFolderClick={onFolderClick}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  folders,
  currentPath,
  onFolderClick,
  onHomeClick,
  onLogout,
  loggingOut,
}: SidebarProps) {
  return (
    <aside className="hidden md:flex w-64 bg-slate-950 border-r border-slate-800 h-screen sticky top-0 p-5 flex-col justify-between">
      {/* 상단: 브랜드 + 탐색 */}
      <div className="flex flex-col gap-6">
        {/* 브랜드 로고 */}
        <div className="flex items-center gap-2 px-2">
          <div className="h-8 w-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <span className="text-amber-400 font-bold text-sm">H</span>
          </div>
          <span className="text-slate-100 font-semibold text-sm tracking-tight">
            Husky Admin
          </span>
        </div>

        {/* 네비게이션 */}
        <nav className="flex flex-col gap-1">
          <button
            type="button"
            onClick={onHomeClick}
            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors ${
              currentPath === ''
                ? 'bg-slate-800 text-amber-400'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
            }`}
          >
            <Home className="h-4 w-4" />
            <span>Home</span>
          </button>

          <div className="mt-3 mb-2 px-3">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Folders
            </span>
          </div>

          <div className="flex flex-col gap-0.5 max-h-[calc(100vh-280px)] overflow-y-auto no-scrollbar">
            {folders.map((folder) => (
              <FolderTreeItem
                key={folder.subpath}
                folder={folder}
                currentPath={currentPath}
                onFolderClick={onFolderClick}
                depth={0}
              />
            ))}
          </div>
        </nav>
      </div>

      {/* 하단: 서버 상태 + 로그아웃 */}
      <div className="flex flex-col gap-3">
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Server className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[11px] font-medium text-slate-300">Server Status</span>
          </div>
          <p className="text-[11px] text-slate-500">Mac mini</p>
          <p className="text-[11px] text-slate-500 font-mono">~/MarkdownDocs</p>
        </div>

        <button
          type="button"
          onClick={onLogout}
          disabled={loggingOut}
          className="w-full rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loggingOut ? '로그아웃 중...' : '로그아웃'}
        </button>
      </div>
    </aside>
  );
}
