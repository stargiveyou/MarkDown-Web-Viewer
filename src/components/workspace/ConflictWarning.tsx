'use client';

/**
 * 409 충돌 경고 배너 -- 에디터 상단에 표시한다.
 *
 * - 비파괴적 경고만 제공한다. 덮어쓰기 버튼은 없다 (보안 불변식 5).
 * - 사용자에게 내용을 클립보드에 복사한 뒤 새로고침할 것을 안내한다.
 * - "닫기" 버튼으로 경고를 숨길 수 있지만, 저장은 여전히 409로 실패한다.
 */

import { AlertTriangle, X } from 'lucide-react';
import { emitToast } from '@/components/ui/toast-bus';

export interface ConflictWarningProps {
  visible: boolean;
  /** 현재 에디터 내용. 클립보드 복사용. */
  content: string;
  onDismiss: () => void;
}

export function ConflictWarning({ visible, content, onDismiss }: ConflictWarningProps) {
  if (!visible) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      emitToast({ message: '편집 내용이 클립보드에 복사되었습니다.', variant: 'success' });
    } catch {
      emitToast({ message: '클립보드 복사에 실패했습니다.', variant: 'error' });
    }
  }

  function handleReload() {
    window.location.reload();
  }

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700/50 dark:bg-amber-950/30"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          이 파일이 다른 곳에서 수정되었습니다.
        </p>
        <p className="mt-1 text-sm text-amber-800 dark:text-amber-300/80">
          현재 편집 내용을 복사한 뒤 페이지를 새로고침하세요.
        </p>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:bg-amber-500 dark:hover:bg-amber-600"
          >
            내용 복사
          </button>
          <button
            type="button"
            onClick={handleReload}
            className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/30"
          >
            새로고침
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="경고 닫기"
        className="-m-1 rounded p-1 text-amber-600 transition-colors hover:text-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:text-amber-400 dark:hover:text-amber-200"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
