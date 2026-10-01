'use client';

/**
 * FolderDownloadButton — 폴더를 ZIP으로 내려받는 버튼.
 *
 * `GET /api/download?path=<폴더>`는 폴더를 받으면 `archiver`로 ZIP을 스트리밍한다.
 * 파일명은 서버가 `Content-Disposition`에 RFC 5987로 실어 보내므로 한글 폴더명도 보존된다.
 *
 * 압축은 폴더 크기에 따라 수초 이상 걸릴 수 있어 진행 중 상태를 표시한다.
 * 그렇지 않으면 버튼이 죽은 것처럼 보이고 사용자가 중복 클릭한다.
 *
 * - `card`: 폴더 카드 우상단 아이콘 버튼 (hover 시 노출)
 * - `toolbar`: 헤더의 라벨 포함 버튼
 */

import { useCallback, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { apiDownload, toApiRequestError } from '@/lib/fetcher';
import { emitToast } from '@/components/ui/toast-bus';

export interface FolderDownloadButtonProps {
  /** MARKDOWN_ROOT 기준 폴더 서브패스. 빈 문자열(루트)은 허용하지 않는다. */
  subpath: string;
  /** 폴더명. `<name>.zip`을 폴백 파일명으로 쓴다. */
  name: string;
  variant?: 'card' | 'toolbar';
}

const CARD_CLASS =
  'flex items-center gap-1 rounded-lg bg-slate-900/80 backdrop-blur-sm border border-slate-700/50 px-2 py-1 text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-slate-700 hover:text-slate-200 disabled:cursor-wait disabled:opacity-100';

const TOOLBAR_CLASS =
  'flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-wait disabled:opacity-60';

export function FolderDownloadButton({
  subpath,
  name,
  variant = 'card',
}: FolderDownloadButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      // 카드 전체가 클릭 가능하므로 폴더 진입과 겹치지 않게 전파를 끊는다.
      e.stopPropagation();
      e.preventDefault();
      if (busy) return;

      setBusy(true);
      try {
        await apiDownload(
          `/api/download?path=${encodeURIComponent(subpath)}`,
          `${name}.zip`,
        );
      } catch (err) {
        const apiErr = toApiRequestError(err);
        // 401은 fetcher가 이미 /login으로 보낸다 — 토스트를 겹치지 않게 한다.
        if (apiErr.code !== 401) {
          emitToast({ message: apiErr.message, variant: 'error' });
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, subpath, name],
  );

  const isToolbar = variant === 'toolbar';
  const iconClass = isToolbar ? 'h-4 w-4' : 'h-3 w-3';
  const label = busy ? '압축 중...' : 'ZIP 다운로드';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={isToolbar ? TOOLBAR_CLASS : CARD_CLASS}
      title={`${name} 폴더를 ZIP으로 다운로드`}
      aria-label={`${name} 폴더를 ZIP으로 다운로드`}
      aria-busy={busy}
    >
      {busy ? (
        <Loader2 className={`${iconClass} animate-spin`} />
      ) : (
        <Download className={iconClass} />
      )}
      {isToolbar && <span className="hidden sm:inline">{label}</span>}
    </button>
  );
}
