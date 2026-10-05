'use client';

/**
 * GraphCanvas — 문서 링크 그래프를 canvas로 그리는 힘 기반 레이아웃 (react-force-graph-2d).
 *
 * 브라우저 전용(window·canvas)이므로 **반드시 `next/dynamic`(`ssr: false`)으로 불러온다.**
 * 이 파일 안에서 ForceGraph2D를 직접 import해야 ref(zoomToFit)가 동작한다 —
 * ForceGraph2D 자체를 dynamic으로 감싸면 ref가 로더 컴포넌트에 걸려 버린다.
 *
 * 크기는 부모 요소를 따른다(ResizeObserver). 부모가 높이를 정해 줘야 한다.
 *
 * 노드:
 *   - 문서  회색 원, 연결이 많을수록 크게. 중심 문서는 앰버
 *   - 유령  (아직 없는 문서) 속이 빈 점선 원
 *   - 태그  청록 원
 * 마우스를 올리면 그 노드와 이웃만 밝히고 나머지는 흐리게 한다(Obsidian과 같다).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';

import type { GraphNode, GraphResponse } from '@/types/api';

type GNode = NodeObject<GraphNode>;
type GLink = LinkObject<GraphNode, { source: string; target: string }>;

export interface GraphCanvasProps {
  graph: GraphResponse;
  /** 강조할 중심 노드 id (로컬 그래프) */
  centerId?: string;
  /** 아직 없는 문서(유령) 노드 표시 여부 */
  showGhosts?: boolean;
  /** 이 배율 이상 확대하면 모든 라벨을 그린다 */
  labelZoom?: number;
  onSelect?: (node: GraphNode) => void;
}

const COLORS = {
  doc: '#a1a1aa', // zinc-400
  center: '#f59e0b', // amber-500
  ghost: '#52525b', // zinc-600
  tag: '#2dd4bf', // teal-400
  label: '#e4e4e7', // zinc-200
  link: 'rgba(113, 113, 122, 0.35)', // zinc-500
  linkActive: 'rgba(245, 158, 11, 0.8)',
};

/** 화면 맞춤 후 허용하는 최대 확대 배율. */
const MAX_FIT_ZOOM = 2.2;

function radiusOf(node: GraphNode, isCenter: boolean): number {
  return 3 + Math.sqrt(node.degree) * 1.6 + (isCenter ? 2 : 0);
}

/** force-graph가 링크 끝을 id에서 노드 객체로 바꿔 넣으므로 둘 다 처리한다. */
function endId(end: GLink['source']): string {
  return typeof end === 'object' && end !== null ? String((end as GNode).id) : String(end);
}

export default function GraphCanvas({
  graph,
  centerId,
  showGhosts = true,
  labelZoom = 1.6,
  onSelect,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const fittedRef = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  // --- 부모 크기 추적 ---------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- 데이터 (force-graph가 객체를 변형하므로 매번 복사본을 넘긴다) ------------
  const data = useMemo(() => {
    const nodes = graph.nodes.filter((n) => showGhosts || n.type !== 'ghost');
    const ids = new Set(nodes.map((n) => n.id));
    return {
      nodes: nodes.map((n) => ({ ...n })) as GNode[],
      links: graph.edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => ({ ...e })) as GLink[],
    };
  }, [graph, showGhosts]);

  // 새 데이터가 오면 한 번 화면에 맞춘다.
  useEffect(() => {
    fittedRef.current = false;
  }, [data]);

  // --- 마우스 강조 ---------------------------------------------------------------
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      if (!map.has(e.source)) map.set(e.source, new Set());
      if (!map.has(e.target)) map.set(e.target, new Set());
      map.get(e.source)!.add(e.target);
      map.get(e.target)!.add(e.source);
    }
    return map;
  }, [graph]);

  const isActive = useCallback(
    (id: string) => hoverId === null || id === hoverId || (neighbors.get(hoverId)?.has(id) ?? false),
    [hoverId, neighbors],
  );

  const paintNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isCenter = node.id === centerId;
      const r = radiusOf(node, isCenter);
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const active = isActive(node.id);

      ctx.globalAlpha = active ? 1 : 0.15;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      if (node.type === 'ghost') {
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 1 / globalScale;
        ctx.strokeStyle = COLORS.ghost;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = isCenter ? COLORS.center : node.type === 'tag' ? COLORS.tag : COLORS.doc;
        ctx.fill();
      }

      // 라벨: 확대했을 때 전부, 아니면 중심·마우스 주변·연결 많은 노드만
      const showLabel =
        globalScale >= labelZoom ||
        isCenter ||
        (hoverId !== null && active) ||
        node.degree >= 6;
      if (showLabel) {
        const fontSize = Math.max(10 / globalScale, 2);
        ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = node.type === 'ghost' ? COLORS.ghost : COLORS.label;
        const label = node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label;
        ctx.fillText(label, x, y + r + 1.5);
      }
      ctx.globalAlpha = 1;
    },
    [centerId, hoverId, isActive, labelZoom],
  );

  const paintPointerArea = useCallback(
    (node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, radiusOf(node, node.id === centerId) + 3, 0, 2 * Math.PI);
      ctx.fill();
    },
    [centerId],
  );

  const linkColor = useCallback(
    (link: GLink) => {
      if (hoverId === null) return COLORS.link;
      const s = endId(link.source);
      const t = endId(link.target);
      return s === hoverId || t === hoverId ? COLORS.linkActive : 'rgba(113, 113, 122, 0.08)';
    },
    [hoverId],
  );

  const handleEngineStop = useCallback(() => {
    if (fittedRef.current) return;
    fittedRef.current = true;
    const fg = fgRef.current;
    if (!fg) return;
    fg.zoomToFit(400, 40);
    // 노드가 몇 개뿐이면 화면에 맞추느라 과하게 확대된다 — 상한을 둔다.
    window.setTimeout(() => {
      if (fg.zoom() > MAX_FIT_ZOOM) fg.zoom(MAX_FIT_ZOOM, 300);
    }, 450);
  }, []);

  const docCount = graph.nodes.filter((n) => n.type === 'doc').length;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      role="img"
      aria-label={`문서 링크 그래프 — 문서 ${docCount}개, 연결 ${graph.edges.length}개`}
    >
      {size.width > 0 && size.height > 0 && (
        <ForceGraph2D<GraphNode, { source: string; target: string }>
          ref={fgRef}
          graphData={data}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          nodeId="id"
          nodeLabel={(n) => n.label}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintPointerArea}
          linkColor={linkColor}
          linkWidth={(l) => (hoverId !== null && (endId(l.source) === hoverId || endId(l.target) === hoverId) ? 1.5 : 0.6)}
          linkDirectionalArrowLength={2.5}
          linkDirectionalArrowRelPos={1}
          cooldownTicks={120}
          onEngineStop={handleEngineStop}
          onNodeHover={(n) => setHoverId(n ? String(n.id) : null)}
          onNodeClick={(n) => onSelect?.(n as GraphNode)}
        />
      )}
    </div>
  );
}
