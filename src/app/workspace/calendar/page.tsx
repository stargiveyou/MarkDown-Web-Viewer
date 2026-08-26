'use client';

/**
 * 업로드 캘린더 — /workspace/calendar
 *
 * 월간 달력에 그날 올라온 문서를 칩으로 얹고, 날짜를 고르면 오른쪽에 그날 전체 목록을 보여준다.
 * 데이터는 서버 업로드 이력(`GET /api/upload-log?from=&to=`)이라 웹 업로드와
 * API 직접 호출(curl 등)이 함께 나오고, 이력 기록 이전부터 있던 파일도 서버가
 * 파일시스템 시각으로 한 번 채워 넣어 함께 보인다.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
} from 'lucide-react';

import { emitToast } from '@/components/ui/toast-bus';
import { isMarkdownName } from '@/lib/doc-title';
import { apiFetch, toApiRequestError } from '@/lib/fetcher';
import {
  buildMonthCells,
  byDayKey,
  cellsRange,
  currentMonth,
  dayTitle,
  monthLabel,
  shiftMonth,
  weekdayLabels,
  type YearMonth,
} from '@/lib/upload-calendar';
import { dayKeyOf, entryDisplayName, folderOf, showsTitle } from '@/lib/upload-log';
import { useClientNow } from '@/lib/use-client-now';
import type { UploadHistoryEntry, UploadLogResponse } from '@/types/api';

/** 한 칸에 이름을 몇 개까지 보여줄지. 나머지는 `+N`으로 접는다. */
const CHIPS_PER_CELL = 2;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/** 출처 칩 — 어디로 올라온 기록인지. */
function SourceChip({ source }: { source: UploadHistoryEntry['source'] }) {
  const label = source === 'api' ? 'API' : source === 'web' ? 'WEB' : '기존';
  const tone =
    source === 'api'
      ? 'border-amber-900/60 bg-amber-950/40 text-amber-500'
      : source === 'web'
        ? 'border-zinc-700 text-zinc-400'
        : 'border-zinc-800 text-zinc-600';

  return (
    <span
      title={source === 'scan' ? '이력 기록 이전부터 있던 파일 (파일 시각 기준)' : undefined}
      className={`shrink-0 rounded border px-1 text-[9px] tracking-wide ${tone}`}
    >
      {label}
    </span>
  );
}

function CalendarPageInner() {
  const router = useRouter();

  // 서버 렌더에서는 0이고, 클라이언트에서 한 번만 고정된다.
  const now = useClientNow();

  // 사용자가 고르기 전까지는 오늘이 기준이다 — 초기값을 effect에서 채우지 않고
  // "선택이 없으면 오늘"로 파생시켜 렌더를 한 번으로 끝낸다.
  const [pickedMonth, setPickedMonth] = useState<YearMonth | null>(null);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [entries, setEntries] = useState<UploadHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const todayKey = now === 0 ? '' : dayKeyOf(now);
  const month = pickedMonth ?? (now === 0 ? null : currentMonth(now));
  const selectedKey = pickedKey ?? (todayKey || null);

  useEffect(() => {
    document.title = 'Husky Works MDs - 업로드 캘린더';
    return () => {
      document.title = 'Husky Works MDs';
    };
  }, []);

  const cells = useMemo(() => (month ? buildMonthCells(month) : []), [month]);

  // 달이 바뀌면 그 격자가 덮는 기간만 조회한다(앞뒤 달에서 끌어온 칸 포함).
  useEffect(() => {
    if (cells.length === 0) return;

    let cancelled = false;
    const { from, to } = cellsRange(cells);

    (async () => {
      setLoading(true);
      try {
        const data = await apiFetch<UploadLogResponse>(
          `/api/upload-log?from=${from}&to=${to}`,
        );
        if (cancelled) return;
        setEntries(data.entries);
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
  }, [cells]);

  const byDay = useMemo(() => byDayKey(entries), [entries]);

  const selectedCell = cells.find((cell) => cell.key === selectedKey) ?? null;
  const selectedEntries = selectedKey ? byDay.get(selectedKey) ?? [] : [];
  const selectedBytes = selectedEntries.reduce((sum, entry) => sum + entry.size, 0);

  const handleOpen = useCallback(
    (entry: UploadHistoryEntry) => {
      // 문서는 뷰어로, 그 외 파일은 담긴 폴더로 보낸다.
      if (isMarkdownName(entry.name)) {
        router.push(`/workspace/view?path=${encodeURIComponent(entry.subpath)}`);
        return;
      }
      const folder = folderOf(entry.subpath);
      router.push(folder ? `/workspace?path=${encodeURIComponent(folder)}` : '/workspace');
    },
    [router],
  );

  /** 보고 있는 달을 앞뒤로 옮긴다. 아직 고른 적이 없으면 이번 달이 기준이다. */
  const stepMonth = useCallback(
    (delta: number) => {
      setPickedMonth((prev) => {
        const base = prev ?? month;
        return base ? shiftMonth(base, delta) : null;
      });
    },
    [month],
  );

  /** 이번 달·오늘로 되돌린다(선택을 지우면 기본값이 오늘이다). */
  const goToday = useCallback(() => {
    setPickedMonth(null);
    setPickedKey(null);
  }, []);

  return (
    <div className="flex flex-1 flex-col bg-zinc-950 font-sans text-zinc-300">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md">
        <div className="flex w-full items-center justify-between gap-4 px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => router.push('/workspace')}
              className="flex items-center gap-1.5 rounded text-sm text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
            >
              <ArrowLeft className="h-4 w-4" />
              목록으로
            </button>
            <span className="text-zinc-700">|</span>
            <h1 className="truncate text-sm font-medium text-zinc-100">업로드 캘린더</h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              aria-label="이전 달"
              className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>

            <span
              aria-live="polite"
              className="min-w-28 text-center text-sm font-semibold tabular-nums text-zinc-100"
            >
              {month ? monthLabel(month) : ''}
            </span>

            <button
              type="button"
              onClick={() => stepMonth(1)}
              aria-label="다음 달"
              className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={goToday}
              className="rounded-lg border border-amber-600/70 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
            >
              오늘
            </button>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 w-full flex-1 flex-col lg:flex-row">
        {/* 달력 */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-4 sm:p-6">
          <div className="grid grid-cols-7 gap-1.5">
            {weekdayLabels().map((label, index) => (
              <span
                key={label}
                className={`pb-1 text-center text-[11px] ${
                  index === 0 ? 'text-red-400/70' : index === 6 ? 'text-sky-400/70' : 'text-zinc-500'
                }`}
              >
                {label}
              </span>
            ))}
          </div>

          {error ? (
            <div className="rounded-xl border border-red-800/40 bg-red-950/20 px-6 py-8 text-center">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          ) : (
            <div className="grid flex-1 auto-rows-fr grid-cols-7 gap-1.5">
              {cells.map((cell) => {
                const dayEntries = byDay.get(cell.key) ?? [];
                const selected = cell.key === selectedKey;
                const isToday = cell.key === todayKey;

                return (
                  <button
                    key={cell.key}
                    type="button"
                    onClick={() => setPickedKey(cell.key)}
                    aria-pressed={selected}
                    aria-label={`${dayTitle(cell.startsAt)} — 문서 ${dayEntries.length}건`}
                    className={`flex min-h-24 flex-col gap-1 overflow-hidden rounded-xl border p-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 ${
                      selected
                        ? 'border-amber-500 bg-amber-500/10'
                        : isToday
                          ? 'border-amber-600/70 bg-zinc-900 hover:bg-zinc-800/70'
                          : cell.inMonth
                            ? 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800/70'
                            : 'border-transparent bg-transparent hover:bg-zinc-900/60'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-1">
                      <span
                        className={`text-[11px] tabular-nums ${
                          !cell.inMonth
                            ? 'text-zinc-700'
                            : isToday
                              ? 'font-bold text-amber-400'
                              : cell.weekday === 0
                                ? 'text-red-400/80'
                                : cell.weekday === 6
                                  ? 'text-sky-400/80'
                                  : 'text-zinc-400'
                        }`}
                      >
                        {cell.day}
                      </span>

                      {dayEntries.length > 0 && (
                        <span className="rounded bg-amber-500/15 px-1 text-[9px] tabular-nums text-amber-500">
                          {dayEntries.length}
                        </span>
                      )}
                    </span>

                    {dayEntries.slice(0, CHIPS_PER_CELL).map((entry) => (
                      <span
                        key={entry.id}
                        title={
                          showsTitle(entry) ? `${entryDisplayName(entry)} (${entry.name})` : entry.name
                        }
                        className={`truncate rounded px-1.5 py-0.5 text-[9.5px] ${
                          entry.source === 'api'
                            ? 'bg-amber-500/12 text-amber-400'
                            : 'bg-zinc-800 text-zinc-300'
                        }`}
                      >
                        {entryDisplayName(entry)}
                      </span>
                    ))}

                    {dayEntries.length > CHIPS_PER_CELL && (
                      <span className="pl-1 text-[9.5px] text-zinc-600">
                        +{dayEntries.length - CHIPS_PER_CELL}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 선택한 날짜의 목록 */}
        <aside
          aria-label="선택한 날짜의 업로드"
          className="flex w-full shrink-0 flex-col gap-2.5 border-t border-zinc-800 p-4 sm:p-6 lg:h-[calc(100vh-3.25rem)] lg:w-80 lg:border-l lg:border-t-0 lg:overflow-y-auto"
        >
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              {selectedCell ? dayTitle(selectedCell.startsAt) : '날짜를 선택하세요'}
            </h2>
            <p className="text-[11px] text-zinc-500">
              {loading
                ? '불러오는 중...'
                : `문서 ${selectedEntries.length}건${
                    selectedEntries.length > 0 ? ` · ${formatBytes(selectedBytes)}` : ''
                  }`}
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
            </div>
          ) : selectedEntries.length === 0 ? (
            <p className="py-10 text-center text-[11px] text-zinc-600">
              이 날에는 올라온 문서가 없습니다.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {selectedEntries.map((entry) => {
                const folder = folderOf(entry.subpath);

                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => handleOpen(entry)}
                      title={`/${entry.subpath}`}
                      className="flex w-full items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-zinc-500" />

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-zinc-200">
                          {entryDisplayName(entry)}
                        </span>
                        {/* 제목을 보여줄 때는 실제 파일명이 사라지지 않도록 경로 옆에 붙인다. */}
                        <span className="block truncate text-[10px] text-zinc-500">
                          {showsTitle(entry) ? `${entry.name} · ` : ''}
                          {folder ? `/${folder}` : '루트'}
                        </span>
                      </span>

                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        <SourceChip source={entry.source} />
                        <span className="text-[10px] tabular-nums text-zinc-600">
                          {formatTime(entry.at)} · {formatBytes(entry.size)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </main>
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center bg-zinc-950">
          <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
          <span className="ml-2 text-sm text-zinc-500">캘린더를 불러오는 중...</span>
        </div>
      }
    >
      <CalendarPageInner />
    </Suspense>
  );
}
