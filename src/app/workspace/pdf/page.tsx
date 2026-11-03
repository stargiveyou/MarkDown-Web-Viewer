'use client';

/**
 * PDF 뷰어 페이지 — /workspace/pdf?path=file.pdf
 *
 * 마크다운 뷰어(`/workspace/view`)와 머리글 구성(목록으로 · 다운로드 · 공유)은 같고,
 * 본문만 `PdfViewer`(pdf.js canvas 렌더)로 바뀐다. PDF는 편집 대상이 아니라 편집 버튼이 없다.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Download, ExternalLink, Share2 } from 'lucide-react';

import { BootFallback } from '@/components/ui/BootFallback';
import { emitToast } from '@/components/ui/toast-bus';
import { PdfViewer } from '@/components/workspace/PdfViewer';
import { ShareModal } from '@/components/workspace/ShareModal';
import { apiDownload, toApiRequestError } from '@/lib/fetcher';
import { NEW_WINDOW_LINK_PROPS, isPdfSubpath } from '@/lib/viewer-nav';

function PdfPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const path = searchParams.get('path') || '';

  const [shareOpen, setShareOpen] = useState(false);

  const fileName = path.substring(path.lastIndexOf('/') + 1) || path;

  // PDF가 아닌 경로로 들어오면(수동 URL 조작·오래된 링크) 목록으로 돌려보낸다.
  useEffect(() => {
    if (!path || !isPdfSubpath(path)) router.replace('/workspace');
  }, [path, router]);

  useEffect(() => {
    if (!fileName) return;
    document.title = `Husky Works MDs - ${fileName}`;
    return () => {
      document.title = 'Husky Works MDs';
    };
  }, [fileName]);

  const handleBackToList = useCallback(() => {
    const parentPath = path.substring(0, path.lastIndexOf('/'));
    router.push(parentPath ? `/workspace?path=${encodeURIComponent(parentPath)}` : '/workspace');
  }, [path, router]);

  const handleDownload = useCallback(() => {
    apiDownload(`/api/download?path=${encodeURIComponent(path)}`, fileName).catch((err) => {
      const apiErr = toApiRequestError(err);
      if (apiErr.code !== 401) {
        emitToast({ message: apiErr.message, variant: 'error' });
      }
    });
  }, [path, fileName]);

  if (!path || !isPdfSubpath(path)) {
    return <BootFallback label="목록으로 돌아가는 중..." />;
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-950 font-sans text-zinc-300">
      {/* 헤더 */}
      <header className="shrink-0 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md">
        <div className="flex w-full items-center justify-between gap-4 px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={handleBackToList}
              className="flex items-center gap-1.5 rounded text-sm text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
            >
              <ArrowLeft className="h-4 w-4" />
              목록으로
            </button>
            <span className="text-zinc-700">|</span>
            <h1 className="truncate text-sm font-medium text-zinc-100">{fileName}</h1>
          </div>

          <div className="flex items-center gap-2">
            {/* 브라우저 기본 PDF 뷰어로 열기 — 아이폰에서 "공유·인쇄"로 넘기는 경로 */}
            <a
              href={`/api/pdf?path=${encodeURIComponent(path)}`}
              {...NEW_WINDOW_LINK_PROPS}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
              title="새 탭에서 원본 열기"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">원본</span>
            </a>
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
              title="다운로드"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">다운로드</span>
            </button>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
              title="공유하기"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">공유</span>
            </button>
          </div>
        </div>
      </header>

      <PdfViewer subpath={path} />

      <ShareModal
        filePath={path}
        fileName={fileName}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}

export default function PdfViewerPage() {
  return (
    <Suspense fallback={<BootFallback label="PDF 뷰어를 불러오는 중..." />}>
      <PdfPageInner />
    </Suspense>
  );
}
