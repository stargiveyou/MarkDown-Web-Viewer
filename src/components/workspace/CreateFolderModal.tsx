'use client';

/**
 * 폴더 생성 모달 — 현재 위치에 새 폴더를 만든다.
 *
 * 기존 `Modal` 컴포넌트를 재사용하며, `POST /api/folder`를 호출한다.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { apiFetch, toApiRequestError } from '@/lib/fetcher';
import { emitToast } from '@/components/ui/toast-bus';
import type { CreateFolderResponse } from '@/types/api';

export interface CreateFolderModalProps {
  open: boolean;
  onClose: () => void;
  /** 현재 부모 경로 (MARKDOWN_ROOT 기준 상대 경로). */
  currentPath: string;
  /** 생성 성공 후 파일 목록 새로고침 트리거. */
  onCreated?: () => void;
}

export function CreateFolderModal({
  open,
  onClose,
  currentPath,
  onCreated,
}: CreateFolderModalProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('폴더 이름을 입력해 주세요.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await apiFetch<CreateFolderResponse>('/api/folder', {
        method: 'POST',
        body: JSON.stringify({ parentPath: currentPath, name: trimmed }),
      });
      emitToast({ message: `'${trimmed}' 폴더가 생성되었습니다.`, variant: 'success' });
      setName('');
      onCreated?.();
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

  function handleClose() {
    setName('');
    setError('');
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="새 폴더 만들기">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* 현재 위치 표시 */}
        <div>
          <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            위치
          </span>
          <p className="mt-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
            {currentPath || '/  (루트)'}
          </p>
        </div>

        {/* 폴더 이름 입력 */}
        <div>
          <label
            htmlFor="create-folder-name"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            폴더 이름
          </label>
          <input
            id="create-folder-name"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            placeholder="새 폴더"
            autoFocus
            disabled={loading}
            className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/20 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:border-zinc-100 dark:focus-visible:ring-zinc-100/20"
          />
        </div>

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
            type="submit"
            disabled={loading || name.trim() === ''}
            className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-amber-400 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            생성
          </button>
        </div>
      </form>
    </Modal>
  );
}
