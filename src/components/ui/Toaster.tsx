'use client';

/**
 * 토스트 표시 영역 — 외부 라이브러리 없이 최소 구현.
 *
 * 루트 레이아웃에 한 번만 마운트한다. 발행은 `emitToast`(toast-bus)로 하며,
 * `src/lib/fetcher.ts`가 429에서 이 경로로 토스트를 띄운다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeToast, type ToastItem } from './toast-bus';

const VARIANT_STYLE: Record<ToastItem['variant'], string> = {
  info: 'border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100',
};

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // 언마운트 시 정리해야 하므로 타이머 핸들을 모아 둔다.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    const timerMap = timers.current;

    const unsubscribe = subscribeToast((toast) => {
      // 같은 메시지가 연속으로 밀려와도 목록이 무한히 늘지 않도록 최대 4개만 유지한다.
      setToasts((prev) => [...prev, toast].slice(-4));

      if (toast.durationMs > 0) {
        timerMap.set(
          toast.id,
          setTimeout(() => {
            timerMap.delete(toast.id);
            setToasts((prev) => prev.filter((item) => item.id !== toast.id));
          }, toast.durationMs),
        );
      }
    });

    return () => {
      unsubscribe();
      for (const timer of timerMap.values()) clearTimeout(timer);
      timerMap.clear();
    };
  }, []);

  // Esc로 가장 최근 토스트를 닫는다(키보드 접근성).
  useEffect(() => {
    if (toasts.length === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const last = toasts[toasts.length - 1];
      if (last) dismiss(last.id);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toasts, dismiss]);

  return (
    <div
      // 스크린 리더가 내용을 읽도록 항상 렌더한다(빈 상태여도 노드를 유지).
      aria-live="polite"
      aria-atomic="false"
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${VARIANT_STYLE[toast.variant]}`}
        >
          <p className="flex-1 leading-5">{toast.message}</p>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="알림 닫기"
            className="-m-1 rounded p-1 text-current opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
