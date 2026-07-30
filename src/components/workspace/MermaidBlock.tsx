'use client';

/**
 * Mermaid 다이어그램 렌더러.
 *
 * 마크다운 코드 블록에서 ```mermaid 언어를 감지하면
 * 이 컴포넌트가 mermaid.render()로 SVG를 생성해 표시한다.
 *
 * 다크 테마(dark)를 기본으로 사용하며, 렌더 실패 시 원본 코드를 표시한다.
 */

import { useEffect, useId, useRef, useState } from 'react';

let mermaidInitialized = false;

async function ensureMermaid() {
  const mermaid = (await import('mermaid')).default;
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'strict',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    });
    mermaidInitialized = true;
  }
  return mermaid;
}

export function MermaidBlock({ code }: { code: string }) {
  const id = useId().replace(/:/g, '_');
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = await ensureMermaid();
        const { svg } = await mermaid.render(`mermaid-${id}`, code.trim());
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Mermaid render failed');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [code, id]);

  if (error) {
    return (
      <div className="my-4 rounded-xl border border-red-800/40 bg-red-950/20 p-4">
        <p className="mb-2 text-xs font-medium text-red-400">Mermaid 렌더 오류</p>
        <pre className="overflow-x-auto text-xs text-zinc-400">{code}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-4 flex justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 [&_svg]:max-w-full"
    />
  );
}
