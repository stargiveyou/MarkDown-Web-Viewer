/**
 * 업로드 캘린더의 순수 로직 — 달력 격자 구성과 날짜별 묶기.
 *
 * 날짜 계산은 전부 **로컬 시간** 기준이다. UTC로 다루면 밤늦게 올린 파일이
 * 다음 날 칸에 들어간다(`dayKeyOf`와 같은 이유).
 */

import { dayKeyOf, type UploadLogEntry } from './upload-log';

/** 달력 한 칸. */
export interface CalendarCell {
  /** 로컬 기준 날짜 키(`YYYY-MM-DD`) — 업로드 묶음과 맞추는 열쇠. */
  key: string;
  /** 그 날 00:00의 epoch ms. */
  startsAt: number;
  /** 일(1~31) */
  day: number;
  /** 요일 (0=일 … 6=토) */
  weekday: number;
  /** 보고 있는 달의 날짜인지 (앞뒤 달에서 끌어온 칸은 false) */
  inMonth: boolean;
}

/** 표시 중인 달. `month`는 1~12다(Date의 0-based와 헷갈리지 않도록). */
export interface YearMonth {
  year: number;
  month: number;
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

export function weekdayLabels(): readonly string[] {
  return WEEKDAY_LABELS;
}

/** `2026년 8월` */
export function monthLabel({ year, month }: YearMonth): string {
  return `${year}년 ${month}월`;
}

/** 오늘이 속한 달. */
export function currentMonth(now: number): YearMonth {
  const date = new Date(now);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/** 달을 앞뒤로 옮긴다. 12월 다음은 다음 해 1월이다. */
export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const zeroBased = month - 1 + delta;
  return {
    year: year + Math.floor(zeroBased / 12),
    month: ((zeroBased % 12) + 12) % 12 + 1,
  };
}

/**
 * 달력 격자를 만든다 — 1일이 속한 주의 일요일부터, 말일이 속한 주의 토요일까지.
 * 항상 7의 배수(35 또는 42칸)라 격자가 흔들리지 않는다.
 */
export function buildMonthCells({ year, month }: YearMonth): CalendarCell[] {
  const first = new Date(year, month - 1, 1);
  const start = new Date(year, month - 1, 1 - first.getDay());

  const lastDay = new Date(year, month, 0).getDate();
  const last = new Date(year, month - 1, lastDay);
  const end = new Date(year, month - 1, lastDay + (6 - last.getDay()));

  const cells: CalendarCell[] = [];
  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
  ) {
    cells.push({
      key: dayKeyOf(cursor.getTime()),
      startsAt: cursor.getTime(),
      day: cursor.getDate(),
      weekday: cursor.getDay(),
      inMonth: cursor.getMonth() === month - 1,
    });
  }

  return cells;
}

/**
 * 격자가 덮는 기간 — 앞뒤 달에서 끌어온 칸도 건수를 보여 줘야 하므로
 * 달 경계가 아니라 **격자 경계**로 조회한다.
 *
 * @returns `[from, to)` — to는 마지막 칸의 다음 날 00:00
 */
export function cellsRange(cells: CalendarCell[]): { from: number; to: number } {
  if (cells.length === 0) return { from: 0, to: 0 };

  const first = cells[0];
  const last = cells[cells.length - 1];
  const lastDate = new Date(last.startsAt);

  return {
    from: first.startsAt,
    to: new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate() + 1).getTime(),
  };
}

/** 날짜 키 → 그날 업로드(최신순). 입력 순서를 유지한다. */
export function byDayKey(entries: UploadLogEntry[]): Map<string, UploadLogEntry[]> {
  const map = new Map<string, UploadLogEntry[]>();

  for (const entry of entries) {
    const key = dayKeyOf(entry.at);
    const bucket = map.get(key);
    if (bucket) bucket.push(entry);
    else map.set(key, [entry]);
  }

  return map;
}

/** `8월 13일 (목)` — 상세 패널 제목. */
export function dayTitle(startsAt: number): string {
  const date = new Date(startsAt);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY_LABELS[date.getDay()]})`;
}
