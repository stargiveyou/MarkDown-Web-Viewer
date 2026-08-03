'use client';

/**
 * 확대·이동 뷰포트 — Mermaid 다이어그램과 SVG 파일 뷰어가 공유한다.
 *
 * 조작:
 * - 툴바 버튼 (축소 / 배율 / 확대 / 원본 크기 / 전체화면·닫기)
 * - Ctrl(⌘) + 휠 확대·축소 — 그냥 휠은 페이지 스크롤로 남겨 둔다.
 *   전체화면에서는 뒤 페이지가 스크롤되지 않으므로 휠만으로 확대된다.
 * - 드래그로 이동, 더블클릭으로 확대/원복
 * - 키보드: +/-(확대·축소), 0(원본), 방향키(이동), Esc(전체화면 닫기)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';

const MIN_SCALE = 0.4;
const MAX_SCALE = 8;
/** 버튼·키보드 1스텝 배율 */
const STEP = 1.25;
/** 방향키 1회 이동량(px) */
const PAN_STEP = 48;

interface Transform {
  scale: number;
  /** 뷰포트 중심 기준 이동량(px) */
  x: number;
  y: number;
}

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * 화면상의 한 점(뷰포트 중심 기준 상대좌표)을 고정한 채 배율만 바꾼다.
 *
 * transform은 `translate(x, y) scale(s)`, 원점은 뷰포트 중심이다.
 * 포인터 아래의 콘텐츠 좌표 u = (p - t) / s 를 배율 변경 후에도 유지하려면
 * t' = p - u·s' = p - (p - t)·(s'/s) 이면 된다.
 */
function zoomAround(current: Transform, factor: number, px: number, py: number): Transform {
  const scale = clampScale(current.scale * factor);
  const ratio = scale / current.scale;
  return {
    scale,
    x: px - (px - current.x) * ratio,
    y: py - (py - current.y) * ratio,
  };
}

export interface ZoomPanSurfaceProps {
  children: React.ReactNode;
  /** 스크린 리더용 설명 */
  label: string;
  /** 전체화면 오버레이 안에서 렌더되는 뷰포트인지 */
  fullscreen: boolean;
  /** 전체화면 열기(인라인) 또는 닫기(전체화면) */
  onToggleFullscreen: () => void;
  /** 인라인일 때 뷰포트 컨테이너에 덧붙일 클래스 */
  className?: string;
}

/** 확대·이동이 가능한 뷰포트 한 장. 전체화면 여부만 다르고 조작은 동일하다. */
export function ZoomPanSurface({
  children,
  label,
  fullscreen,
  onToggleFullscreen,
  className = '',
}: ZoomPanSurfaceProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);

  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const [dragging, setDragging] = useState(false);

  /** clientX/Y를 뷰포트 중심 기준 상대좌표로 바꾼다. */
  const toLocal = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { px: 0, py: 0 };
    return {
      px: clientX - (rect.left + rect.width / 2),
      py: clientY - (rect.top + rect.height / 2),
    };
  }, []);

  /** 뷰포트 중심을 기준으로 한 단계 확대/축소 (버튼·키보드용) */
  const zoomByStep = useCallback((factor: number) => {
    setTransform((prev) => zoomAround(prev, factor, 0, 0));
  }, []);

  const reset = useCallback(() => setTransform(IDENTITY), []);

  // 휠 확대 — preventDefault를 하려면 passive:false로 직접 붙여야 한다(React 합성 이벤트는 passive).
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (event: WheelEvent) => {
      // 인라인에서는 Ctrl(⌘)을 눌렀을 때만 확대한다 — 그냥 휠은 페이지 스크롤이어야 하므로.
      if (!fullscreen && !event.ctrlKey && !event.metaKey) return;

      event.preventDefault();
      const { px, py } = toLocal(event.clientX, event.clientY);
      // 트랙패드/휠의 delta 편차를 흡수하기 위해 지수로 환산한다.
      const factor = Math.exp(-event.deltaY / 300);
      setTransform((prev) => zoomAround(prev, factor, px, py));
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [fullscreen, toLocal]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // 툴바 버튼 클릭은 드래그로 취급하지 않는다.
      if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;

      dragOrigin.current = { x: event.clientX - transform.x, y: event.clientY - transform.y };
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [transform.x, transform.y],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current;
    if (!origin) return;

    setTransform((prev) => ({
      ...prev,
      x: event.clientX - origin.x,
      y: event.clientY - origin.y,
    }));
  }, []);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOrigin.current) return;
    dragOrigin.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  /** 더블클릭: 원본 크기면 클릭 지점을 중심으로 2배, 아니면 원본으로 되돌린다. */
  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest('button')) return;

      const { px, py } = toLocal(event.clientX, event.clientY);
      setTransform((prev) => (prev.scale === 1 ? zoomAround(prev, 2, px, py) : IDENTITY));
    },
    [toLocal],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const pan = (dx: number, dy: number) => {
        event.preventDefault();
        setTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      };

      switch (event.key) {
        case '+':
        case '=':
          event.preventDefault();
          zoomByStep(STEP);
          break;
        case '-':
        case '_':
          event.preventDefault();
          zoomByStep(1 / STEP);
          break;
        case '0':
          event.preventDefault();
          reset();
          break;
        case 'ArrowLeft': pan(PAN_STEP, 0); break;
        case 'ArrowRight': pan(-PAN_STEP, 0); break;
        case 'ArrowUp': pan(0, PAN_STEP); break;
        case 'ArrowDown': pan(0, -PAN_STEP); break;
        default:
          break;
      }
    },
    [zoomByStep, reset],
  );

  const percent = Math.round(transform.scale * 100);
  const moved = transform.scale !== 1 || transform.x !== 0 || transform.y !== 0;

  return (
    <div
      ref={viewportRef}
      role="group"
      aria-label={label}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      className={`group relative overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 ${
        dragging ? 'cursor-grabbing' : 'cursor-grab'
      } ${fullscreen ? 'h-full w-full' : className}`}
    >
      <div
        className="flex h-full w-full items-center justify-center p-4 [&_svg]:max-w-full [&_img]:max-w-full"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: 'center center',
          // 드래그 중에는 전환을 끄고, 버튼/휠 확대에는 약간의 보간을 준다.
          transition: dragging ? 'none' : 'transform 120ms ease-out',
        }}
      >
        {children}
      </div>

      {/* 툴바 — 인라인에서는 hover/focus 시에만 드러낸다. */}
      <div
        className={`absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/90 p-1 backdrop-blur transition-opacity ${
          fullscreen
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
        }`}
      >
        <button
          type="button"
          onClick={() => zoomByStep(1 / STEP)}
          disabled={transform.scale <= MIN_SCALE}
          aria-label="축소"
          className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>

        <span className="min-w-[3rem] text-center text-[11px] tabular-nums text-zinc-400">
          {percent}%
        </span>

        <button
          type="button"
          onClick={() => zoomByStep(STEP)}
          disabled={transform.scale >= MAX_SCALE}
          aria-label="확대"
          className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={reset}
          disabled={!moved}
          aria-label="원본 크기"
          className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? '전체화면 닫기' : '전체화면으로 보기'}
          className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
        >
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

export interface ZoomPanOverlayProps {
  children: React.ReactNode;
  label: string;
  /** 좌측 상단에 표시할 제목(파일명 등) */
  title?: string;
  onClose: () => void;
}

/** 전체화면 오버레이 — body에 포털로 붙여 상위 레이아웃(overflow/transform)의 영향을 받지 않는다. */
export function ZoomPanOverlay({ children, label, title, onClose }: ZoomPanOverlayProps) {
  // Esc 닫기 + 뒤 페이지 스크롤 잠금
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 bg-slate-950/95"
    >
      <ZoomPanSurface label={label} fullscreen onToggleFullscreen={onClose}>
        {children}
      </ZoomPanSurface>

      {title && (
        <p className="pointer-events-none absolute left-4 top-4 max-w-[60%] truncate text-sm text-slate-300">
          {title}
        </p>
      )}

      <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-slate-500">
        휠: 확대 · 드래그: 이동 · 더블클릭: 확대/원복 · Esc: 닫기
      </p>
    </div>,
    document.body,
  );
}

export interface ZoomPanViewerProps {
  children: React.ReactNode;
  label: string;
  /** 전체화면에서 표시할 제목 */
  title?: string;
  /** 인라인 뷰포트 컨테이너 클래스 */
  className?: string;
}

/** 인라인 뷰포트 + 전체화면 오버레이를 함께 제공하는 완성형 뷰어. */
export function ZoomPanViewer({ children, label, title, className }: ZoomPanViewerProps) {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <>
      <ZoomPanSurface
        label={label}
        fullscreen={false}
        onToggleFullscreen={() => setFullscreen(true)}
        className={className}
      >
        {children}
      </ZoomPanSurface>

      {fullscreen && (
        <ZoomPanOverlay label={label} title={title} onClose={() => setFullscreen(false)}>
          {children}
        </ZoomPanOverlay>
      )}
    </>
  );
}
