'use client';

/**
 * 업로드 모달 — 저장 폴더 입력 + 드롭존.
 *
 * Esc 닫기/포커스 트랩은 공용 `Modal`이 담당한다.
 *
 * 입력 상태는 **사용자가 친 원문 그대로** 보관한다.
 * 선행/후행 슬래시 정규화는 blur 시점(표시용)과 전송 시점(`UploadDropzone`)에만 일어난다.
 */

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { UploadDropzone } from './UploadDropzone';
import { normalizeTargetPath } from './target-path';
import type { UploadedFileInfo } from '@/types/api';

export interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  /** 초기 대상 폴더(MARKDOWN_ROOT 기준 상대 경로). */
  initialTargetPath?: string;
  onUploaded?: (files: UploadedFileInfo[]) => void;
}

export function UploadModal({ open, onClose, initialTargetPath = '', onUploaded }: UploadModalProps) {
  const [targetPath, setTargetPath] = useState(initialTargetPath);

  return (
    <Modal open={open} onClose={onClose} title="파일 업로드">
      <div className="flex flex-col gap-5">
        <div>
          <label
            htmlFor="upload-target-path"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            저장 폴더 <span className="font-normal text-zinc-500">(비우면 루트)</span>
          </label>
          <input
            id="upload-target-path"
            type="text"
            value={targetPath}
            placeholder="예: 2026-Travel/Jeju"
            // 타이핑 중에는 원문을 그대로 유지한다. 정규화는 blur/전송 시점에만.
            onChange={(event) => setTargetPath(event.target.value)}
            onBlur={(event) => setTargetPath(normalizeTargetPath(event.target.value))}
            className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:border-zinc-100 dark:focus-visible:ring-zinc-100/20"
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            경로는 서버가 다시 검증합니다. 상위 폴더(`..`)로 나가는 경로는 거부됩니다.
          </p>
        </div>

        <UploadDropzone targetPath={targetPath} onUploaded={onUploaded} />
      </div>
    </Modal>
  );
}
