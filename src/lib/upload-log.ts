/**
 * 업로드 로그 — 순수 로직.
 *
 * 기록의 원본은 **서버**(`GET /api/upload-log`)다. 예전에는 브라우저 localStorage에만
 * 쌓았기 때문에 curl 등 API 직접 호출로 올린 파일이 목록에 나타나지 않았다.
 * 지금 localStorage에 남는 것은 "여기까지 지웠다"는 표시 하나뿐이며,
 * Clear는 **표시만** 감춘다(서버 이력과 파일은 그대로).
 */

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

