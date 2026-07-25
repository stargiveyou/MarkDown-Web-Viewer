'use client';

/**
 * GridView -- 폴더/파일 카드 그리드.
 *
 * EntryType별 카드 렌더링:
 * - folder: Folder 아이콘 + 이름 + fileCount
 * - markdown: coverThumbUrl(있으면 img) 또는 FileText 아이콘 + title/name + snippet + tags
 * - image: 썸네일 img + 파일명
 * - other: File 아이콘 + 파일명 + 크기
 *
 * 모든 이미지는 <img> 태그만 사용한다 (D2-1: SVG XSS 방어).
 * 썸네일 URL은 서버가 coverThumbUrl에 이미 /api/thumbnail?... 형태로 제공한다.
 */

import { Folder, FileText, File, Download } from 'lucide-react';
import { apiDownload, toApiRequestError } from '@/lib/fetcher';
import { emitToast } from '@/components/ui/toast-bus';
import type { FileEntry } from '@/types/api';

export interface GridViewProps {
  entries: FileEntry[];
  onFolderClick: (subpath: string) => void;
  onFileClick: (entry: FileEntry) => void;
}

/** 다운로드 클릭 핸들러. 이벤트 전파를 막아 카드 클릭과 겹치지 않게 한다. */
function handleDownload(e: React.MouseEvent, subpath: string, name: string) {
  e.stopPropagation();
  e.preventDefault();
  const url = `/api/download?path=${encodeURIComponent(subpath)}`;
  apiDownload(url, name).catch((err) => {
    const apiErr = toApiRequestError(err);
    if (apiErr.code !== 401) {
      emitToast({ message: apiErr.message, variant: 'error' });
    }
  });
}

/** 다운로드 아이콘 버튼. 카드 우하단에 배치한다. */
function DownloadButton({ subpath, name, label }: { subpath: string; name: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => handleDownload(e, subpath, label ?? name)}
      className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
      title="다운로드"
    >
      <Download className="h-3.5 w-3.5" />
    </button>
  );
}

/** 파일 크기를 사람이 읽기 좋은 형태로 포맷한다. */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function GridView({ entries, onFolderClick, onFileClick }: GridViewProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
        <Folder className="mx-auto h-10 w-10 text-zinc-400 dark:text-zinc-600" />
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          이 폴더는 비어 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {entries.map((entry) => (
        <CardItem
          key={entry.subpath}
          entry={entry}
          onFolderClick={onFolderClick}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
}

interface CardItemProps {
  entry: FileEntry;
  onFolderClick: (subpath: string) => void;
  onFileClick: (entry: FileEntry) => void;
}

function CardItem({ entry, onFolderClick, onFileClick }: CardItemProps) {
  switch (entry.type) {
    case 'folder':
      return <FolderCard entry={entry} onClick={onFolderClick} />;
    case 'markdown':
      return <MarkdownCard entry={entry} onClick={onFileClick} />;
    case 'image':
      return <ImageCard entry={entry} onClick={onFileClick} />;
    case 'other':
      return <OtherCard entry={entry} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 폴더 카드
// ---------------------------------------------------------------------------

function FolderCard({ entry, onClick }: { entry: FileEntry; onClick: (subpath: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(entry.subpath)}
      className="group relative flex flex-col items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-left transition-colors hover:border-amber-300 hover:bg-amber-100/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 dark:border-amber-800/40 dark:bg-amber-950/20 dark:hover:border-amber-700/50 dark:hover:bg-amber-950/30"
    >
      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
        <DownloadButton subpath={entry.subpath} name={entry.name} label={`${entry.name}.zip`} />
      </div>
      <Folder className="h-10 w-10 text-amber-600 dark:text-amber-400" />
      <span className="w-full truncate text-center text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {entry.name}
      </span>
      {entry.fileCount !== undefined && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {entry.fileCount}개 항목
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 마크다운 카드
// ---------------------------------------------------------------------------

function MarkdownCard({ entry, onClick }: { entry: FileEntry; onClick: (entry: FileEntry) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(entry)}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-left transition-colors hover:border-zinc-300 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
    >
      {/* 커버 썸네일 또는 아이콘 */}
      {entry.coverThumbUrl ? (
        <div className="relative aspect-video w-full overflow-hidden bg-zinc-100 dark:bg-zinc-900">
          {/* eslint-disable-next-line @next/next/no-img-element -- D2-1: SVG XSS 방어를 위해 <img>만 사용 */}
          <img
            src={entry.coverThumbUrl}
            alt={entry.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-zinc-100 dark:bg-zinc-900">
          <FileText className="h-10 w-10 text-zinc-400 dark:text-zinc-600" />
        </div>
      )}

      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
        <DownloadButton subpath={entry.subpath} name={entry.name} />
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {entry.title || entry.name}
        </span>
        {entry.snippet && (
          <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            {entry.snippet}
          </p>
        )}
        {entry.tags && entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {entry.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 이미지 카드
// ---------------------------------------------------------------------------

function ImageCard({ entry, onClick }: { entry: FileEntry; onClick: (entry: FileEntry) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(entry)}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-left transition-colors hover:border-zinc-300 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
    >
      <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
        <DownloadButton subpath={entry.subpath} name={entry.name} />
      </div>
      <div className="relative aspect-video w-full overflow-hidden bg-zinc-100 dark:bg-zinc-900">
        {entry.coverThumbUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- D2-1: SVG XSS 방어를 위해 <img>만 사용 */
          <img
            src={entry.coverThumbUrl}
            alt={entry.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <File className="h-10 w-10 text-zinc-400 dark:text-zinc-600" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 p-3">
        <span className="truncate text-sm text-zinc-900 dark:text-zinc-100">
          {entry.name}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {formatSize(entry.size)}
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 기타 파일 카드
// ---------------------------------------------------------------------------

function OtherCard({ entry }: { entry: FileEntry }) {
  return (
    <div className="group relative flex flex-col items-center gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
        <DownloadButton subpath={entry.subpath} name={entry.name} />
      </div>
      <File className="h-10 w-10 text-zinc-400 dark:text-zinc-600" />
      <span className="w-full truncate text-center text-sm text-zinc-900 dark:text-zinc-100">
        {entry.name}
      </span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        {formatSize(entry.size)}
      </span>
    </div>
  );
}
