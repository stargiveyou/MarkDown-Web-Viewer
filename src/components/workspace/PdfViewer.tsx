'use client';

/**
 * PDF 뷰어 — pdf.js로 각 페이지를 canvas에 그린다.
 *
 * 왜 `<iframe>`/`<embed>`(브라우저 기본 뷰어)가 아닌가
 * ----------------------------------------------------
 * 1. 미들웨어가 모든 응답에 `X-Frame-Options: DENY`를 붙인다 — 같은 오리진이어도
 *    프레임 삽입이 차단되므로, 기본 뷰어를 쓰려면 전역 보안 헤더를 느슨하게 해야 한다.
 * 2. iOS Safari는 프레임 안의 PDF를 **첫 페이지만** 렌더하는 고질적인 문제가 있다.
 *    이 앱은 아이폰에 설치해 쓰는 PWA이므로 그 경로가 핵심 사용 환경이다.
 *
 * 그래서 `/api/pdf`에서 바이트만 받아(= 인증·413·429 처리를 `apiBytes`가 그대로 태운다)
 * 직접 렌더한다. 파일을 그대로 보고 싶으면 `/api/pdf?path=...`를 새 탭에서 열면 된다.
 *
 * 렌더 전략: 보이는 페이지 ±1.5화면만 canvas를 유지한다. 전 페이지를 들고 있으면
 * 수백 페이지 문서에서 캔버스 메모리가 GB 단위로 늘어난다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs';

import { ApiRequestError, apiBytes } from '@/lib/fetcher';

/** `scripts/copy-pdfjs.mjs`가 public 하위로 복사해 두는 런타임 자산 경로. */
const ASSET_BASE = '/pdfjs/';

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const SCALE_STEP = 1.25;

/** fit-width 계산 시 좌우에 비워 두는 여백(px). */
const PAGE_GUTTER = 32;

/**
 * 캔버스 백스토어 상한(픽셀 수). iOS Safari는 이보다 큰 캔버스를 **빈 화면**으로 떨어뜨리므로
 * 고배율에서 해상도를 낮춰서라도 그려지게 한다.
 */
const MAX_CANVAS_PIXELS = 12_000_000;

/** 화면 위아래로 미리 렌더해 두는 범위. 스크롤 중 빈 페이지가 보이지 않을 만큼만. */
const PRERENDER_MARGIN = '150% 0px';

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

/**
 * pdf.js는 번들이 크고(워커 별도) 뷰어에서만 쓰므로 동적으로 한 번만 불러온다.
 * 워커 경로는 같은 오리진의 복사본을 가리킨다 — CDN을 쓰지 않는다.
 *
 * **legacy 빌드**를 쓰는 이유: 기본 빌드는 `Promise.try`처럼 아주 최신 문법을 트랜스파일 없이
 * 내보내서, 조금 옛 iOS Safari에서 문서가 열리지 않는다(홈 화면에 설치해 쓰는 앱이다).
 * `scripts/copy-pdfjs.mjs`가 복사하는 워커도 같은 legacy 빌드여야 한다.
 */
let pdfjsPromise: Promise<PdfjsModule> | null = null;
function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
    mod.GlobalWorkerOptions.workerSrc = `${ASSET_BASE}pdf.worker.min.mjs`;
    return mod;
  });
  return pdfjsPromise;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * pdf.js가 던지는 예외를 사용자에게 보여줄 문장으로 바꾼다.
 * 클래스를 import하지 않고 `name`으로 판정한다 — 모듈 로드 자체가 실패한 경우에도 동작해야 한다.
 */
function pdfErrorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'PasswordException') return '암호로 보호된 PDF입니다. 암호 입력은 지원하지 않습니다.';
  if (name === 'InvalidPDFException') return '손상되었거나 PDF 형식이 아닌 파일입니다.';
  return 'PDF를 불러오지 못했습니다.';
}

/** 한 문서의 로드 결과. `subpath`를 함께 들고 있어 "어느 문서의 결과인지"가 분명하다. */
interface LoadResult {
  subpath: string;
  doc: PDFDocumentProxy | null;
  baseSize: { width: number; height: number } | null;
  /** 빈 문자열이면 오류 없음(401은 리다이렉트 중이라 메시지를 비운다). */
  error: string;
}

export interface PdfViewerProps {
  /** MARKDOWN_ROOT 기준 상대 경로 */
  subpath: string;
}

export function PdfViewer({ subpath }: PdfViewerProps) {
  // 스크롤 컨테이너는 하위 페이지의 IntersectionObserver root로 넘겨야 해서 상태로 보관한다
  // (ref.current는 첫 렌더에 비어 있어 effect가 구독 시점을 놓친다).
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());

  /**
   * 로드 결과는 **어느 문서의 것인지**와 함께 보관한다. 그래야 `subpath`가 바뀐 직후에도
   * 이전 문서의 캔버스가 한 프레임 비치지 않고, effect 본문에서 상태를 되돌릴 필요가 없다
   * (뷰어 페이지의 `linkState`와 같은 방식).
   */
  const [result, setResult] = useState<LoadResult | null>(null);
  const active = result?.subpath === subpath ? result : null;
  const doc = active?.doc ?? null;
  /** 배율 1 기준 1페이지 크기 — 아직 렌더되지 않은 페이지의 자리 높이를 잡는 데 쓴다. */
  const baseSize = active?.baseSize ?? null;
  const error = active?.error ?? '';
  const loading = active === null;

  const [containerWidth, setContainerWidth] = useState(0);
  const [fitWidth, setFitWidth] = useState(true);
  const [manualScale, setManualScale] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);

  // --- 문서 로드 -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    // 문서 해제는 로딩 태스크가 담당한다 — 워커까지 함께 내려야 뷰어를 닫았을 때
    // 백그라운드 워커가 남지 않는다.
    let task: PDFDocumentLoadingTask | null = null;

    (async () => {
      try {
        const [pdfjs, bytes] = await Promise.all([
          loadPdfjs(),
          apiBytes(`/api/pdf?path=${encodeURIComponent(subpath)}`),
        ]);
        if (cancelled) return;

        task = pdfjs.getDocument({
          data: new Uint8Array(bytes),
          // 한글·CJK PDF에서 폰트가 임베드되지 않은 경우 CMap이 없으면 글자가 깨진다.
          cMapUrl: `${ASSET_BASE}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
          wasmUrl: `${ASSET_BASE}wasm/`,
          iccUrl: `${ASSET_BASE}iccs/`,
        });

        const loaded: PDFDocumentProxy = await task.promise;
        if (cancelled) return;

        const first = await loaded.getPage(1);
        const viewport = first.getViewport({ scale: 1 });
        if (cancelled) return;

        setResult({
          subpath,
          doc: loaded,
          baseSize: { width: viewport.width, height: viewport.height },
          error: '',
        });
      } catch (caught) {
        if (cancelled) return;
        // 401은 fetcher가 이미 /login으로 보내는 중이다 — 메시지 없이 로딩만 끝낸다.
        const message =
          caught instanceof ApiRequestError
            ? caught.code === 401
              ? ''
              : caught.message
            : pdfErrorMessage(caught);
        setResult({ subpath, doc: null, baseSize: null, error: message });
      }
    })();

    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [subpath]);

  // --- 컨테이너 폭 추적 (fit-width 계산용) -------------------------------------
  useEffect(() => {
    if (!scrollRoot) return;

    // observe()는 즉시 현재 크기로 한 번 발화하므로 초기값을 따로 넣지 않는다.
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(scrollRoot);
    return () => observer.disconnect();
  }, [scrollRoot]);

  const fitScale = useMemo(() => {
    if (!baseSize || containerWidth <= 0) return 1;
    return clampScale((containerWidth - PAGE_GUTTER * 2) / baseSize.width);
  }, [baseSize, containerWidth]);

  const scale = fitWidth ? fitScale : manualScale;

  const zoomBy = useCallback(
    (factor: number) => {
      // fit-width에서 처음 확대/축소하면 현재 보이는 배율을 출발점으로 삼는다.
      setManualScale((prev) => clampScale((fitWidth ? fitScale : prev) * factor));
      setFitWidth(false);
    },
    [fitWidth, fitScale],
  );

  // --- 현재 페이지 추적 -------------------------------------------------------
  // IntersectionObserver는 "변화한 요소"만 돌려주므로 가장 많이 보이는 페이지를 고르기에
  // 부정확하다. 컨테이너 상단에서 1/3 지점을 기준선으로 두고 직접 판정한다.
  useEffect(() => {
    if (!scrollRoot || !doc) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const probe = scrollRoot.scrollTop + scrollRoot.clientHeight / 3;
      let found = 1;
      for (let n = 1; n <= doc.numPages; n += 1) {
        const el = pageRefs.current.get(n);
        if (!el) continue;
        if (el.offsetTop > probe) break;
        found = n;
      }
      setCurrentPage(found);
    };

    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      scrollRoot.removeEventListener('scroll', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [scrollRoot, doc]);

  const goToPage = useCallback((pageNumber: number) => {
    const el = pageRefs.current.get(pageNumber);
    if (!el || !scrollRoot) return;
    scrollRoot.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
  }, [scrollRoot]);

  const registerPageRef = useCallback((pageNumber: number, el: HTMLDivElement | null) => {
    if (el) pageRefs.current.set(pageNumber, el);
    else pageRefs.current.delete(pageNumber);
  }, []);

  // --- 키보드 조작 (뷰어에 포커스가 있을 때) -----------------------------------
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target instanceof HTMLInputElement) return;

      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomBy(SCALE_STEP);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomBy(1 / SCALE_STEP);
      } else if (event.key === '0') {
        event.preventDefault();
        setFitWidth(true);
      }
    },
    [zoomBy],
  );

  const totalPages = doc?.numPages ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 툴바 — 페이지 이동 + 배율 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/70 px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goToPage(Math.max(1, currentPage - 1))}
            disabled={!doc || currentPage <= 1}
            aria-label="이전 페이지"
            className="rounded-lg border border-slate-700 p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-1 text-xs tabular-nums text-slate-400" aria-live="polite">
            {totalPages > 0 ? `${currentPage} / ${totalPages}` : '—'}
          </span>
          <button
            type="button"
            onClick={() => goToPage(Math.min(totalPages, currentPage + 1))}
            disabled={!doc || currentPage >= totalPages}
            aria-label="다음 페이지"
            className="rounded-lg border border-slate-700 p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => zoomBy(1 / SCALE_STEP)}
            disabled={!doc}
            aria-label="축소"
            className="rounded-lg border border-slate-700 p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-slate-400">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => zoomBy(SCALE_STEP)}
            disabled={!doc}
            aria-label="확대"
            className="rounded-lg border border-slate-700 p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setFitWidth(true)}
            disabled={!doc || fitWidth}
            aria-label="폭 맞춤"
            title="폭 맞춤"
            className="ml-1 flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">폭 맞춤</span>
          </button>
        </div>
      </div>

      {/* 페이지 스크롤 영역 — position:relative여야 하위 페이지의 offsetTop이 이 컨테이너 기준이 된다 */}
      <div
        ref={setScrollRoot}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="relative min-h-0 flex-1 overflow-auto bg-slate-950 px-4 py-4 outline-none"
      >
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
            <span className="ml-2 text-sm text-slate-500">PDF를 불러오는 중...</span>
          </div>
        )}

        {error && !loading && (
          <div className="mx-auto max-w-md rounded-xl border border-red-800/40 bg-red-950/20 px-6 py-8 text-center">
            <p className="text-sm text-red-300">{error}</p>
            <p className="mt-2 text-xs text-red-400/70">
              파일을 내려받아 로컬 뷰어에서 열어 볼 수 있습니다.
            </p>
          </div>
        )}

        {doc && baseSize && !error && (
          <div className="flex flex-col items-center gap-4">
            {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((pageNumber) => (
              <PdfPage
                key={pageNumber}
                doc={doc}
                pageNumber={pageNumber}
                scale={scale}
                baseSize={baseSize}
                scrollRoot={scrollRoot}
                registerRef={registerPageRef}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 페이지 한 장
// ---------------------------------------------------------------------------

interface PdfPageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  baseSize: { width: number; height: number };
  scrollRoot: HTMLDivElement | null;
  registerRef: (pageNumber: number, el: HTMLDivElement | null) => void;
}

function PdfPage({ doc, pageNumber, scale, baseSize, scrollRoot, registerRef }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);
  /**
   * 캔버스에 그려진 배율. 현재 배율과 다르거나(= 확대 직후) 화면에서 벗어났으면
   * 자리표시자를 덮는다 — 상태를 effect에서 되돌리지 않고 파생시키기 위한 형태다.
   */
  const [renderedScale, setRenderedScale] = useState<number | null>(null);
  /** 배율 1 기준 이 페이지의 실제 크기. 렌더 전에는 1페이지 크기로 자리만 잡는다. */
  const [intrinsic, setIntrinsic] = useState<{ width: number; height: number } | null>(null);

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // 렌더마다 새 함수를 넘기면 React가 매번 ref를 떼었다 붙이므로 동일성을 유지한다.
  const attachWrapper = useCallback(
    (el: HTMLDivElement | null) => {
      wrapperRef.current = el;
      registerRef(pageNumber, el);
    },
    [pageNumber, registerRef],
  );

  // --- 화면 근처에 들어왔는지 ---------------------------------------------------
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || !scrollRoot) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting);
      },
      { root: scrollRoot, rootMargin: PRERENDER_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRoot]);

  // --- 렌더 ------------------------------------------------------------------
  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    let task: RenderTask | null = null;
    let page: PDFPageProxy | null = null;
    // 정리 시점에 ref를 다시 읽으면 이미 다른 노드일 수 있어, 그린 캔버스를 그대로 들고 있는다.
    let painted: HTMLCanvasElement | null = null;

    (async () => {
      try {
        page = await doc.getPage(pageNumber);
        if (cancelled) return;

        const css = page.getViewport({ scale });
        setIntrinsic({ width: css.width / scale, height: css.height / scale });

        // 고해상도 화면에서 흐려지지 않도록 백스토어를 DPR배로 잡되,
        // 캔버스 상한을 넘기면 그 비율만큼 해상도를 낮춘다(빈 화면보다 낫다).
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pixels = css.width * dpr * css.height * dpr;
        const shrink = pixels > MAX_CANVAS_PIXELS ? Math.sqrt(MAX_CANVAS_PIXELS / pixels) : 1;
        const viewport = page.getViewport({ scale: scale * dpr * shrink });

        const canvas = canvasRef.current;
        if (!canvas) return;
        painted = canvas;
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));

        task = page.render({ canvas, viewport });
        await task.promise;
        if (!cancelled) setRenderedScale(scale);
      } catch (caught) {
        // 배율 변경·스크롤로 취소된 렌더는 정상 흐름이다.
        if (cancelled || (caught as { name?: string } | null)?.name === 'RenderingCancelledException') {
          return;
        }
        console.error('[PdfViewer] page render failed:', caught);
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
      // 페이지가 화면에서 멀어지면 pdf.js가 들고 있는 중간 산출물도 함께 놓아준다.
      page?.cleanup();
      // 캔버스 백스토어를 즉시 돌려준다. 수백 페이지 문서에서 이게 없으면
      // 스크롤한 만큼 캔버스 메모리가 그대로 쌓인다.
      if (painted) {
        painted.width = 0;
        painted.height = 0;
      }
    };
  }, [visible, doc, pageNumber, scale]);

  const size = intrinsic ?? baseSize;
  const rendered = visible && renderedScale === scale;

  return (
    <div
      ref={attachWrapper}
      data-page-number={pageNumber}
      style={{ width: Math.round(size.width * scale), height: Math.round(size.height * scale) }}
      className="relative shrink-0 overflow-hidden rounded bg-white shadow-lg shadow-black/40"
    >
      {visible && <canvas ref={canvasRef} className="block h-full w-full" />}
      {!rendered && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-200">
          <span className="text-xs tabular-nums text-slate-500">{pageNumber}</span>
        </div>
      )}
    </div>
  );
}
