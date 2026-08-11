'use client';

/**
 * Mermaid 다이어그램 렌더러.
 *
 * 마크다운 코드 블록에서 ```mermaid 언어를 감지하면
 * 이 컴포넌트가 mermaid.render()로 SVG를 생성해 표시한다.
 *
 * 다크 테마(dark)를 기본으로 사용하며, 렌더 실패 시 원본 코드를 표시한다.
 * 확대·이동·전체화면 조작은 `ZoomPanViewer`가 담당한다.
 */

import { useEffect, useId, useState } from 'react';
import { ZoomPanViewer } from './ZoomPanViewer';

let mermaidInitialized = false;

/**
 * 인라인 표시 배율. mermaid는 SVG 루트에 원본 폭을 `max-width`로 박아 넣는데,
 * 그대로 두면 다이어그램(과 뷰어 높이)이 너무 작게 렌더된다.
 * 폭 상한을 키우면 viewBox 비율에 따라 높이도 같이 커진다.
 * (뷰포트 폭보다 커지는 경우는 ZoomPanViewer의 `[&_svg]:max-w-full`이 잘라 준다.)
 */
const INLINE_SCALE = 3;

function scaleSvg(svg: string): string {
  return svg.replace(
    /max-width:\s*([\d.]+)px/,
    (_, width) => `max-width: ${parseFloat(width) * INLINE_SCALE}px`,
  );
}

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
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = await ensureMermaid();
        const rendered = await mermaid.render(`mermaid-${id}`, code.trim());
        if (cancelled) return;
        setSvg(scaleSvg(rendered.svg));
        setError(null);
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

  // 렌더 전에는 자리만 잡아 둔다(레이아웃 점프 방지).
  if (!svg) {
    return <div className="my-4 h-24 rounded-xl border border-zinc-800 bg-zinc-900/50" />;
  }

  return (
    <ZoomPanViewer
      label="Mermaid 다이어그램 (확대·이동 가능)"
      title="Mermaid 다이어그램"
      className="my-4 rounded-xl border border-zinc-800 bg-zinc-900/50"
    >
      {/* mermaid는 securityLevel:'strict'로 렌더된 SVG를 돌려준다. */}
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </ZoomPanViewer>
  );
}
