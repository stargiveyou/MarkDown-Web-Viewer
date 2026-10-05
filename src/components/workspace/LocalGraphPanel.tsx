'use client';

/**
 * 로컬 그래프 패널 — 지금 보는 문서를 중심으로 N단계 안의 연결을 보여준다.
 *
 * 작은 화면(아이폰 PWA)에서는 전체 그래프보다 이쪽이 실용적이다. 캔버스 시뮬레이션이
 * CPU를 쓰므로 접어 두면 그래프를 만들지 않는다.
 */

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Network } from 'lucide-react';

import { emitToast } from '@/components/ui/toast-bus';
import { viewerHref } from '@/components/workspace/DocLink';
import { useGraph } from '@/components/workspace/use-graph';
import type { GraphNode } from '@/types/api';

// canvas·window를 쓰므로 서버 렌더에서 제외한다.
const GraphCanvas = dynamic(() => import('@/components/workspace/GraphCanvas'), {
  ssr: false,
  loading: () => <GraphLoading />,
});

function GraphLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin text-amber-400" />
      그래프를 그리는 중…
    </div>
  );
}

const DEPTHS = [1, 2, 3] as const;

export function LocalGraphPanel({ path }: { path: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [depth, setDepth] = useState<number>(1);
  const [tags, setTags] = useState(false);
  const { data, failed, loading } = useGraph({ path, depth, tags }, open);

  const handleSelect = useCallback(
    (node: GraphNode) => {
      if (node.type === 'doc') {
        if (node.id !== path) router.push(viewerHref(node.id));
      } else if (node.type === 'ghost') {
        emitToast({ message: `"${node.label}" 문서는 아직 없습니다.`, variant: 'info' });
      }
    },
    [path, router],
  );

  if (failed) return null;

  const onlySelf = data !== null && data.nodes.length <= 1;

  return (
    <section
      aria-labelledby="local-graph-heading"
      className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 rounded text-sm font-semibold text-zinc-200 focus-visible:outline-2 focus-visible:outline-amber-500"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Network className="h-4 w-4 text-amber-400" />
          <span id="local-graph-heading">연결 그래프</span>
        </button>

        {open && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 whitespace-nowrap text-xs text-zinc-400">
            <div role="radiogroup" aria-label="깊이" className="flex overflow-hidden rounded-lg border border-zinc-700">
              {DEPTHS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={depth === d}
                  onClick={() => setDepth(d)}
                  className={`whitespace-nowrap px-2.5 py-1 transition-colors ${
                    depth === d ? 'bg-zinc-700 text-zinc-100' : 'hover:bg-zinc-800'
                  }`}
                >
                  {d}단계
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={tags}
                onChange={(e) => setTags(e.target.checked)}
                className="accent-amber-500"
              />
              태그
            </label>
            <Link href="/workspace/graph" className="text-amber-400 hover:text-amber-300">
              전체 그래프 →
            </Link>
          </div>
        )}
      </div>

      {open && (
        <div className="h-72 border-t border-zinc-800 sm:h-80">
          {loading && <GraphLoading />}
          {onlySelf && (
            <p className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-500">
              아직 연결된 문서가 없습니다. 본문에 [[문서명]]을 쓰면 여기 이어집니다.
            </p>
          )}
          {data && !onlySelf && (
            <GraphCanvas graph={data} centerId={path} onSelect={handleSelect} labelZoom={1.2} />
          )}
        </div>
      )}
    </section>
  );
}
