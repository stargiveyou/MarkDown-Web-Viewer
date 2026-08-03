/**
 * 업로드 로그 저장소 — 메인 화면 우측 패널에 표시할 최근 업로드 기록.
 *
 * 서버에 남기는 감사 로그가 아니라 **브라우저 로컬 표시용**이다.
 * 페이지 이동(뷰어/에디터)으로 컴포넌트가 언마운트돼도 유지되도록 localStorage에 보관한다.
 * 저장 실패(사생활 보호 모드 등)는 무시한다 — 로그 표시는 부가 기능이다.
 */

import type { UploadedFileInfo } from '@/types/api';

export const UPLOAD_LOG_STORAGE_KEY = 'hw-upload-log';

/** 보관 최대 건수. 초과분은 오래된 것부터 버린다. */
export const UPLOAD_LOG_MAX = 30;

export interface UploadLogEntry {
  id: string;
  name: string;
  /** MARKDOWN_ROOT 기준 상대 경로 */
  subpath: string;
  size: number;
  /** 업로드 시각(ms, 클라이언트 시계) */
  at: number;
}

/**
 * 새 업로드분을 로그 앞(최신순)에 붙이고 상한으로 자른다.
 * 한 번에 여러 건이 올라온 경우 나중에 끝난 파일이 위로 온다.
 */
export function appendUploadLog(
  prev: UploadLogEntry[],
  files: UploadedFileInfo[],
  at: number,
): UploadLogEntry[] {
  const added: UploadLogEntry[] = files.map((file, index) => ({
    id: `${at}-${index}-${file.subpath}`,
    name: file.name,
    subpath: file.subpath,
    size: file.size,
    at,
  }));

  return [...added.reverse(), ...prev].slice(0, UPLOAD_LOG_MAX);
}

/** 저장된 값이 로그 항목 형태인지 확인한다(다른 버전의 잔여 데이터 방어). */
function isEntry(value: unknown): value is UploadLogEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.name === 'string' &&
    typeof e.subpath === 'string' &&
    typeof e.size === 'number' &&
    typeof e.at === 'number'
  );
}

/** localStorage에서 로그를 읽는다. 손상/부재 시 빈 배열. */
export function loadUploadLog(): UploadLogEntry[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(UPLOAD_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, UPLOAD_LOG_MAX);
  } catch {
    return [];
  }
}

/** localStorage에 로그를 저장한다. 실패는 무시한다. */
export function saveUploadLog(entries: UploadLogEntry[]): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(UPLOAD_LOG_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // 용량 초과·비활성 스토리지 — 표시용 데이터이므로 무시
  }
}
