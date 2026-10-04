/**
 * 마크다운 렌더링 관련 유틸리티.
 *
 * `server-only` 없음 — 클라이언트 컴포넌트(view/edit)에서 사용한다.
 */

/** 외부 URL인지 판별한다. */
export function isExternalUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/**
 * 상대 이미지 경로를 /api/thumbnail URL로 변환한다.
 * 현재 파일의 디렉터리를 기준으로 해석한다.
 */
export function resolveImageSrc(src: string, filePath: string): string {
  if (isExternalUrl(src)) return src;

  const cleanSrc = src.startsWith('./') ? src.slice(2) : src;
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  const imagePath = dir ? `${dir}/${cleanSrc}` : cleanSrc;

  return `/api/thumbnail?path=${encodeURIComponent(imagePath)}&w=800`;
}
