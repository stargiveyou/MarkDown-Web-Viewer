/**
 * 업로드 대상 폴더 경로 정규화.
 *
 * 계약(§1-2)상 `targetPath`는 **선행/후행 슬래시가 없는 상대 경로**로 전송한다.
 * 다만 정규화는 **전송 규칙이지 입력 규칙이 아니다.**
 * 키 입력마다 적용하면 사용자가 `2026-Travel/` 까지 친 순간 `/`가 지워져
 * 하위 폴더 경로를 타이핑할 수 없게 된다(frontend-validator F1).
 * 따라서 이 함수는 FormData 구성 직전(또는 blur)에만 호출한다.
 */
export function normalizeTargetPath(raw: string): string {
  return raw.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}
