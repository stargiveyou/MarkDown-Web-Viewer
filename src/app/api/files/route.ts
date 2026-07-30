/**
 * `GET /api/files` -- 디렉터리 내 폴더/파일 목록을 반환한다.
 *
 * 쿼리:
 *   - `path` (선택, 기본값 "")  : MARKDOWN_ROOT 기준 상대 경로
 *   - `sort` (선택, 기본값 "mtime") : `mtime` | `name` | `size` | `ctime`
 *   - `tag`  (선택)             : frontmatter 태그 필터
 *
 * 보안 불변식 2, 8이 적용된다.
 *
 * 담당: backend-dev / Stage 2
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import matter from 'gray-matter';
import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import {
  buildThumbnailUrl,
  classifyEntry,
  extractSnippet,
  isThumbnailable,
  isVersionBackup,
} from '@/lib/file-utils';
import {
  PathSafetyError,
  assertRealPathUnderRoot,
  resolveUnderRoot,
  toSubpath,
} from '@/lib/path-safety';
import { getUnreadSubpaths } from '@/lib/read-tracker';
import { removeDirectoryFromIndex, removeFromIndex } from '@/lib/search-index';
import type { DeleteResponse, FileEntry, FilesResponse, SortKey } from '@/types/api';

export const runtime = 'nodejs';

/** 마크다운 본문에서 첫 이미지 참조를 찾는 정규식. */
const MD_IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/;

/** 유효한 sort 키 집합. */
const VALID_SORT_KEYS = new Set<SortKey>(['mtime', 'name', 'size', 'ctime']);

/**
 * 마크다운 본문에서 첫 번째 이미지 참조 경로를 추출한다.
 * 상대 경로는 마크다운 파일의 디렉터리 기준으로 해석한다.
 */
function findFirstImagePath(markdownContent: string, mdDirSubpath: string): string | null {
  const match = MD_IMAGE_RE.exec(markdownContent);
  if (!match) return null;

  let imgRef = match[1];
  // URL(http/https)이면 무시한다 -- 외부 이미지는 썸네일 대상이 아니다.
  if (imgRef.startsWith('http://') || imgRef.startsWith('https://')) return null;

  // 상대 경로를 마크다운 파일이 있는 디렉터리 기준으로 해석한다.
  if (!imgRef.startsWith('/')) {
    imgRef = mdDirSubpath ? `${mdDirSubpath}/${imgRef}` : imgRef;
  }

  // path.posix.normalize로 `./` 및 `../` 를 정리한다.
  imgRef = path.posix.normalize(imgRef);

  return imgRef;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const userPath = searchParams.get('path') ?? '';
  const sortKey = (searchParams.get('sort') ?? 'mtime') as SortKey;
  const tagFilter = searchParams.get('tag') ?? undefined;

  // sort 값 검증
  if (!VALID_SORT_KEYS.has(sortKey)) {
    return apiError(400, 'Invalid sort value.');
  }

  try {
    // --- 경로 검증 (보안 불변식 2) ---
    const absoluteDir = resolveUnderRoot(userPath);
    await assertRealPathUnderRoot(absoluteDir);

    // 디렉터리인지 확인
    let dirStat;
    try {
      dirStat = await fs.stat(absoluteDir);
    } catch {
      return apiError(400, 'Path not found.');
    }
    if (!dirStat.isDirectory()) {
      return apiError(400, 'Not a directory.');
    }

    // --- 디렉터리 읽기 ---
    const dirents = await fs.readdir(absoluteDir, { withFileTypes: true });

    // 숨김 파일 + 버전 백업 파일 제외 (.thumbcache, .DS_Store, *_YYYYMMDD-HHmmss.* 등)
    const visibleDirents = dirents.filter(
      (d) => !d.name.startsWith('.') && !isVersionBackup(d.name),
    );

    // --- 각 엔트리 구성 ---
    const entries: FileEntry[] = [];
    // ctime 정렬용: subpath -> birthtimeMs. FileEntry에 ctime 필드는 포함하지 않는다(계약).
    const ctimeMap = new Map<string, number>();

    for (const dirent of visibleDirents) {
      const entryPath = path.join(absoluteDir, dirent.name);

      let stat;
      try {
        stat = await fs.stat(entryPath);
      } catch {
        // stat 실패한 엔트리는 건너뛴다 (깨진 심볼릭 링크 등)
        continue;
      }

      const isDir = stat.isDirectory();
      const type = classifyEntry(dirent.name, isDir);
      const subpath = toSubpath(entryPath);

      const entry: FileEntry = {
        name: dirent.name,
        type,
        size: isDir ? 0 : stat.size,
        mtime: Math.round(stat.mtimeMs),
        subpath,
      };

      // ctime 정렬용 보관. macOS에서 birthtimeMs는 실제 생성일.
      ctimeMap.set(subpath, Math.round(stat.birthtimeMs));

      if (isDir) {
        // 폴더: 숨김 파일을 제외한 직접 하위 항목 수 + 최근 마크다운 요약
        try {
          const children = await fs.readdir(entryPath);
          const visibleChildren = children.filter((c) => !c.startsWith('.'));
          entry.fileCount = visibleChildren.length;

          // 최근 수정된 마크다운 파일 최대 3개의 이름+요약 수집
          const mdChildren = visibleChildren.filter(
            (c) => c.endsWith('.md') || c.endsWith('.markdown'),
          );
          if (mdChildren.length > 0) {
            // stat으로 mtime 기준 정렬 후 상위 3개
            const mdStats = await Promise.all(
              mdChildren.map(async (c) => {
                try {
                  const s = await fs.stat(path.join(entryPath, c));
                  return { name: c, mtimeMs: s.mtimeMs };
                } catch {
                  return null;
                }
              }),
            );
            const sorted = mdStats
              .filter((s): s is NonNullable<typeof s> => s !== null)
              .sort((a, b) => b.mtimeMs - a.mtimeMs)
              .slice(0, 3);

            const recentFiles: { name: string; snippet?: string }[] = [];
            for (const { name: mdName } of sorted) {
              try {
                const raw = await fs.readFile(path.join(entryPath, mdName), 'utf8');
                const parsed = matter(raw);
                const title =
                  typeof parsed.data.title === 'string' && parsed.data.title.trim() !== ''
                    ? parsed.data.title.trim()
                    : mdName.replace(/\.(md|markdown)$/, '');
                const snippet = extractSnippet(parsed.content, 80);
                recentFiles.push({ name: title, snippet: snippet || undefined });
              } catch {
                recentFiles.push({ name: mdName.replace(/\.(md|markdown)$/, '') });
              }
            }
            if (recentFiles.length > 0) {
              entry.recentFiles = recentFiles;
            }
          }
        } catch {
          entry.fileCount = 0;
        }
      } else if (type === 'markdown') {
        // 마크다운: frontmatter 파싱
        try {
          const raw = await fs.readFile(entryPath, 'utf8');
          const parsed = matter(raw);

          if (typeof parsed.data.title === 'string' && parsed.data.title.trim() !== '') {
            entry.title = parsed.data.title.trim();
          }

          if (Array.isArray(parsed.data.tags)) {
            entry.tags = parsed.data.tags
              .filter((t: unknown): t is string => typeof t === 'string')
              .map((t) => t.trim())
              .filter((t) => t.length > 0);
          }

          entry.snippet = extractSnippet(parsed.content);

          // 마크다운 본문에서 첫 이미지를 찾아 coverThumbUrl 생성
          const dirSubpath = toSubpath(absoluteDir);
          const firstImage = findFirstImagePath(parsed.content, dirSubpath);
          if (firstImage && isThumbnailable(firstImage)) {
            entry.coverThumbUrl = buildThumbnailUrl(firstImage, 400);
          }

          // frontmatter의 cover 필드가 있으면 우선 사용
          if (typeof parsed.data.cover === 'string' && parsed.data.cover.trim() !== '') {
            let coverPath = parsed.data.cover.trim();
            if (!coverPath.startsWith('/') && !coverPath.startsWith('http')) {
              const mdDirSubpath = toSubpath(absoluteDir);
              coverPath = mdDirSubpath ? `${mdDirSubpath}/${coverPath}` : coverPath;
              coverPath = path.posix.normalize(coverPath);
            }
            if (isThumbnailable(coverPath)) {
              entry.coverThumbUrl = buildThumbnailUrl(coverPath, 400);
            }
          }
        } catch {
          // frontmatter 파싱 실패 시 snippet/title/tags 없이 진행
        }
      } else if (type === 'image' && isThumbnailable(dirent.name)) {
        // 이미지: 썸네일 URL 생성
        entry.coverThumbUrl = buildThumbnailUrl(subpath, 400);
      }

      entries.push(entry);
    }

    // --- 태그 필터 ---
    let filteredEntries = entries;
    if (tagFilter) {
      filteredEntries = entries.filter(
        (e) => e.type !== 'folder' && e.tags?.includes(tagFilter),
      );
    }

    // --- 정렬: 폴더 먼저, 그 다음 sort 키 기준 ---
    filteredEntries.sort((a, b) => {
      // 폴더를 맨 위로
      const aIsFolder = a.type === 'folder' ? 0 : 1;
      const bIsFolder = b.type === 'folder' ? 0 : 1;
      if (aIsFolder !== bIsFolder) return aIsFolder - bIsFolder;

      // sort 키별 정렬
      switch (sortKey) {
        case 'mtime':
          return b.mtime - a.mtime; // 내림차순 (최신 우선)
        case 'name':
          return a.name.localeCompare(b.name, 'ko'); // 오름차순
        case 'size':
          return b.size - a.size; // 내림차순 (큰 파일 우선)
        case 'ctime': {
          // birthtimeMs를 사용 (macOS는 실제 생성일, Linux는 메타데이터 변경일)
          const aCtime = ctimeMap.get(a.subpath) ?? a.mtime;
          const bCtime = ctimeMap.get(b.subpath) ?? b.mtime;
          return bCtime - aCtime; // 내림차순 (최신 생성 우선)
        }
        default:
          return 0;
      }
    });

    // --- unread 판정 (파일만, 폴더 제외) ---
    const fileEntries = filteredEntries
      .filter((e) => e.type !== 'folder')
      .map((e) => ({ subpath: e.subpath, mtime: e.mtime }));
    const unreadSet = getUnreadSubpaths(fileEntries);
    for (const entry of filteredEntries) {
      if (entry.type !== 'folder' && unreadSet.has(entry.subpath)) {
        entry.unread = true;
      }
    }

    // --- breadcrumb 생성 ---
    const breadcrumb =
      userPath === '' || userPath === '.' || userPath === './'
        ? []
        : userPath.split('/').filter((seg) => seg.length > 0);

    const response: FilesResponse = { breadcrumb, entries: filteredEntries };
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof PathSafetyError) {
      console.error('[files] path rejected:', error.message);
      return apiError(400, 'Invalid path.');
    }
    return internalError('files', error);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/files?path= — 파일 또는 폴더를 디스크에서 삭제한다.
// ---------------------------------------------------------------------------

export async function DELETE(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const userPath = searchParams.get('path') ?? '';

  if (!userPath || userPath.trim() === '') {
    return apiError(400, 'path is required.');
  }

  try {
    // --- 경로 검증 (보안 불변식 2) ---
    const absolutePath = resolveUnderRoot(userPath);
    await assertRealPathUnderRoot(absolutePath);

    // 존재 확인
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      return apiError(400, 'Path not found.');
    }

    const isDirectory = stat.isDirectory();
    const name = path.basename(absolutePath);
    const subpath = toSubpath(absolutePath);

    // --- 삭제 수행 ---
    if (isDirectory) {
      await fs.rm(absolutePath, { recursive: true, force: true });

      // 검색 색인에서 해당 디렉터리 하위 모든 항목 일괄 제거 (best-effort)
      try {
        removeDirectoryFromIndex(subpath);
      } catch (indexError) {
        console.error('[files:delete] index cleanup failed:', indexError);
      }
    } else {
      await fs.rm(absolutePath);

      // 검색 색인에서 제거 (best-effort)
      try {
        removeFromIndex(subpath);
      } catch (indexError) {
        console.error('[files:delete] index cleanup failed:', indexError);
      }
    }

    const response: DeleteResponse = { ok: true, subpath, name };
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof PathSafetyError) {
      console.error('[files:delete] path rejected:', error.message);
      return apiError(400, 'Invalid path.');
    }
    return internalError('files:delete', error);
  }
}
