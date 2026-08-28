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
import { DARK_LABEL_COLOR, isLightFill } from '@/lib/mermaid-contrast';
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

function scaleSvg(svg: SVGElement): void {
  const viewBox = svg.getAttribute('viewBox');
  const width = viewBox ? Number(viewBox.trim().split(/[\s,]+/)[2]) : NaN;
  if (!width) return;

  svg.style.maxWidth = '100%';
  svg.style.width = `${Math.round(width * INLINE_SCALE)}px`;
  svg.style.height = 'auto';
}

/** 노드 안에서 배경이 되는 도형. 먼저 찾은 것을 배경색으로 본다. */
const SHAPE_SELECTOR = 'rect, polygon, circle, ellipse, path';

/**
 * 밝은 배경을 가진 노드의 글자색을 검은색으로 바꾼다.
 *
 * 다이어그램을 다크 테마로 렌더하므로 글자 기본색이 밝은 회색인데,
 * 다이어그램이 `style`/`classDef`로 파스텔 배경을 지정한 노드는
 * 밝은 배경 + 밝은 글자가 되어 읽기 어렵다. 배경색을 직접 재서 판정한다.
 *
 * mermaid의 스타일시트가 `.nodeLabel` 등에 색을 걸어 두므로, 속성이 아니라
 * **인라인 스타일 + important**로 덮어써야 확실히 이긴다.
 */
/**
 * 다이어그램이 글자색을 직접 지정했는지 확인한다(`style A fill:#eee,color:#333`).
 * 지정했다면 그 뜻을 존중해 건드리지 않는다.
 *
 * `background-color:`가 걸리지 않도록 속성 시작이나 `;` 뒤의 `color:`만 본다.
 */
function hasAuthoredLabelColor(node: Element): boolean {
  for (const element of node.querySelectorAll('[style]')) {
    if (/(?:^|;)\s*color\s*:/i.test(element.getAttribute('style') ?? '')) return true;
  }
  return false;
}

function fixLabelContrast(svg: SVGElement): void {
  for (const node of svg.querySelectorAll('.node, .cluster')) {
    const shape = node.querySelector(SHAPE_SELECTOR);
    if (!shape || hasAuthoredLabelColor(node)) continue;

    // 채움색은 style에 있을 수도, 속성에 있을 수도 있다(mermaid는 둘 다 쓴다).
    const inline = shape.getAttribute('style');
    const fromStyle = inline?.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1];
    if (!isLightFill(fromStyle ?? shape.getAttribute('fill'))) continue;

    // HTML 라벨(foreignObject 안의 div/span)과 <text> 라벨을 모두 덮는다.
    for (const label of node.querySelectorAll<HTMLElement | SVGElement>(
      'foreignObject div, foreignObject span, foreignObject p, text, tspan',
    )) {
      label.style.setProperty('color', DARK_LABEL_COLOR, 'important');
      label.style.setProperty('fill', DARK_LABEL_COLOR, 'important');
    }
  }
}

/**
 * 렌더된 SVG 문자열을 화면에 맞게 손본다(크기 + 라벨 대비).
 * 파싱에 실패하면 원본을 그대로 돌려준다 — 표시가 멈추는 것보다 낫다.
 */
function prepareSvg(raw: string): string {
  const parsed = new DOMParser().parseFromString(raw, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (!(svg instanceof SVGElement) || parsed.querySelector('parsererror')) return raw;

  scaleSvg(svg);
  fixLabelContrast(svg);

  return new XMLSerializer().serializeToString(svg);
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
        setSvg(prepareSvg(rendered.svg));
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
          w-full: prepareSvg가 건 max-width:100%의 기준이 뷰포트 폭이 되도록 래퍼를 펼친다. */}
      <div className="w-full [&_svg]:mx-auto" dangerouslySetInnerHTML={{ __html: svg }} />
    </ZoomPanViewer>
  );
}
