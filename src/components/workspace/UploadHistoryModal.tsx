'use client';

/**
 * 날짜별 업로드 이력 창.
 *
 * 우측 `UploadLogPanel`의 "날짜별" 탭이 여는 넓은 창이다.
 * 좌측에 날짜 목록(건수 포함), 우측에 그날 올라온 파일 전체를 보여 준다.
 *
 * 목록의 원본은 서버(`GET /api/upload-log`)이므로 웹 UI 업로드와
 * API 직접 호출(curl 등)이 함께 나온다 — 패널의 "최근" 탭과 같은 데이터다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';

import { Modal } from '@/components/ui/Modal';
import { apiFetch, toApiRequestError } from '@/lib/fetcher';
import { groupUploadsByDay } from '@/lib/upload-log';
import type { UploadHistoryEntry, UploadLogResponse } from '@/types/api';

/** 한 번에 읽어 오는 건수. 라우트의 상한(500)과 맞춘다. */
const PAGE_SIZE = 200;

export interface UploadHistoryModalProps {
  open: boolean;
  onClose: () => void;
  /** 항목 클릭 시 해당 파일이 있는 폴더로 이동 */
  onEntryClick?: (entry: UploadHistoryEntry) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/** 파일이 담긴 폴더 경로. 루트면 빈 문자열. */
function folderOf(subpath: string): string {
  const slash = subpath.lastIndexOf('/');
  return slash === -1 ? '' : subpath.slice(0, slash);
}

export function UploadHistoryModal({ open, onClose, onEntryClick }: UploadHistoryModalProps) {
  const [entries, setEntries] = useState<UploadHistoryEntry[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  /** '오늘'/'어제' 판정 기준 시각. 창을 연 순간으로 고정한다(렌더마다 흔들리면 안 된다). */
  const [openedAt, setOpenedAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  // 창을 닫았다 열면 처음부터 다시 읽는다(그 사이 올라온 파일을 반영).
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      loadedRef.current = false;
      return;
    }
    if (loadedRef.current) return;
    loadedRef.current = true;

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      setOpenedAt(Date.now());
      try {
        const data = await apiFetch<UploadLogResponse>(
          `/api/upload-log?limit=${PAGE_SIZE}`,
        );
        if (cancelled) return;
        setEntries(data.entries);
        setSelectedDay(null);
        setHasMore(data.entries.length === PAGE_SIZE);
      } catch (caught) {
        if (cancelled) return;
        const err = toApiRequestError(caught);
        if (err.code !== 401) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open]);

  const handleLoadMore = useCallback(async () => {
    const oldest = entries[entries.length - 1];
    if (!oldest || loadingMore) return;

    setLoadingMore(true);
    try {
      // 같은 시각에 기록된 배치를 건너뛰지 않도록 id까지 커서로 넘긴다.
      const data = await apiFetch<UploadLogResponse>(
        `/api/upload-log?limit=${PAGE_SIZE}&beforeAt=${oldest.at}&beforeId=${oldest.id}`,
      );
      setEntries((prev) => [...prev, ...data.entries]);
      setHasMore(data.entries.length === PAGE_SIZE);
    } catch (caught) {
      const err = toApiRequestError(caught);
      if (err.code !== 401) setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }, [entries, loadingMore]);

  const groups = useMemo(() => groupUploadsByDay(entries, openedAt), [entries, openedAt]);

  // 선택한 날짜가 없거나 목록에서 사라졌으면 가장 최근 날짜를 보여 준다.
  const activeGroup =
    groups.find((group) => group.key === selectedDay) ?? groups[0] ?? null;

  return (
    <Modal open={open} title="날짜별 업로드 이력" onClose={onClose} size="xl">
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
          이력을 불러오는 중...
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-800/40 bg-red-950/20 px-4 py-6 text-center text-sm text-red-300">
          {error}
        </p>
      ) : groups.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500">
          아직 업로드 기록이 없습니다.
        </p>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row">
          {/* 날짜 목록 */}
          <nav
            aria-label="업로드 날짜"
            className="flex shrink-0 gap-1 overflow-x-auto pb-1 sm:max-h-[60vh] sm:w-44 sm:flex-col sm:overflow-y-auto sm:overflow-x-visible sm:border-r sm:border-zinc-800 sm:pr-3"
          >
            {groups.map((group) => {
              const active = group.key === activeGroup?.key;
              return (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => setSelectedDay(group.key)}
                  aria-current={active ? 'true' : undefined}
                  className={`flex shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 ${
                    active
                      ? 'bg-zinc-800 font-semibold text-amber-400'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <span className="truncate">{group.label}</span>
                  <span className={`text-[10px] tabular-nums ${active ? 'text-amber-500' : 'text-zinc-600'}`}>
                    {group.entries.length}
                  </span>
                </button>
              );
            })}

            {hasMore && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="mt-1 shrink-0 rounded-xl border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMore ? '불러오는 중...' : '이전 기록 더 보기'}
              </button>
            )}
          </nav>

          {/* 선택한 날짜의 파일 목록 */}
          <ul className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-h-[60vh] sm:overflow-y-auto">
            {activeGroup?.entries.map((entry) => {
              const folder = folderOf(entry.subpath);

              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onEntryClick?.(entry)}
                    title={`/${entry.subpath}`}
                    className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-zinc-500" />

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-zinc-200">{entry.name}</span>
                      <span className="block truncate text-[10px] text-zinc-500">
                        {folder ? `/${folder}` : '루트'}
                      </span>
                    </span>

                    <span
                      className={`shrink-0 rounded border px-1 text-[9px] tracking-wide ${
                        entry.source === 'api'
                          ? 'border-amber-900/60 bg-amber-950/40 text-amber-500'
                          : 'border-zinc-700 text-zinc-400'
                      }`}
                    >
                      {entry.source === 'api' ? 'API' : 'WEB'}
                    </span>

                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                      {formatTime(entry.at)} · {formatBytes(entry.size)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}
