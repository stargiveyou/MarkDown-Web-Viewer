'use client';

/**
 * 업로드 드롭존 — 드래그앤드롭 + 파일 선택.
 *
 * - `POST /api/upload` (multipart). FormData 필드명은 반드시 `UPLOAD_FIELD` 상수를 쓴다.
 * - 파일 **1건당 1요청**으로 순차 전송한다. 그래야 413/415를 파일 단위로 귀속시켜 표시할 수 있다.
 * - 429를 받으면 남은 큐를 중단한다(rate limit을 더 두드리지 않는다).
 * - 성공 시 `onUploaded`가 목록 새로고침 훅 지점이다(Stage 2에서 `/api/files` 재조회 연결).
 */

import { useCallback, useRef, useState } from 'react';
import { apiUpload } from '@/lib/fetcher';
import { emitToast } from '@/components/ui/toast-bus';
import { UPLOAD_FIELD, type UploadResponse, type UploadedFileInfo } from '@/types/api';
import { normalizeTargetPath } from './target-path';
import { toUploadFailure } from './upload-errors';

type ItemStatus = 'queued' | 'uploading' | 'done' | 'error' | 'skipped';

interface QueueItem {
  id: string;
  file: File;
  status: ItemStatus;
  /** 0~1 */
  progress: number;
  message?: string;
}

export interface UploadDropzoneProps {
  /**
   * MARKDOWN_ROOT 기준 상대 폴더. 빈 문자열이면 루트에 저장한다.
   * 사용자가 타이핑 중인 원문을 그대로 받아도 되며, 전송 직전에 정규화한다.
   */
  targetPath?: string;
  /** 업로드 성공분이 생길 때마다 호출되는 목록 새로고침 훅 지점. */
  onUploaded?: (files: UploadedFileInfo[]) => void;
}

const STATUS_LABEL: Record<ItemStatus, string> = {
  queued: '대기 중',
  uploading: '업로드 중',
  done: '완료',
  error: '실패',
  skipped: '중단됨',
};

const STATUS_STYLE: Record<ItemStatus, string> = {
  queued: 'text-zinc-500 dark:text-zinc-400',
  uploading: 'text-zinc-900 dark:text-zinc-100',
  done: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-red-600 dark:text-red-400',
  skipped: 'text-amber-600 dark:text-amber-400',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadDropzone({ targetPath = '', onUploaded }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // dragenter/dragleave가 자식 요소마다 발생하므로 깊이를 세어 깜빡임을 막는다.
  const dragDepth = useRef(0);
  const seq = useRef(0);
  const running = useRef(false);

  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<QueueItem[]>([]);

  // 전송·표시에 쓰는 값은 항상 정규화된 경로다(상태로 보관하지 않고 파생시킨다).
  const resolvedTargetPath = normalizeTargetPath(targetPath);

  const patch = useCallback((id: string, next: Partial<QueueItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }, []);

  const runQueue = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const queued: QueueItem[] = files.map((file) => ({
        id: `upload-${++seq.current}`,
        file,
        status: 'queued',
        progress: 0,
      }));

      setItems((prev) => [...prev, ...queued]);
      setBusy(true);
      running.current = true;

      const uploaded: UploadedFileInfo[] = [];
      let stopped = false;
      let notifiedAny = false;

      for (const item of queued) {
        if (stopped) {
          patch(item.id, { status: 'skipped', message: '앞선 요청이 제한되어 중단했습니다.' });
          continue;
        }

        patch(item.id, { status: 'uploading', progress: 0, message: undefined });

        const form = new FormData();
        form.append(UPLOAD_FIELD.file, item.file, item.file.name);
        // 루트(빈 문자열)면 필드 자체를 보내지 않는다 — 계약 §1-2.
        if (resolvedTargetPath) form.append(UPLOAD_FIELD.targetPath, resolvedTargetPath);

        try {
          const res = await apiUpload<UploadResponse>('/api/upload', form, (ratio) =>
            patch(item.id, { progress: ratio }),
          );
          uploaded.push(...(res?.files ?? []));
          if (res?.notified) notifiedAny = true;
          patch(item.id, { status: 'done', progress: 1 });
        } catch (caught) {
          const failure = toUploadFailure(caught);
          patch(item.id, { status: 'error', message: failure.message });

          // 429는 남은 큐를 중단하고, 401은 fetcher가 이미 /login으로 보내는 중이다.
          if (failure.code === 429 || failure.code === 401) {
            stopped = true;
            emitToast({ message: failure.message, variant: 'error' });
          }
        }
      }

      running.current = false;
      setBusy(false);

      if (uploaded.length > 0) {
        const baseMsg = `${uploaded.length}개 파일을 업로드했습니다.`;
        const notifyMsg = notifiedAny ? ' (알림 전송됨)' : '';
        emitToast({ message: baseMsg + notifyMsg, variant: 'success' });
        onUploaded?.(uploaded);
      }
    },
    [resolvedTargetPath, onUploaded, patch],
  );

  const accept = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      if (running.current) {
        emitToast({ message: '업로드가 끝난 뒤 다시 시도해 주세요.', variant: 'info' });
        return;
      }
      void runQueue(Array.from(fileList));
    },
    [runQueue],
  );

  const doneCount = items.filter((item) => item.status === 'done').length;
  const errorCount = items.filter((item) => item.status === 'error').length;

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        // 같은 파일을 연속 선택해도 change가 발생하도록 값을 비운다.
        onChange={(event) => {
          accept(event.target.files);
          event.target.value = '';
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          accept(event.dataTransfer.files);
        }}
        aria-label="파일을 드래그해 놓거나 클릭해 선택"
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:outline-zinc-100 ${
          dragging
            ? 'border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800'
            : 'border-zinc-300 bg-zinc-50 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/50 dark:hover:border-zinc-600'
        }`}
      >
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {dragging ? '여기에 놓으세요' : '파일을 드래그하거나 클릭해 선택하세요'}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          저장 위치: {resolvedTargetPath ? `/${resolvedTargetPath}` : '루트 폴더'}
        </span>
      </button>

      {/* 빈 상태 */}
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">아직 선택된 파일이 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p aria-live="polite" className="text-xs text-zinc-500 dark:text-zinc-400">
            {busy
              ? '업로드 중…'
              : `완료 ${doneCount}건${errorCount > 0 ? ` · 실패 ${errorCount}건` : ''}`}
          </p>

          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm text-zinc-900 dark:text-zinc-100" title={item.file.name}>
                    {item.file.name}
                  </span>
                  <span className={`shrink-0 text-xs ${STATUS_STYLE[item.status]}`}>
                    {STATUS_LABEL[item.status]}
                  </span>
                </div>

                <div className="mt-1 flex items-center gap-3">
                  <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                    {formatBytes(item.file.size)}
                  </span>
                  {/* 진행률 */}
                  <div
                    role="progressbar"
                    aria-label={`${item.file.name} 업로드 진행률`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(item.progress * 100)}
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                  >
                    <div
                      className={`h-full transition-[width] duration-200 ${
                        item.status === 'error'
                          ? 'bg-red-500'
                          : item.status === 'done'
                            ? 'bg-emerald-500'
                            : 'bg-zinc-900 dark:bg-zinc-100'
                      }`}
                      style={{ width: `${Math.round(item.progress * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {Math.round(item.progress * 100)}%
                  </span>
                </div>

                {/* 에러 상태 — 413/415/429를 구분해 표시 */}
                {item.message && (
                  <p
                    role={item.status === 'error' ? 'alert' : undefined}
                    className={`mt-1 text-xs ${STATUS_STYLE[item.status]}`}
                  >
                    {item.message}
                  </p>
                )}
              </li>
            ))}
          </ul>

          {!busy && (
            <button
              type="button"
              onClick={() => setItems([])}
              className="self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-100"
            >
              목록 비우기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
