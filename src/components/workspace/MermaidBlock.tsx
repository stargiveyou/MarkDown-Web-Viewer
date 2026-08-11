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
 * 인라인 표시 배율. mermaid는 SVG를 원본 크기(`width="100%"` + `max-width: 원본폭`)로
 * 돌려주는데, 그대로 두면 노드가 많은 다이어그램일수록 글자가 작게 렌더된다.
 * viewBox에서 원본 폭을 읽어 명시적 픽셀 폭(원본 × 배율)을 지정한다 —
 * max-width 상한만 키우는 방식은 가운데 정렬 flex 안에서 래퍼가 원본 폭으로
 * 수축해 실제 표시 크기가 커지지 않는다.
 * 높이는 `auto`라 viewBox 비율대로 따라 커지고, 뷰포트보다 넓어지면
 * `max-width:100%`로 축소된다(세부는 확대·이동으로 본다).
 */
const INLINE_SCALE = 3;

function scaleSvg(svg: string): string {
  const headEnd = svg.indexOf('>');
  if (headEnd === -1) return svg;

  const head = svg.slice(0, headEnd);
  const viewBox = head.match(/viewBox="([^"]+)"/);
  const width = viewBox ? Number(viewBox[1].trim().split(/[\s,]+/)[2]) : NaN;
  if (!width) return svg;

  const sized = `style="max-width:100%;width:${Math.round(width * INLINE_SCALE)}px;height:auto;"`;
  const newHead = /style="/.test(head)
    ? head.replace(/style="[^"]*"/, sized)
    : `${head} ${sized}`;
  return newHead + svg.slice(headEnd);
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
      {/* mermaid는 securityLevel:'strict'로 렌더된 SVG를 돌려준다.
          w-full: scaleSvg의 max-width:100% 기준이 뷰포트 폭이 되도록 래퍼를 펼친다. */}
      <div className="w-full [&_svg]:mx-auto" dangerouslySetInnerHTML={{ __html: svg }} />
    </ZoomPanViewer>
  );
}
