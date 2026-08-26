'use client';

/**
 * 클라이언트에서 고정된 "지금" 시각을 돌려준다.
 *
 * `Date.now()`를 렌더 중에 부르면 순수하지 않고, effect에서 setState로 채우면
 * 불필요한 두 번째 렌더가 생긴다. 외부 스토어로 한 번 읽어 캐시하면 둘 다 피할 수 있다.
 *
 * 서버 렌더와 첫 클라이언트 렌더는 `0`을 받는다(hydration 불일치 방지).
 * 호출부는 `0`을 "아직 모른다"로 다루면 된다.
 *
 * 값은 앱이 로드된 시각으로 고정된다 — 자정을 넘겨도 갱신되지 않으므로
 * '오늘' 표시가 중요한 화면은 새로고침이나 별도 갱신을 전제로 한다.
 */

import { useSyncExternalStore } from 'react';

let cached = 0;

/** 변하지 않는 값이라 구독은 아무것도 하지 않는다. */
function subscribe(): () => void {
  return () => {};
}

function getSnapshot(): number {
  if (cached === 0) cached = Date.now();
  return cached;
}

function getServerSnapshot(): number {
  return 0;
}

export function useClientNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
