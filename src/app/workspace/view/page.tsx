'use client';

/**
 * 마크다운 뷰어 페이지 -- /workspace/view?path=file.md
 *
 * - apiFetch<FileContentResponse>로 파일 내용을 로드한다.
 * - react-markdown + remark-gfm + rehype-highlight로 렌더한다.
 * - 이미지 참조는 상대 경로를 /api/thumbnail?path=...&w=800으로 변환한다.
 * - 외부 URL (http/https)은 그대로 통과시킨다.
 * - 모든 이미지는 <img> 태그로만 렌더한다 (D2-1: SVG XSS 방어).
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MarkdownHooks as Markdown } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeHighlight from 'rehype-highlight';
import { ArrowLeft, Download, Pencil, Share2, Loader2 } from 'lucide-react';
import { apiFetch, apiDownload, toApiRequestError } from '@/lib/fetcher';
import { emitToast } from '@/components/ui/toast-bus';
import { ShareModal } from '@/components/workspace/ShareModal';
import type { FileContentResponse } from '@/types/api';

import 'highlight.js/styles/github-dark.css';

/** 외부 URL인지 판별한다. */
function isExternalUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/**
 * 상대 이미지 경로를 /api/thumbnail URL로 변환한다.
 * 현재 파일의 디렉터리를 기준으로 해석한다.
 */
function resolveImageSrc(src: string, filePath: string): string {
  if (isExternalUrl(src)) return src;

  // ./ 접두사 제거
  const cleanSrc = src.startsWith('./') ? src.slice(2) : src;
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  const imagePath = dir ? `${dir}/${cleanSrc}` : cleanSrc;

  return `/api/thumbnail?path=${encodeURIComponent(imagePath)}&w=800`;
}

function ViewerPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const path = searchParams.get('path') || '';

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (!path) {
      router.replace('/workspace');
      return;
    }

    let cancelled = false;

    async function loadFile() {
      setLoading(true);
      setError('');

      try {
        const data = await apiFetch<FileContentResponse>(
          `/api/file-content?path=${encodeURIComponent(path)}`,
        );
        if (!cancelled) {
          setContent(data.content);
        }
      } catch (caught) {
        if (cancelled) return;
        const err = toApiRequestError(caught);
        if (err.code !== 401) {
          setError(err.message);
          emitToast({ message: err.message, variant: 'error' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadFile();
    return () => { cancelled = true; };
  }, [path, router]);

  const handleBackToList = useCallback(() => {
    const parentPath = path.substring(0, path.lastIndexOf('/'));
    router.push(`/workspace?path=${encodeURIComponent(parentPath)}`);
  }, [path, router]);

  const handleEdit = useCallback(() => {
    router.push(`/workspace/edit?path=${encodeURIComponent(path)}`);
  }, [path, router]);

  // 파일명 추출 (헤더 표시용)
  const fileName = path.substring(path.lastIndexOf('/') + 1) || path;

  return (
    <div className="flex flex-1 flex-col bg-zinc-950 font-sans text-zinc-300">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={handleBackToList}
              className="flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 rounded"
            >
              <ArrowLeft className="h-4 w-4" />
              목록으로
            </button>
            <span className="text-zinc-700">|</span>
            <h1 className="truncate text-sm font-medium text-zinc-100">
              {fileName}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const url = `/api/download?path=${encodeURIComponent(path)}`;
                apiDownload(url, fileName).catch((err) => {
                  const apiErr = toApiRequestError(err);
                  if (apiErr.code !== 401) {
                    emitToast({ message: apiErr.message, variant: 'error' });
                  }
                });
              }}
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
            <button
              type="button"
              onClick={handleEdit}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
            >
              <Pencil className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">편집</span>
            </button>
          </div>
        </div>
      </header>

      {/* 본문 */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
            <span className="ml-2 text-sm text-zinc-500">
              파일을 불러오는 중...
            </span>
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl border border-red-800/40 bg-red-950/20 px-6 py-8 text-center">
            <p className="text-sm text-red-300">{error}</p>
            <button
              type="button"
              onClick={handleBackToList}
              className="mt-4 rounded-lg border border-red-700 px-3.5 py-2 text-sm text-red-300 transition-colors hover:bg-red-900/30"
            >
              목록으로 돌아가기
            </button>
          </div>
        )}

        {!loading && !error && (
          <article className="prose prose-invert max-w-none prose-img:rounded-lg prose-img:shadow-md">
            <Markdown
              remarkPlugins={[remarkFrontmatter, remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                img: ({ src, alt, ...rest }) => {
                  if (!src || typeof src !== 'string') return null;
                  const resolvedSrc = resolveImageSrc(src, path);
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      {...rest}
                      src={resolvedSrc}
                      alt={alt || ''}
                      loading="lazy"
                    />
                  );
                },
              }}
            >
              {content}
            </Markdown>
          </article>
        )}
      </main>

      {/* 공유 모달 */}
      <ShareModal
        filePath={path}
        fileName={fileName}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}

export default function ViewerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center bg-zinc-950">
          <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
          <span className="ml-2 text-sm text-zinc-500">
            뷰어를 불러오는 중...
          </span>
        </div>
      }
    >
      <ViewerPageInner />
    </Suspense>
  );
}
