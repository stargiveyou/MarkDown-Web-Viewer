'use client';

/**
 * 우측 업로드 로그 패널 — 최근 업로드된 파일을 간략히 보여준다.
 *
 * 좌측 `Sidebar`와 짝을 이루는 고정 컬럼(lg+에서만 표시)이며,
 * "Clear" 버튼을 누르면 목록이 사라진다(로컬 표시용 기록만 지운다 — 파일은 그대로).
 */

import { Trash2, UploadCloud } from 'lucide-react';
import type { UploadLogEntry } from '@/lib/upload-log';

export interface UploadLogPanelProps {
  entries: UploadLogEntry[];
  onClear: () => void;
  /** 항목 클릭 시 해당 파일이 있는 폴더로 이동 */
  onEntryClick?: (entry: UploadLogEntry) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 파일이 담긴 폴더 경로. 루트면 빈 문자열. */
function folderOf(subpath: string): string {
  const slash = subpath.lastIndexOf('/');
  return slash === -1 ? '' : subpath.slice(0, slash);
}

export function UploadLogPanel({ entries, onClear, onEntryClick }: UploadLogPanelProps) {
  return (
    <aside
      aria-label="업로드 로그"
      className="hidden lg:flex w-64 shrink-0 bg-slate-950 border-l border-slate-800 h-screen sticky top-0 p-5 flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <UploadCloud className="h-4 w-4 text-amber-400" />
          <h2 className="text-[11px] font-medium text-slate-300 uppercase tracking-wider">
            Upload Log
          </h2>
        </div>

        <button
          type="button"
          onClick={onClear}
          disabled={entries.length === 0}
          className="flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="text-[11px] text-slate-600 leading-relaxed">
          아직 업로드 기록이 없습니다.
          <br />
          파일을 올리면 여기에 표시됩니다.
        </p>
      ) : (
        <ul
          aria-live="polite"
          className="flex flex-col gap-1.5 overflow-y-auto no-scrollbar -mx-1 px-1"
        >
          {entries.map((entry) => {
            const folder = folderOf(entry.subpath);

            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onEntryClick?.(entry)}
                  title={`/${entry.subpath}`}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-left transition-colors hover:border-slate-700 hover:bg-slate-800/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                >
                  <p className="truncate text-xs text-slate-200">{entry.name}</p>
                  <p className="truncate text-[10px] text-slate-500">
                    {folder ? `/${folder}` : '루트'}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-600 tabular-nums">
                    {formatTime(entry.at)} · {formatBytes(entry.size)}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
