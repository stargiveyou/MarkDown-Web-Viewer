'use client';

/**
 * Bento Grid — Split-Sidebar 대시보드의 메인 카드 레이아웃.
 *
 * 첫 번째 폴더(가장 최근 수정)를 lg:col-span-2 강조 카드로,
 * 나머지를 1칸 일반 카드로 렌더한다.
 * 마크다운/이미지/기타 파일은 일반 카드 형태로 표시한다.
 */

import { Folder, FileText, File, ChevronRight } from 'lucide-react';
import type { FileEntry } from '@/types/api';

export interface BentoGridProps {
  entries: FileEntry[];
  onFolderClick: (subpath: string) => void;
  onFileClick: (entry: FileEntry) => void;
}

/** 수정일을 상대 시간으로 표시 */
function formatRelativeTime(mtime: number): string {
  const diff = Date.now() - mtime;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  const months = Math.floor(days / 30);
  return `${months}개월 전`;
}

/** 파일 크기 포맷 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function BentoGrid({ entries, onFolderClick, onFileClick }: BentoGridProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-700 px-6 py-16 text-center">
        <Folder className="mx-auto h-10 w-10 text-slate-600" />
        <p className="mt-3 text-sm text-slate-500">
          이 폴더는 비어 있습니다.
        </p>
      </div>
    );
  }

  // 폴더와 파일 분리
  const folders = entries.filter((e) => e.type === 'folder');
  const files = entries.filter((e) => e.type !== 'folder');

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {folders.map((entry, index) =>
        index === 0 ? (
          <FeaturedFolderCard key={entry.subpath} entry={entry} onClick={onFolderClick} />
        ) : (
          <FolderCard key={entry.subpath} entry={entry} onClick={onFolderClick} />
        ),
      )}
      {files.map((entry) => (
        <FileCard key={entry.subpath} entry={entry} onClick={onFileClick} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 강조 폴더 카드 (첫 번째 폴더, col-span-2)
// ---------------------------------------------------------------------------

function FeaturedFolderCard({
  entry,
  onClick,
}: {
  entry: FileEntry;
  onClick: (subpath: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(entry.subpath)}
      className="group lg:col-span-2 flex flex-col rounded-3xl bg-slate-800 border border-amber-500/30 shadow-lg p-6 text-left transition-all hover:border-amber-500/60 hover:shadow-amber-500/5"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-amber-500/20 flex items-center justify-center">
            <Folder className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100 group-hover:text-amber-400 transition-colors">
              {entry.name}
            </h3>
            <p className="text-xs text-slate-500">
              {entry.fileCount !== undefined ? `${entry.fileCount}개 항목` : ''} · {formatRelativeTime(entry.mtime)}
            </p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-slate-600 group-hover:text-amber-400 transition-colors" />
      </div>

      {/* 미리보기 박스 — 최근 파일 요약 */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-700/50 p-4 space-y-2.5">
        <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-2">
          {entry.name}
        </p>
        {entry.recentFiles && entry.recentFiles.length > 0 ? (
          entry.recentFiles.map((file, i) => (
            <div key={i} className="flex items-start gap-3">
              <FileText className="h-3.5 w-3.5 text-slate-600 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-300 font-medium truncate">
                  {file.name}
                </p>
                {file.snippet && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                    {file.snippet}
                  </p>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-slate-500">
            최근 수정된 문서를 확인하려면 클릭하세요
          </p>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 일반 폴더 카드 (col-span-1)
// ---------------------------------------------------------------------------

function FolderCard({
  entry,
  onClick,
}: {
  entry: FileEntry;
  onClick: (subpath: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(entry.subpath)}
      className="group col-span-1 flex flex-col rounded-3xl bg-slate-800 border border-slate-700/80 p-5 text-left transition-all hover:border-slate-600 hover:shadow-md"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="h-9 w-9 rounded-xl bg-slate-700/50 flex items-center justify-center">
          <Folder className="h-4.5 w-4.5 text-amber-400" />
        </div>
        <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
      </div>

      <h3 className="text-sm font-semibold text-slate-100 group-hover:text-amber-400 transition-colors truncate">
        {entry.name}
      </h3>
      <div className="flex items-center gap-2 mt-1.5">
        {entry.fileCount !== undefined && (
          <span className="text-xs text-slate-500">{entry.fileCount}개 항목</span>
        )}
        <span className="text-xs text-slate-600">·</span>
        <span className="text-xs text-slate-500">{formatRelativeTime(entry.mtime)}</span>
      </div>

      {/* 최근 파일 요약 */}
      {entry.recentFiles && entry.recentFiles.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1.5">
          <p className="text-[10px] font-medium text-slate-600 uppercase tracking-wider">
            {entry.name}
          </p>
          {entry.recentFiles.slice(0, 2).map((file, i) => (
            <div key={i} className="flex items-center gap-2">
              <FileText className="h-3 w-3 text-slate-600 shrink-0" />
              <span className="text-[11px] text-slate-400 truncate">{file.name}</span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 파일 카드 (마크다운 / 이미지 / 기타)
// ---------------------------------------------------------------------------

function FileCard({
  entry,
  onClick,
}: {
  entry: FileEntry;
  onClick: (entry: FileEntry) => void;
}) {
  const isMarkdown = entry.type === 'markdown';
  const isImage = entry.type === 'image';

  return (
    <button
      type="button"
      onClick={() => onClick(entry)}
      className="group col-span-1 flex flex-col overflow-hidden rounded-3xl bg-slate-800 border border-slate-700/80 text-left transition-all hover:border-slate-600 hover:shadow-md"
    >
      {/* 썸네일 영역 */}
      {entry.coverThumbUrl ? (
        <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={entry.coverThumbUrl}
            alt={entry.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        </div>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-slate-900/50">
          {isMarkdown ? (
            <FileText className="h-10 w-10 text-slate-700" />
          ) : (
            <File className="h-10 w-10 text-slate-700" />
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <span className="truncate text-sm font-medium text-slate-100 group-hover:text-amber-400 transition-colors">
          {isMarkdown ? (entry.title || entry.name) : entry.name}
        </span>
        {isMarkdown && entry.snippet && (
          <p className="line-clamp-2 text-xs text-slate-500 leading-relaxed">
            {entry.snippet}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          {!isImage && entry.size > 0 && (
            <span className="text-[11px] text-slate-600">{formatSize(entry.size)}</span>
          )}
          {isImage && (
            <span className="text-[11px] text-slate-600">{formatSize(entry.size)}</span>
          )}
          <span className="text-[11px] text-slate-600">{formatRelativeTime(entry.mtime)}</span>
        </div>
        {entry.tags && entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {entry.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex rounded-full bg-slate-700/50 px-2 py-0.5 text-[11px] text-slate-400"
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
