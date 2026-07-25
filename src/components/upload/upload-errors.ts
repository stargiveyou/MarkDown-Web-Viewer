/**
 * 업로드 실패 코드 → 사용자 메시지 매핑.
 *
 * 서버 메시지를 그대로 노출하지 않고 코드로 분기한다.
 * 백엔드 메시지 문구가 바뀌어도 UI 문구가 흔들리지 않게 하기 위함이다(보안 불변식 8과도 일관).
 */

import { toApiRequestError } from '@/lib/fetcher';
import type { ApiErrorCode } from '@/types/api';

const UPLOAD_ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  400: '요청이 올바르지 않습니다. 파일명 또는 대상 폴더를 확인해 주세요.',
  401: '세션이 만료되었습니다. 다시 로그인해 주세요.',
  409: '대상 파일이 외부에서 변경되었습니다.',
  413: '파일이 너무 큽니다.',
  415: '허용되지 않는 형식입니다.',
  429: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
  // 500은 디스크 쓰기 실패 등 서버 내부 오류다. 재시도로 풀리지 않을 수 있어 502와 문구를 구분한다.
  500: '서버에 파일을 저장하지 못했습니다. 문제가 계속되면 저장 공간을 확인해 주세요.',
  502: '서버에 연결할 수 없습니다.',
};

export interface UploadFailure {
  code: ApiErrorCode;
  message: string;
}

/** 임의의 예외를 업로드 UI가 표시할 `{ code, message }`로 정규화한다. */
export function toUploadFailure(error: unknown): UploadFailure {
  const normalized = toApiRequestError(error);
  return {
    code: normalized.code,
    message: UPLOAD_ERROR_MESSAGES[normalized.code],
  };
}
