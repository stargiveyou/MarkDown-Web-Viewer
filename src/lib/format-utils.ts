/**
 * 공용 포맷 유틸리티.
 *
 * `server-only` 없음 — 클라이언트 컴포넌트에서도 사용한다.
 * formatBytes: 7곳, formatRelativeTime: 2곳, formatTimestamp: 2곳 중복 통합.
 */

/** 바이트 수를 사람이 읽기 좋은 문자열로 포맷한다. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/** epoch ms를 상대 시간 문자열로 포맷한다. 7일 이상이면 YYYY-MM-DD. */
export function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 0) return '방금';

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return '방금';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${days}일 전`;

  const date = new Date(epochMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 날짜 포맷: `YYYYMMDD-HHmmss` (로컬 시간 기준).
 * 버전 백업 파일명에 사용한다.
 */
export function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
