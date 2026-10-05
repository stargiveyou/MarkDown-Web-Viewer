'use client';

/**
 * 백링크 패널 — "이 문서를 가리키는 문서"와 아직 없는 문서로 가는 링크를 보여준다.
 *
 * 문서 하단에 둔다. 좁은 화면(아이폰 PWA)에서도 본문 흐름을 깨지 않도록 사이드바가 아니라
 * 본문 아래 접이식 영역으로 둔다.
 */

import Link from 'next/link';
import { CornerDownRight, FileQuestion, Link2 } from 'lucide-react';

import { viewerHref } from '@/components/workspace/DocLink';
import type { LinksResponse } from '@/types/api';

export interface BacklinksPanelProps {
  links: LinksResponse | null;
  /** 링크 정보를 불러오지 못했을 때 */
  failed?: boolean;
}

export function BacklinksPanel({ links, failed }: BacklinksPanelProps) {
  if (failed) return null;

  const ghosts = links?.outgoing.filter((l) => l.resolved === null) ?? [];

  return (
    <section
      aria-labelledby="backlinks-heading"
      className="mt-12 rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4"
    >
      <h2
        id="backlinks-heading"
        className="flex items-center gap-2 text-sm font-semibold text-zinc-200"
      >
        <Link2 className="h-4 w-4 text-amber-400" />
        이 문서를 가리키는 문서
        {links && <span className="text-zinc-500">({links.backlinks.length})</span>}
      </h2>

      {links === null && <p className="mt-3 text-sm text-zinc-500">불러오는 중…</p>}

      {links && links.backlinks.length === 0 && (
        <p className="mt-3 text-sm text-zinc-500">
          {links.indexed
            ? '아직 이 문서를 링크한 문서가 없습니다. 다른 문서에서 [[문서명]]으로 연결해 보세요.'
            : '색인 중인 문서입니다. 잠시 후 다시 열면 링크가 보입니다.'}
        </p>
      )}

      {links && links.backlinks.length > 0 && (
        <ul className="mt-3 space-y-2">
          {links.backlinks.map((b) => (
            <li key={b.source}>
              <Link
                href={viewerHref(b.source)}
                className="group block rounded-lg px-3 py-2 transition-colors hover:bg-zinc-800/70 focus-visible:outline-2 focus-visible:outline-amber-500"
              >
                <span className="block text-sm font-medium text-amber-300 group-hover:text-amber-200">
                  {b.title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-zinc-500">{b.source}</span>
                {b.context && (
                  <span className="mt-1 flex gap-1.5 text-xs text-zinc-400">
                    <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="line-clamp-2">{b.context}</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {ghosts.length > 0 && (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-zinc-400">
            <FileQuestion className="h-3.5 w-3.5" />
            아직 없는 문서로 가는 링크 ({ghosts.length})
          </h3>
          <p className="mt-1.5 text-xs text-zinc-500">
            {ghosts.map((g) => g.raw).join(' · ')}
          </p>
        </div>
      )}
    </section>
  );
}
