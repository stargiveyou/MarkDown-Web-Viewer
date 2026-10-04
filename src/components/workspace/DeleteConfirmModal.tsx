'use client';

/**
 * 삭제 확인 모달 — 파일/폴더 삭제 전 경고를 표시한다.
 */

import { useCallback, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { apiFetch, toApiRequestError } from '@/lib/fetcher';
import { emitToast } from '@/components/ui/toast-bus';
import type { DeleteResponse, FileEntry } from '@/types/api';

export interface DeleteConfirmModalProps {
  target: FileEntry;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteConfirmModal({ target, onClose, onDeleted }: DeleteConfirmModalProps) {
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);

    try {
      await apiFetch<DeleteResponse>(
        `/api/files?path=${encodeURIComponent(target.subpath)}`,
        { method: 'DELETE' },
      );
      emitToast({
        message: `"${target.name}" 삭제 완료`,
        variant: 'success',
      });
      onDeleted();
    } catch (caught) {
      const err = toApiRequestError(caught);
      if (err.code !== 401) {
        emitToast({ message: err.message, variant: 'error' });
      }
    } finally {
      setDeleting(false);
    }
  }, [target, deleting, onDeleted]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => { if (!deleting) onClose(); }}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-red-500/20 flex items-center justify-center">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-100">삭제 확인</h2>
            <p className="text-xs text-slate-500">이 작업은 되돌릴 수 없습니다</p>
          </div>
        </div>
        <p className="text-sm text-slate-300 mb-1">
          <span className="font-medium text-slate-100">&ldquo;{target.name}&rdquo;</span>
          {target.type === 'folder' ? '  폴더와 하위 모든 파일을' : ' 파일을'} 영구적으로 삭제합니다.
        </p>
        <p className="text-xs text-slate-500 mb-6">
          디스크에서 완전히 제거되며 복구할 수 없습니다.
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={deleting}
            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
          >
            {deleting ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  );
}
