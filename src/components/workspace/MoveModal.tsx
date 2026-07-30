'use client';

/**
 * 이동 모달 — 파일 또는 폴더를 다른 위치로 이동한다.
 *
 * 폴더 트리 피커로 대상 위치를 선택하고, `POST /api/move`를 호출한다.
 * Sidebar의 FolderTreeItem과 유사한 lazy-loading 재귀 트리 구조.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ChevronRight,
  Folder,
  FolderInput,
  Home,
  Loader2,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { apiFetch, toApiRequestError } from '@/lib/fetcher';
import { emitToast } from '@/components/ui/toast-bus';
import type { FileEntry, FilesResponse, MoveResponse } from '@/types/api';

export interface MoveModalProps {
  open: boolean;
  onClose: () => void;
  /** 이동할 항목. null이면 모달 미표시. */
  entry: FileEntry | null;
  /** 이동 성공 후 파일 목록 새로고침 트리거. */
  onMoved?: () => void;
}

// ---------------------------------------------------------------------------
// 폴더 트리 피커 아이템
// ---------------------------------------------------------------------------

interface FolderPickerItemProps {
  name: string;
  subpath: string;
  selectedPath: string;
  onSelect: (subpath: string) => void;
  /** 선택 불가능한 경로 집합 (이동 대상 자신 + 하위). */
  disabledSubpath: string | null;
  depth: number;
}

function FolderPickerItem({
  name,
  subpath,
  selectedPath,
  onSelect,
  disabledSubpath,
  depth,
}: FolderPickerItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<{ name: string; subpath: string }[]>([]);
  const [loaded, setLoaded] = useState(false);

  const isDisabled =
    disabledSubpath !== null &&
    (subpath === disabledSubpath || subpath.startsWith(disabledSubpath + '/'));

  const isSelected = selectedPath === subpath;

  const loadChildren = useCallback(async () => {
    if (loaded) return;
    try {
      const data = await apiFetch<FilesResponse>(
        `/api/files?path=${encodeURIComponent(subpath)}&sort=name`,
      );
      setChildren(
        data.entries
          .filter((e) => e.type === 'folder')
          .map((e) => ({ name: e.name, subpath: e.subpath })),
      );
    } catch {
      // 로딩 실패는 치명적이지 않음
    }
    setLoaded(true);
  }, [subpath, loaded]);

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!expanded) {
      loadChildren();
    }
    setExpanded((prev) => !prev);
  }

  function handleSelect() {
    if (!isDisabled) {
      onSelect(subpath);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleSelect}
        disabled={isDisabled}
        className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
          isSelected
            ? 'bg-amber-500/20 text-amber-400'
            : isDisabled
              ? 'cursor-not-allowed text-zinc-600 dark:text-zinc-600'
              : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <button
          type="button"
          onClick={handleToggle}
          disabled={isDisabled}
          className="shrink-0 rounded p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          tabIndex={-1}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </button>
        <Folder className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="truncate">{name}</span>
      </button>

      {expanded && loaded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <FolderPickerItem
              key={child.subpath}
              name={child.name}
              subpath={child.subpath}
              selectedPath={selectedPath}
              onSelect={onSelect}
              disabledSubpath={disabledSubpath}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MoveModal
// ---------------------------------------------------------------------------

export function MoveModal({ open, onClose, entry, onMoved }: MoveModalProps) {
  const [selectedPath, setSelectedPath] = useState('');
  const [rootFolders, setRootFolders] = useState<{ name: string; subpath: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 현재 부모 경로 계산
  const currentParent = entry
    ? entry.subpath.split('/').slice(0, -1).join('/')
    : '';

  // 루트 폴더 로드 (open 시 비동기 fetch)
  useEffect(() => {
    if (!open) return;

    apiFetch<FilesResponse>('/api/files?sort=name')
      .then((data) =>
        setRootFolders(
          data.entries
            .filter((e) => e.type === 'folder')
            .map((e) => ({ name: e.name, subpath: e.subpath })),
        ),
      )
      .catch(() => {});
  }, [open]);

  // 폴더 이동인 경우 자기 자신 + 하위 비활성화
  const disabledSubpath =
    entry?.type === 'folder' ? entry.subpath : null;

  // 같은 위치인지 확인
  const isSameLocation = selectedPath === currentParent;

  function resetState() {
    setSelectedPath('');
    setError('');
    setLoading(false);
  }

  function handleClose() {
    resetState();
    onClose();
  }

  async function handleMove() {
    if (!entry || isSameLocation) return;

    setLoading(true);
    setError('');

    try {
      await apiFetch<MoveResponse>('/api/move', {
        method: 'POST',
        body: JSON.stringify({
          sourcePath: entry.subpath,
          destinationPath: selectedPath,
        }),
      });
      emitToast({
        message: `'${entry.name}'을(를) 이동했습니다.`,
        variant: 'success',
      });
      resetState();
      onMoved?.();
      onClose();
    } catch (caught) {
      const err = toApiRequestError(caught);
      if (err.code !== 401) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  if (!entry) return null;

  return (
    <Modal open={open} onClose={handleClose} title="항목 이동">
      <div className="flex flex-col gap-4">
        {/* 이동할 항목 정보 */}
        <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
          <FolderInput className="h-5 w-5 shrink-0 text-zinc-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {entry.name}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              현재 위치: {currentParent || '/ (루트)'}
            </p>
          </div>
        </div>

        {/* 대상 폴더 선택 */}
        <div>
          <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
            이동할 위치 선택
          </span>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
            {/* 루트 옵션 */}
            <button
              type="button"
              onClick={() => setSelectedPath('')}
              className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                selectedPath === ''
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              <Home className="h-4 w-4 shrink-0 text-amber-500" />
              <span className="font-medium">루트 (Home)</span>
            </button>

            {/* 폴더 트리 */}
            {rootFolders.map((folder) => (
              <FolderPickerItem
                key={folder.subpath}
                name={folder.name}
                subpath={folder.subpath}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                disabledSubpath={disabledSubpath}
                depth={1}
              />
            ))}
          </div>
        </div>

        {/* 선택된 대상 표시 */}
        {selectedPath !== '' && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            이동 대상: <span className="font-medium text-zinc-700 dark:text-zinc-200">{selectedPath}</span>
          </p>
        )}

        {/* 같은 위치 안내 */}
        {isSameLocation && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            현재 위치와 같은 곳입니다. 다른 폴더를 선택해 주세요.
          </p>
        )}

        {/* 에러 메시지 */}
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </p>
        )}

        {/* 버튼 */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleMove}
            disabled={loading || isSameLocation}
            className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-amber-400 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            이동
          </button>
        </div>
      </div>
    </Modal>
  );
}
