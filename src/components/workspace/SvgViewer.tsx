'use client';

/**
 * SVG 뷰어 — 확대·이동이 가능한 전체화면 오버레이.
 *
 * 두 곳에서 쓴다.
 * - `SvgFileViewer`: 그리드에서 `.svg` 파일을 클릭했을 때 (새 탭 대신 앱 안에서 연다)
 * - `ZoomableImage`: 마크다운 본문에 삽입된 SVG를 클릭했을 때
 *
 * 이미지는 `/api/thumbnail`이 원본 그대로(`image/svg+xml`) 내보내므로
 * 몇 배로 확대해도 래스터처럼 흐려지지 않는다.
 */

import { useState } from 'react';
import { ZoomPanOverlay } from './ZoomPanViewer';

/** `/api/thumbnail` URL을 만든다. SVG는 w가 무시되지만 계약상 필수 파라미터다. */
export function buildImageUrl(subpath: string, width = 1200): string {
  return `/api/thumbnail?path=${encodeURIComponent(subpath)}&w=${width}`;
}

/** 확장자가 .svg인지 (쿼리스트링이 붙어 있어도 판정한다). */
export function isSvgSource(src: string): boolean {
  const withoutQuery = src.split(/[?#]/)[0];
  return withoutQuery.toLowerCase().endsWith('.svg');
}

function LoadFailure({ name }: { name: string }) {
  return (
    <div className="rounded-xl border border-red-800/40 bg-red-950/20 px-6 py-8 text-center">
      <p className="text-sm text-red-300">SVG를 불러오지 못했습니다.</p>
      <p className="mt-1 text-xs text-red-400/70">{name}</p>
    </div>
  );
}

export interface SvgFileViewerProps {
  /** 표시용 파일명 */
  name: string;
  /** MARKDOWN_ROOT 기준 상대 경로 */
  subpath: string;
  onClose: () => void;
}

/** 저장된 `.svg` 파일 한 장을 전체화면으로 보여준다. */
export function SvgFileViewer({ name, subpath, onClose }: SvgFileViewerProps) {
  const [failed, setFailed] = useState(false);

  return (
    <ZoomPanOverlay label={`SVG 뷰어: ${name}`} title={name} onClose={onClose}>
      {failed ? (
        <LoadFailure name={name} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={buildImageUrl(subpath)}
          alt={name}
          onError={() => setFailed(true)}
          // 드래그 시 브라우저 기본 이미지 끌기가 끼어들지 않도록 막는다.
          draggable={false}
          className="max-h-[85vh] select-none"
        />
      )}
    </ZoomPanOverlay>
  );
}

export interface ZoomableImageProps {
  src: string;
  alt: string;
  className?: string;
}

/** 마크다운 본문의 이미지 — 클릭하면 확대 뷰어로 연다. */
export function ZoomableImage({ src, alt, className }: ZoomableImageProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${alt || '이미지'} 확대해서 보기`}
        className="block cursor-zoom-in rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" className={className} />
      </button>

      {open && (
        <ZoomPanOverlay
          label={`이미지 뷰어: ${alt || '이미지'}`}
          title={alt || undefined}
          onClose={() => setOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} draggable={false} className="max-h-[85vh] select-none" />
        </ZoomPanOverlay>
      )}
    </>
  );
}
