/**
 * 업로드 로그 — 순수 로직.
 *
 * 기록의 원본은 **서버**(`GET /api/upload-log`)다. 예전에는 브라우저 localStorage에만
 * 쌓았기 때문에 curl 등 API 직접 호출로 올린 파일이 목록에 나타나지 않았다.
 * 지금 localStorage에 남는 것은 "여기까지 지웠다"는 표시 하나뿐이며,
 * Clear는 **표시만** 감춘다(서버 이력과 파일은 그대로).
 */

import { isMarkdownName } from './doc-title';
import type { UploadHistoryEntry } from '@/types/api';

export type { UploadHistoryEntry as UploadLogEntry };

/** Clear 기준 시각을 담는 localStorage 키. */
export const UPLOAD_LOG_CLEARED_KEY = 'hw-upload-log-cleared-before';

/** 우측 패널이 서버에서 가져올 최근 건수. */
export const UPLOAD_LOG_MAX = 30;

/**
 * Clear 이후에 올라온 항목만 남긴다.
 *
 * @param entries       서버에서 받은 최신순 목록
 * @param clearedBefore Clear를 누른 시각(ms). 0이면 전부 표시한다.
 */
export function visibleEntries(
  entries: UploadHistoryEntry[],
  clearedBefore: number,
): UploadHistoryEntry[] {
  if (clearedBefore <= 0) return entries;
  return entries.filter((entry) => entry.at > clearedBefore);
}

/** Clear 기준 시각을 읽는다. 없거나 손상됐으면 0(전부 표시). */
export function loadClearedBefore(): number {
  if (typeof window === 'undefined') return 0;

  try {
    const raw = window.localStorage.getItem(UPLOAD_LOG_CLEARED_KEY);
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

/** Clear 기준 시각을 저장한다. 실패는 무시한다(표시용 데이터). */
export function saveClearedBefore(at: number): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(UPLOAD_LOG_CLEARED_KEY, String(at));
  } catch {
    // 용량 초과·비활성 스토리지 — 표시용이므로 무시
  }
}

// ---------------------------------------------------------------------------
// 날짜별 묶기 — 이력 창(UploadHistoryModal)에서 쓴다.
// ---------------------------------------------------------------------------

/** 하루치 업로드 묶음. */
export interface UploadDayGroup {
  /** 로컬 기준 날짜 키(`YYYY-MM-DD`). 같은 날 여부 판정과 React key로 쓴다. */
  key: string;
  /** 사람이 읽는 표기 — `오늘` / `어제` / `8/12 (월)` */
  label: string;
  entries: UploadHistoryEntry[];
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 로컬 시간 기준 `YYYY-MM-DD`. UTC(toISOString)를 쓰면 밤 업로드가 다음 날로 밀린다. */
export function dayKeyOf(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function labelOf(at: number, todayKey: string, yesterdayKey: string): string {
  const key = dayKeyOf(at);
  if (key === todayKey) return '오늘';
  if (key === yesterdayKey) return '어제';

  const date = new Date(at);
  return `${date.getMonth() + 1}/${date.getDate()} (${WEEKDAYS[date.getDay()]})`;
}

/**
 * 최신순 목록을 날짜별로 묶는다. 입력 순서를 그대로 유지하므로
 * 날짜 묶음도, 묶음 안의 항목도 최신순이다.
 *
 * @param entries 최신순으로 정렬된 업로드 목록
 * @param now     '오늘'/'어제' 판정 기준 시각(ms)
 */
export function groupUploadsByDay(
  entries: UploadHistoryEntry[],
  now: number,
): UploadDayGroup[] {
  const todayKey = dayKeyOf(now);
  const yesterdayKey = dayKeyOf(now - 24 * 60 * 60 * 1000);

  const groups: UploadDayGroup[] = [];
  let current: UploadDayGroup | null = null;

  for (const entry of entries) {
    const key = dayKeyOf(entry.at);
    if (!current || current.key !== key) {
      current = { key, label: labelOf(entry.at, todayKey, yesterdayKey), entries: [] };
      groups.push(current);
    }
    current.entries.push(entry);
  }

  return groups;
}

// ---------------------------------------------------------------------------
// 표시 이름 — 날짜별 이력 창과 캘린더가 함께 쓴다.
// ---------------------------------------------------------------------------

/**
 * 목록에 크게 보여줄 이름.
 *
 * 마크다운 문서는 제목(frontmatter title 또는 첫 H1)을 쓰고, 이미지·SVG 등은
 * 제목 개념이 없으므로 언제나 파일명 그대로다. 서버도 md에만 `title`을 실어 주지만,
 * 화면 규칙이 코드에서 바로 읽히도록 여기서도 확인한다.
 */
export function entryDisplayName(entry: UploadHistoryEntry): string {
  return isMarkdownName(entry.name) ? entry.title ?? entry.name : entry.name;
}

/** 제목이 파일명을 대신하고 있는지 — 부제목에 파일명을 덧붙일지 판단한다. */
export function showsTitle(entry: UploadHistoryEntry): boolean {
  return entryDisplayName(entry) !== entry.name;
}

/** 파일이 담긴 폴더 경로. 루트면 빈 문자열. */
export function folderOf(subpath: string): string {
  const slash = subpath.lastIndexOf('/');
  return slash === -1 ? '' : subpath.slice(0, slash);
}
