'use client';

/**
 * Monaco 에디터 페이지 -- /workspace/edit?path=file.md
 *
 * 분할 뷰: 좌측 Monaco 에디터 + 우측 react-markdown 실시간 미리보기.
 *
 * 저장:
 * - Cmd+S / Ctrl+S -> PUT /api/file-content { path, content, baseMtime }
 * - 성공: baseMtime 갱신 + isDirty 해제 + 성공 토스트
 * - 409: ConflictWarning 표시 + 에러 토스트
 * - 그 외: 에러 토스트
 *
 * 미저장 이탈 경고: beforeunload 이벤트로 처리한다.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Editor, { type OnMount } from '@monaco-editor/react';
import { MarkdownHooks as Markdown } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { ArrowLeft, Download, Save, Share2, Loader2 } from 'lucide-react';
import { apiFetch, apiDownload, toApiRequestError } from '@/lib/fetcher';
import { emitToast } from '@/components/ui/toast-bus';
import { ConflictWarning } from '@/components/workspace/ConflictWarning';
import { ShareModal } from '@/components/workspace/ShareModal';
import type { FileContentResponse, SaveFileRequest, SaveFileResponse } from '@/types/api';

import 'highlight.js/styles/github.css';

/** 외부 URL인지 판별한다. */
function isExternalUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/** 상대 이미지 경로를 /api/thumbnail URL로 변환한다. */
function resolveImageSrc(src: string, filePath: string): string {
  if (isExternalUrl(src)) return src;
  const cleanSrc = src.startsWith('./') ? src.slice(2) : src;
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  const imagePath = dir ? `${dir}/${cleanSrc}` : cleanSrc;
  return `/api/thumbnail?path=${encodeURIComponent(imagePath)}&w=800`;
}

function EditorPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const path = searchParams.get('path') || '';

  const [content, setContent] = useState('');
  const [baseMtime, setBaseMtime] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);

  // 저장 함수를 안정적으로 참조하기 위한 ref
  const savingRef = useRef(false);
  const contentRef = useRef('');
  const baseMtimeRef = useRef(0);

  // ref 동기화
  useEffect(() => { contentRef.current = content; }, [content]);
  useEffect(() => { baseMtimeRef.current = baseMtime; }, [baseMtime]);
  useEffect(() => { savingRef.current = saving; }, [saving]);

  // 파일 로드
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
          setBaseMtime(data.mtime);
          setIsDirty(false);
          setConflict(false);
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

  // 저장 로직
  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
    setSaving(true);

    try {
      const body: SaveFileRequest = {
        path,
        content: contentRef.current,
        baseMtime: baseMtimeRef.current,
      };

      const data = await apiFetch<SaveFileResponse>('/api/file-content', {
        method: 'PUT',
        body: JSON.stringify(body),
      });

      setBaseMtime(data.mtime);
      setIsDirty(false);
      setConflict(false);
      emitToast({ message: '저장되었습니다.', variant: 'success' });
    } catch (caught) {
      const err = toApiRequestError(caught);
      if (err.code === 409) {
        setConflict(true);
        emitToast({ message: '파일이 외부에서 변경되었습니다.', variant: 'error' });
      } else if (err.code !== 401) {
        emitToast({ message: err.message, variant: 'error' });
      }
    } finally {
      setSaving(false);
    }
  }, [path]);

  // Cmd+S / Ctrl+S 단축키
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // 미저장 이탈 경고
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Monaco 에디터 마운트 시 포커스
  const handleEditorMount: OnMount = (editor) => {
    editor.focus();
  };

  // 뷰어로 이동
  const handleGoToViewer = useCallback(() => {
    if (isDirty) {
      const confirmed = window.confirm('저장하지 않은 변경 사항이 있습니다. 이동하시겠습니까?');
      if (!confirmed) return;
    }
    router.push(`/workspace/view?path=${encodeURIComponent(path)}`);
  }, [isDirty, path, router]);

  // 파일명 추출
  const fileName = path.substring(path.lastIndexOf('/') + 1) || path;

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 dark:bg-black">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        <span className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          파일을 불러오는 중...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 dark:bg-black">
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center dark:border-red-800/40 dark:bg-red-950/20">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => router.push('/workspace')}
            className="mt-4 rounded-lg border border-red-300 px-3.5 py-2 text-sm text-red-700 transition-colors hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/30"
          >
            목록으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-zinc-50 font-sans dark:bg-black">
      {/* 헤더 */}
      <header className="shrink-0 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-black/80">
        <div className="flex items-center justify-between gap-4 px-4 py-2">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={handleGoToViewer}
              className="flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 rounded dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <ArrowLeft className="h-4 w-4" />
              뷰어로
            </button>
            <span className="text-zinc-300 dark:text-zinc-700">|</span>
            <h1 className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {fileName}
            </h1>
            {isDirty && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                수정됨
              </span>
            )}
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
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              title="다운로드"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">다운로드</span>
            </button>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              title="공유하기"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">공유</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="hidden sm:inline">저장 중...</span>
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">저장</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* 409 충돌 경고 */}
      <ConflictWarning
        visible={conflict}
        content={content}
        onDismiss={() => setConflict(false)}
      />

      {/* 공유 모달 */}
      <ShareModal
        filePath={path}
        fileName={fileName}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />

      {/* 분할 뷰: 에디터 + 미리보기 (모바일 세로 적층, md 이상 좌우 분할) */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        {/* 좌측: Monaco 에디터 */}
        <div className="flex-1 min-h-0 min-w-0 border-b border-zinc-200 md:border-b-0 md:border-r dark:border-zinc-800">
          <Editor
            language="markdown"
            value={content}
            theme="vs-dark"
            onChange={(value) => {
              setContent(value ?? '');
              setIsDirty(true);
            }}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              wordWrap: 'on',
              lineNumbers: 'on',
              fontSize: 14,
              scrollBeyondLastLine: false,
              padding: { top: 16 },
            }}
          />
        </div>

        {/* 우측: 실시간 미리보기 */}
        <div className="flex-1 min-h-0 min-w-0 overflow-y-auto bg-white dark:bg-zinc-950">
          <div className="px-6 py-6">
            <div className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
              미리보기
            </div>
            <article className="prose prose-zinc dark:prose-invert max-w-none prose-img:rounded-lg prose-img:shadow-sm">
              <Markdown
                remarkPlugins={[remarkGfm]}
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
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 dark:bg-black">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          <span className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            에디터를 불러오는 중...
          </span>
        </div>
      }
    >
      <EditorPageInner />
    </Suspense>
  );
}
