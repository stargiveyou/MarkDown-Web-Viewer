'use client';

/**
 * 전체 그래프 — /workspace/graph
 *
 * 색인된 모든 문서와 문서 간 링크를 힘 기반 그래프로 보여준다(Obsidian 그래프 뷰).
 * 연결 없는 문서도 점으로 나온다. 노드가 상한(서버 `GRAPH_MAX_NODES`)을 넘으면
 * 연결이 적은 문서부터 빠지고 안내가 뜬다.
 *
 * 문서 노드를 누르면 뷰어로 이동한다.
 */

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { emitToast } from '@/components/ui/toast-bus';
import { viewerHref } from '@/components/workspace/DocLink';
import { useGraph } from '@/components/workspace/use-graph';
import type { GraphNode } from '@/types/api';

const GraphCanvas = dynamic(() => import('@/components/workspace/GraphCanvas'), {
  ssr: false,
  loading: () => <Centered>그래프를 그리는 중…</Centered>,
});

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin text-amber-400" />
      {children}
    </div>
  );
}

function GraphPageInner() {
  const router = useRouter();
  const [tags, setTags] = useState(false);
  const [ghosts, setGhosts] = useState(true);
  const { data, failed, loading } = useGraph({ tags });

  useEffect(() => {
    document.title = 'Husky Works MDs - 그래프';
    return () => {
      document.title = 'Husky Works MDs';
    };
  }, []);

  const handleSelect = useCallback(
    (node: GraphNode) => {
      if (node.type === 'doc') router.push(viewerHref(node.id));
      else if (node.type === 'ghost') {
        emitToast({ message: `"${node.label}" 문서는 아직 없습니다.`, variant: 'info' });
      }
    },
    [router],
  );

  const docCount = data?.nodes.filter((n) => n.type === 'doc').length ?? 0;
  const orphanCount = data?.nodes.filter((n) => n.type === 'doc' && n.degree === 0).length ?? 0;

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 font-sans text-zinc-300">
      <header className="border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md">
        <div className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => router.push('/workspace')}
              className="flex items-center gap-1.5 rounded text-sm text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
            >
              <ArrowLeft className="h-4 w-4" />
              목록으로
            </button>
            <span className="text-zinc-700">|</span>
            <h1 className="truncate text-sm font-medium text-zinc-100">문서 그래프</h1>
            {data && (
              <span className="hidden text-xs text-zinc-500 sm:inline">
                문서 {docCount} · 연결 {data.edges.length} · 고립 {orphanCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 text-xs text-zinc-400">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={tags}
                onChange={(e) => setTags(e.target.checked)}
                className="accent-amber-500"
              />
              태그
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={ghosts}
                onChange={(e) => setGhosts(e.target.checked)}
                className="accent-amber-500"
              />
              아직 없는 문서
            </label>
          </div>
        </div>
        {data?.truncated && (
          <p className="border-t border-amber-900/40 bg-amber-950/30 px-6 py-1.5 text-xs text-amber-300">
            문서가 많아 연결이 많은 순으로 일부만 표시합니다.
          </p>
        )}
      </header>

      <main className="min-h-0 flex-1">
        {loading && <Centered>그래프를 불러오는 중…</Centered>}
        {failed && (
          <p className="flex h-full items-center justify-center text-sm text-red-300">
            그래프를 불러오지 못했습니다.
          </p>
        )}
        {data && data.nodes.length === 0 && (
          <p className="flex h-full items-center justify-center text-sm text-zinc-500">
            색인된 문서가 없습니다.
          </p>
        )}
        {data && data.nodes.length > 0 && (
          <GraphCanvas graph={data} showGhosts={ghosts} onSelect={handleSelect} />
        )}
      </main>
    </div>
  );
}

export default function GraphPage() {
  return (
    <Suspense fallback={<Centered>불러오는 중…</Centered>}>
      <GraphPageInner />
    </Suspense>
  );
}
