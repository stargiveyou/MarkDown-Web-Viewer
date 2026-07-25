/**
 * 토스트 이벤트 버스 — React에 의존하지 않는 최소 pub/sub.
 *
 * `src/lib/fetcher.ts`처럼 컴포넌트 바깥(순수 모듈)에서도 토스트를 띄워야 하므로
 * 상태는 <Toaster />가 갖고, 발행은 이 모듈의 `emitToast`가 담당한다.
 * 외부 토스트 라이브러리는 쓰지 않는다.
 */

export type ToastVariant = 'info' | 'success' | 'error';

export interface ToastInput {
  message: string;
  variant?: ToastVariant;
  /** 자동 소멸까지의 시간(ms). 0이면 수동으로만 닫힌다. */
  durationMs?: number;
}

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  durationMs: number;
}

type Listener = (toast: ToastItem) => void;

const listeners = new Set<Listener>();

let seq = 0;

/** <Toaster />가 마운트되며 구독한다. 반환된 함수로 해제한다. */
export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 토스트 발행. 문자열만 넘기면 `info`로 처리한다.
 * 구독자가 없으면(=Toaster 미마운트) 콘솔로 폴백해 메시지가 조용히 사라지지 않게 한다.
 */
export function emitToast(input: ToastInput | string): void {
  const normalized: ToastInput = typeof input === 'string' ? { message: input } : input;

  const toast: ToastItem = {
    id: `toast-${++seq}`,
    message: normalized.message,
    variant: normalized.variant ?? 'info',
    durationMs: normalized.durationMs ?? 4000,
  };

  if (listeners.size === 0) {
    console.warn(`[toast:${toast.variant}] ${toast.message}`);
    return;
  }

  for (const listener of listeners) listener(toast);
}
