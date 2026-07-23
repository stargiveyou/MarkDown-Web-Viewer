/**
 * 전역 fetch 래퍼 — 클라이언트 전용.
 *
 * **모든** API 호출은 이 래퍼를 경유한다. raw `fetch`를 직접 쓰면
 * 401 리다이렉트와 429 처리가 누락되므로 frontend-validator가 FAIL로 잡는다.
 *
 * - 401 → `/login`으로 리다이렉트 (보안 불변식 1의 클라이언트 측 대응)
 * - 429 → rate limited 토스트
 * - 그 외 에러 → `ApiError`로 정규화해 호출부가 상태 코드로 분기할 수 있게 한다
 *
 * 담당: frontend-dev / Stage 0에서 시그니처 확정, Stage 1에서 구현
 */

import type { ApiError, ApiErrorCode } from '@/types/api';

/** 호출부가 `err.code`로 413/415/409 등을 구분할 수 있도록 정규화된 에러. */
export class ApiRequestError extends Error implements ApiError {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

/**
 * JSON API 호출. 성공 시 파싱된 바디를 반환하고, 실패 시 `ApiRequestError`를 throw한다.
 * 401은 throw 전에 `/login` 리다이렉트를 수행한다.
 */
export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  throw new Error('NOT_IMPLEMENTED: apiFetch — Stage 1 / frontend-dev');
}

/**
 * multipart 업로드 전용. 진행률 콜백이 필요해 XHR을 쓰므로 `apiFetch`와 분리한다.
 * 413 / 415 / 429를 그대로 `ApiRequestError`로 올려 UI가 구분해 표시한다.
 */
export async function apiUpload<T>(
  input: string,
  form: FormData,
  onProgress?: (ratio: number) => void,
): Promise<T> {
  throw new Error('NOT_IMPLEMENTED: apiUpload — Stage 1 / frontend-dev');
}
