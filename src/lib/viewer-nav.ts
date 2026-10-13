/**
 * 문서 뷰어로 가는 길을 한곳에 모은다.
 *
 * 문서는 항상 **새 창(탭)** 에서 연다 — 그리드·검색 결과·캘린더·그래프·백링크 패널에서
 * 문서를 열어도 보고 있던 목록이나 그래프가 그대로 남아 있어야 하기 때문이다.
 * 새 창으로 여는 방법이 호출처마다 달라지면 금방 어긋나므로 이 모듈만 거친다.
 *
 * `rel`에 `noopener`를 주는 이유: 열린 창이 `window.opener`로 원래 창을 조작하는 것을 막는다.
 */

/** 뷰어 URL. 서버 라우트(`/api/share/notify` 등)가 만드는 URL과 같은 형태다. */
export function viewerHref(subpath: string): string {
  return `/workspace/view?path=${encodeURIComponent(subpath)}`;
}

/** 임의의 앱 내부 URL을 새 창에서 연다. */
export function openInNewWindow(href: string): void {
  window.open(href, '_blank', 'noopener,noreferrer');
}

/** 문서를 새 창의 뷰어에서 연다. */
export function openViewer(subpath: string): void {
  openInNewWindow(viewerHref(subpath));
}

/** `<a target="_blank">`에 함께 붙일 속성. 링크마다 `rel`을 빠뜨리지 않도록 상수로 둔다. */
export const NEW_WINDOW_LINK_PROPS = {
  target: '_blank',
  rel: 'noopener noreferrer',
} as const;
