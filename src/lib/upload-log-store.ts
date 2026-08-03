'use client';

/**
 * 업로드 로그의 외부 스토어 — localStorage를 React 밖의 소스로 두고 구독한다.
 *
 * 순수 로직은 `upload-log.ts`에 있고, 여기서는 스냅샷 캐시·구독·영속화만 담당한다.
 * `useSyncExternalStore`를 쓰므로 effect 안에서 setState 하지 않고,
 * 서버 렌더는 항상 빈 목록이라 hydration 불일치도 생기지 않는다.
 * 다른 탭에서의 변경은 `storage` 이벤트로 함께 반영된다.
 */

import { useSyncExternalStore } from 'react';
import {
  UPLOAD_LOG_STORAGE_KEY,
  appendUploadLog,
  loadUploadLog,
  saveUploadLog,
  type UploadLogEntry,
} from './upload-log';
import type { UploadedFileInfo } from '@/types/api';

const EMPTY: UploadLogEntry[] = [];

/** null이면 아직 localStorage를 읽지 않은 상태. */
let snapshot: UploadLogEntry[] | null = null;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 참조가 안정적이어야 하므로 캐시된 배열을 그대로 돌려준다. */
function getSnapshot(): UploadLogEntry[] {
  if (snapshot === null) snapshot = loadUploadLog();
  return snapshot;
}

function getServerSnapshot(): UploadLogEntry[] {
  return EMPTY;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== UPLOAD_LOG_STORAGE_KEY) return;
    snapshot = loadUploadLog();
    emit();
  };

  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** 업로드 성공분을 로그에 기록한다. */
export function recordUploads(files: UploadedFileInfo[], at: number): void {
  if (files.length === 0) return;
  snapshot = appendUploadLog(getSnapshot(), files, at);
  saveUploadLog(snapshot);
  emit();
}

/** 로그를 비운다(표시 기록만 삭제 — 업로드된 파일은 그대로). */
export function clearUploadLog(): void {
  snapshot = EMPTY;
  saveUploadLog(EMPTY);
  emit();
}

/** 현재 업로드 로그를 구독한다. */
export function useUploadLog(): UploadLogEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
