'use client';

/**
 * 공유 모달 -- Discord / Slack Webhook 알림 전송 + 링크 복사.
 *
 * - Discord/Slack 클릭 시 `POST /api/share/notify` 호출 (apiFetch 경유).
 * - "링크 복사"는 현재 페이지 URL을 클립보드에 복사한다 (인증된 앱 URL, ADR-004).
 * - Webhook URL은 서버 전용이며 클라이언트에 절대 노출하지 않는다 (보안 불변식 6).
 * - 성공 후 모달을 닫지 않는다 -- 사용자가 다른 플랫폼에도 공유할 수 있다.
 */

import { useState } from 'react';
import { MessageCircle, Hash, Link, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { apiFetch, toApiRequestError } from '@/lib/fetcher';
import { emitToast } from '@/components/ui/toast-bus';
import type { ShareNotifyResponse, ShareTarget } from '@/types/api';

export interface ShareModalProps {
  /** 공유할 파일의 MARKDOWN_ROOT 기준 상대 경로. */
  filePath: string;
  /** 표시할 파일명 (헤더에 사용). */
  fileName: string;
  /** 모달 열림 상태. */
  open: boolean;
  /** 모달 닫기 콜백. */
  onClose: () => void;
}

export function ShareModal({ filePath, fileName, open, onClose }: ShareModalProps) {
  // 어떤 버튼이 로딩 중인지 추적 (null이면 아무 것도 아님)
  const [sending, setSending] = useState<ShareTarget | null>(null);

  /** Discord/Slack 공유 알림 전송. */
  async function handleShare(target: ShareTarget) {
    setSending(target);

    try {
      await apiFetch<ShareNotifyResponse>('/api/share/notify', {
        method: 'POST',
        body: JSON.stringify({ target, filePath }),
      });

      const label = target === 'discord' ? 'Discord' : 'Slack';
      emitToast({ message: `${label}에 공유되었습니다.`, variant: 'success' });
    } catch (caught) {
      const err = toApiRequestError(caught);

      if (err.code === 502) {
        emitToast({
          message: '전송에 실패했습니다. 잠시 후 재시도해 주세요.',
          variant: 'error',
        });
      } else if (err.code !== 401 && err.code !== 429) {
        // 401은 fetcher가 /login 리다이렉트, 429는 fetcher가 토스트를 자동 처리
        emitToast({ message: err.message, variant: 'error' });
      }
    } finally {
      setSending(null);
    }
  }

  /** 현재 페이지 URL을 클립보드에 복사한다. */
  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      emitToast({ message: '링크가 복사되었습니다.', variant: 'success' });
    } catch {
      emitToast({
        message: '클립보드에 복사할 수 없습니다. 브라우저 설정을 확인해 주세요.',
        variant: 'error',
      });
    }
  }

  return (
    <Modal open={open} title="공유하기" onClose={onClose}>
      {/* 파일명 표시 */}
      <p className="mb-4 truncate text-sm text-zinc-600 dark:text-zinc-400">
        {fileName}
      </p>

      {/* 액션 버튼 목록 */}
      <div className="flex flex-col gap-2.5">
        {/* Discord */}
        <button
          type="button"
          disabled={sending !== null}
          onClick={() => handleShare('discord')}
          className="flex w-full items-center gap-3 rounded-lg border border-indigo-200 px-4 py-3 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/50"
        >
          {sending === 'discord' ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <MessageCircle className="h-5 w-5" />
          )}
          Discord로 공유
        </button>

        {/* Slack */}
        <button
          type="button"
          disabled={sending !== null}
          onClick={() => handleShare('slack')}
          className="flex w-full items-center gap-3 rounded-lg border border-emerald-200 px-4 py-3 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
        >
          {sending === 'slack' ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Hash className="h-5 w-5" />
          )}
          Slack으로 공유
        </button>

        {/* 링크 복사 */}
        <button
          type="button"
          disabled={sending !== null}
          onClick={handleCopyLink}
          className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Link className="h-5 w-5" />
          링크 복사
        </button>
      </div>

      {/* ADR-004: 인증 필요 안내 */}
      <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
        공유 링크를 받은 사람도 로그인이 필요합니다.
      </p>
    </Modal>
  );
}
