'use client';

/**
 * 업로드 로그의 외부 스토어 — 서버 이력을 캐시하고 구독한다.
 *
 * 순수 로직은 `upload-log.ts`에 있고, 여기서는 조회·스냅샷 캐시·구독만 담당한다.
 * `useSyncExternalStore`를 쓰므로 서버 렌더는 항상 빈 목록이라 hydration 불일치가 없다.
 *
 * 데이터 원본이 서버이므로 웹 UI 업로드든 curl 업로드든 같은 목록에 나타난다.
 * 웹에서 업로드한 직후에는 `refreshUploadLog()`로 즉시 다시 읽는다.
 */

import { useEffect, useSyncExternalStore } from 'react';

import { apiFetch } from './fetcher';
import {
  UPLOAD_LOG_CLEARED_KEY,
  UPLOAD_LOG_MAX,
  loadClearedBefore,
  saveClearedBefore,
  visibleEntries,
} from './upload-log';
import type { UploadHistoryEntry, UploadLogResponse } from '@/types/api';

const EMPTY: UploadHistoryEntry[] = [];

/** 서버에서 받은 원본 목록. */
let entries: UploadHistoryEntry[] = EMPTY;

/** Clear 기준 시각. null이면 아직 localStorage를 읽지 않은 상태. */
let clearedBefore: number | null = null;

/** 화면에 보여 줄 목록 — 참조가 안정적이어야 하므로 캐시해 둔다. */
let visible: UploadHistoryEntry[] = EMPTY;

/** 첫 조회를 이미 시작했는지 (마운트마다 중복 요청하지 않기 위해). */
let started = false;

/** 마지막 조회 시각(ms). 자동 갱신 간격 계산에 쓴다. */
let lastFetchedAt = 0;

/** 자동 갱신 최소 간격 — 탭을 오갈 때마다 요청이 쏟아지지 않게 한다. */
const AUTO_REFRESH_INTERVAL_MS = 10_000;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function recompute(): void {
  if (clearedBefore === null) clearedBefore = loadClearedBefore();
  const next = visibleEntries(entries, clearedBefore);
  // 내용이 같으면 참조를 유지해 불필요한 리렌더를 막는다.
  const same =
    next.length === visible.length &&
    next.every((entry, index) => entry.id === visible[index]?.id);
  if (!same) visible = next;
}

function getSnapshot(): UploadHistoryEntry[] {
  return visible;
}

function getServerSnapshot(): UploadHistoryEntry[] {
  return EMPTY;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // 다른 탭에서 Clear를 눌렀을 때 함께 반영한다.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== UPLOAD_LOG_CLEARED_KEY) return;
    clearedBefore = loadClearedBefore();
    recompute();
    emit();
  };

  // 탭으로 돌아왔을 때 다시 읽는다 — 그 사이 curl 등으로 올라온 파일을 보여 주기 위해서다.
  // (브라우저를 떠나 있는 동안 폴링하지 않으므로 유휴 요청이 생기지 않는다.)
  const onFocus = () => {
    if (document.visibilityState === 'hidden') return;
    if (Date.now() - lastFetchedAt < AUTO_REFRESH_INTERVAL_MS) return;
    void refreshUploadLog();
  };

  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
  };
}

/**
 * 서버 이력을 다시 읽는다. 실패는 무시한다 — 로그 표시는 부가 기능이고,
 * 401은 `apiFetch`가 로그인 페이지로 보낸다.
 */
export async function refreshUploadLog(): Promise<void> {
  lastFetchedAt = Date.now();
  try {
    const data = await apiFetch<UploadLogResponse>(
      `/api/upload-log?limit=${UPLOAD_LOG_MAX}`,
    );
    entries = data.entries;
    recompute();
    emit();
  } catch {
    // 조회 실패 시 이전 목록을 유지한다.
  }
}

/** 로그를 비운다(표시 기록만 — 서버 이력과 업로드된 파일은 그대로). */
export function clearUploadLog(): void {
  const now = Date.now();
  clearedBefore = now;
  saveClearedBefore(now);
  recompute();
  emit();
}

/** 현재 업로드 로그를 구독한다. 첫 마운트에서 서버 이력을 한 번 읽는다. */
export function useUploadLog(): UploadHistoryEntry[] {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (started) return;
    started = true;
    void refreshUploadLog();
  }, []);

  return snapshot;
}
