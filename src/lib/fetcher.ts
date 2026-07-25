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

import { emitToast } from '@/components/ui/toast-bus';
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

/** 로그인 페이지 경로. 401 리다이렉트 목적지이자 리다이렉트 루프 차단 기준. */
export const LOGIN_PATH = '/login';

/** 로그인 후 돌아갈 경로를 실어 보내는 쿼리 파라미터명. */
export const NEXT_PARAM = 'next';

/** 계약상 서버가 반환할 수 있는 상태 코드 집합 (`ApiErrorCode`와 일치). */
const CONTRACT_CODES = new Set<number>([400, 401, 409, 413, 415, 429, 500, 502]);

/** 코드별 기본 메시지. 서버가 `ApiError.message`를 주면 그 값이 우선한다. */
const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  400: '요청이 올바르지 않습니다.',
  401: '로그인이 필요합니다.',
  409: '파일이 외부에서 변경되었습니다.',
  413: '파일이 너무 큽니다.',
  415: '허용되지 않는 형식입니다.',
  429: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
  500: '서버에서 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  502: '서버에 연결할 수 없습니다.',
};

/**
 * 계약 밖 상태 코드를 `ApiErrorCode`로 접는다.
 * 5xx는 `502`(upstream 실패), 그 외는 `400`으로 취급한다.
 * 네트워크 단절도 502로 통일해 호출부 분기를 단순하게 유지한다.
 */
function normalizeCode(status: number): ApiErrorCode {
  if (CONTRACT_CODES.has(status)) return status as ApiErrorCode;
  if (status >= 500) return 502;
  return 400;
}

/** 서버가 준 메시지를 우선 채택하고, 없으면 코드 기본 메시지를 쓴다. */
function pickMessage(code: ApiErrorCode, raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const message = (raw as Partial<ApiError>).message;
    if (typeof message === 'string' && message.trim().length > 0) return message.trim();
  }
  return DEFAULT_MESSAGES[code];
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // JSON이 아닌 에러 바디(HTML 등)는 무시하고 기본 메시지를 쓴다.
    return null;
  }
}

/**
 * 401 공통 처리. 현재 경로를 `next`로 실어 `/login`으로 보낸다.
 * 이미 로그인 페이지면 아무것도 하지 않는다(로그인 실패 = 401이므로 루프 방지).
 */
function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === LOGIN_PATH) return;

  const back = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`${LOGIN_PATH}?${NEXT_PARAM}=${encodeURIComponent(back)}`);
}

/** 상태 코드별 공통 부수효과. 401 리다이렉트, 429 토스트. */
function handleStatusSideEffects(code: ApiErrorCode, message: string, toastOn429: boolean): void {
  if (code === 401) {
    redirectToLogin();
    return;
  }
  if (code === 429 && toastOn429) {
    emitToast({ message, variant: 'error' });
  }
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  // 문자열 바디는 JSON으로 간주한다. FormData는 boundary 때문에 절대 지정하지 않는다.
  if (typeof init?.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

/**
 * JSON API 호출. 성공 시 파싱된 바디를 반환하고, 실패 시 `ApiRequestError`를 throw한다.
 * 401은 throw 전에 `/login` 리다이렉트를 수행한다.
 */
export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;

  try {
    res = await fetch(input, {
      credentials: 'same-origin',
      ...init,
      headers: buildHeaders(init),
    });
  } catch {
    // 네트워크 단절·CORS·중단. 서버 내부 정보는 노출하지 않는다.
    throw new ApiRequestError(502, DEFAULT_MESSAGES[502]);
  }

  const text = await res.text();
  const body = parseJson(text);

  if (!res.ok) {
    const code = normalizeCode(res.status);
    const message = pickMessage(code, body);
    handleStatusSideEffects(code, message, true);
    throw new ApiRequestError(code, message);
  }

  // 204 등 바디 없는 성공 응답은 undefined로 반환한다(호출부가 void로 받는다).
  return body as T;
}

/**
 * multipart 업로드 전용. 진행률 콜백이 필요해 XHR을 쓰므로 `apiFetch`와 분리한다.
 * 413 / 415 / 429를 그대로 `ApiRequestError`로 올려 UI가 구분해 표시한다.
 *
 * 429는 업로드 UI가 파일별로 인라인 표시하므로 여기서 토스트를 띄우지 않는다(중복 방지).
 */
export function apiUpload<T>(
  input: string,
  form: FormData,
  onProgress?: (ratio: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      reject(new ApiRequestError(502, DEFAULT_MESSAGES[502]));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', input, true);
    xhr.responseType = 'text';
    xhr.setRequestHeader('Accept', 'application/json');
    // Content-Type은 지정하지 않는다 — 브라우저가 multipart boundary를 붙여야 한다.

    if (onProgress) {
      onProgress(0);
      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (!event.lengthComputable || event.total <= 0) return;
        onProgress(Math.min(1, event.loaded / event.total));
      };
    }

    xhr.onload = () => {
      const body = parseJson(xhr.responseText ?? '');

      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(body as T);
        return;
      }

      const code = normalizeCode(xhr.status);
      const message = pickMessage(code, body);
      handleStatusSideEffects(code, message, false);
      reject(new ApiRequestError(code, message));
    };

    const failNetwork = () => reject(new ApiRequestError(502, DEFAULT_MESSAGES[502]));
    xhr.onerror = failNetwork;
    xhr.ontimeout = failNetwork;
    xhr.onabort = failNetwork;

    xhr.send(form);
  });
}

/**
 * 파일/폴더 다운로드. 브라우저의 기본 다운로드 UX를 활용한다.
 *
 * 성공 시 `response.blob()` → `URL.createObjectURL` → `<a>` 클릭으로 다운로드를 트리거한다.
 * 에러 시 `ApiRequestError`를 throw한다 (401 리다이렉트, 429 토스트 포함).
 */
export async function apiDownload(url: string, fallbackFilename: string): Promise<void> {
  let res: Response;

  try {
    res = await fetch(url, { credentials: 'same-origin' });
  } catch {
    throw new ApiRequestError(502, DEFAULT_MESSAGES[502]);
  }

  if (!res.ok) {
    const text = await res.text();
    const body = parseJson(text);
    const code = normalizeCode(res.status);
    const message = pickMessage(code, body);
    handleStatusSideEffects(code, message, true);
    throw new ApiRequestError(code, message);
  }

  const blob = await res.blob();

  // Content-Disposition에서 파일명 추출 시도
  const disposition = res.headers.get('Content-Disposition');
  let filename = fallbackFilename;
  if (disposition) {
    const utf8Match = disposition.match(/filename\*=UTF-8''(.+?)(?:;|$)/);
    if (utf8Match) {
      filename = decodeURIComponent(utf8Match[1]);
    } else {
      const asciiMatch = disposition.match(/filename="?(.+?)"?(?:;|$)/);
      if (asciiMatch) filename = asciiMatch[1];
    }
  }

  // 브라우저 다운로드 트리거
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // 정리
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  }, 100);
}

/** 알 수 없는 예외를 호출부에서 다루기 쉬운 `ApiRequestError`로 좁힌다. */
export function toApiRequestError(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) return error;
  return new ApiRequestError(502, DEFAULT_MESSAGES[502]);
}
