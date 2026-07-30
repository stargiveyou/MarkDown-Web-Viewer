/**
 * FTS5 검색 색인 관리 -- ADR-007.
 *
 * SQLite FTS5 + trigram 토크나이저로 한국어 부분일치 검색을 지원한다.
 * DB 위치: `MARKDOWN_ROOT/.mdws/search.db`
 *
 * 공개 API:
 *   - `initIndex()`     서버 기동 시 1회 호출. 증분 빌드를 백그라운드로 수행한다.
 *   - `isIndexing()`    색인 구축 완료 여부.
 *   - `indexFile(sub)`  파일 1건 upsert. upload/file-content PUT 에서 호출.
 *   - `search(q, lim)`  FTS5 MATCH 검색. `SearchResult[]` 반환.
 *   - `getAllTags()`     frontmatter 태그 집계. `TagCount[]` 반환.
 *
 * 보안:
 *   - 모든 경로는 `resolveUnderRoot` + `assertRealPathUnderRoot` 검증(불변식 2).
 *   - DB에 절대 경로를 저장하지 않는다. `toSubpath()` 형태의 상대 경로만 보관한다.
 *
 * 담당: backend-dev / Stage 3
 */

import 'server-only';

import nodeFs from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';
import matter from 'gray-matter';

import { getServerEnv } from './env';
import {
  assertRealPathUnderRoot,
  resolveUnderRoot,
  toSubpath,
} from './path-safety';
import type { SearchResult, TagCount } from '@/types/api';
import { SNIPPET_MARK } from '@/types/api';

// ---------------------------------------------------------------------------
// 모듈 상태
// ---------------------------------------------------------------------------

/** 싱글턴 DB 인스턴스. `ensureDb()`로 lazy-init 한다. */
let db: Database.Database | null = null;

/** 증분 빌드 진행 상태. */
let indexingInProgress = false;

/** 증분 빌드 Promise. 동시 호출 방지 + 완료 대기에 사용한다. */
let buildPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// DB 초기화
// ---------------------------------------------------------------------------

/** DB 파일이 위치할 디렉터리 경로. */
function dbDir(): string {
  return path.join(path.resolve(getServerEnv().MARKDOWN_ROOT), '.mdws');
}

/** DB 파일 경로. */
function dbPath(): string {
  return path.join(dbDir(), 'search.db');
}

/**
 * DB 싱글턴을 반환한다. 없으면 생성한다.
 * better-sqlite3는 동기 API이므로 디렉터리 생성만 동기로 처리한다.
 */
function ensureDb(): Database.Database {
  if (db) return db;

  const dir = dbDir();
  // 동기적 mkdir -- better-sqlite3가 동기이므로 일관성 유지
  nodeFs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath());

  // WAL 모드 활성화 -- 읽기/쓰기 동시성 향상
  db.pragma('journal_mode = WAL');

  // 테이블 생성
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
      subpath,
      title,
      body,
      tags,
      tokenize='trigram'
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS docs_meta (
      subpath TEXT PRIMARY KEY,
      mtime   INTEGER NOT NULL
    );
  `);

  // 첫 DB 연결 시 증분 빌드를 백그라운드로 시작한다.
  initIndex();

  return db;
}

// ---------------------------------------------------------------------------
// 디스크 스캔 유틸
// ---------------------------------------------------------------------------

interface DiskEntry {
  subpath: string;
  mtimeMs: number;
}

/** MARKDOWN_ROOT 하위의 모든 .md 파일을 재귀 스캔한다. */
async function scanMarkdownFiles(rootDir: string): Promise<DiskEntry[]> {
  const entries: DiskEntry[] = [];

  async function walk(dir: string): Promise<void> {
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of dirents) {
      // 숨김 디렉터리/파일 건너뛰기 (.mdws, .thumbcache, .DS_Store 등)
      if (dirent.name.startsWith('.')) continue;

      const fullPath = path.join(dir, dirent.name);

      if (dirent.isDirectory()) {
        await walk(fullPath);
      } else if (
        dirent.isFile() &&
        (dirent.name.endsWith('.md') || dirent.name.endsWith('.markdown'))
      ) {
        try {
          const stat = await fs.stat(fullPath);
          const sub = toSubpath(fullPath);
          entries.push({ subpath: sub, mtimeMs: Math.round(stat.mtimeMs) });
        } catch {
          // stat 실패 시 건너뛴다 (깨진 심볼릭 링크 등)
        }
      }
    }
  }

  await walk(rootDir);
  return entries;
}

// ---------------------------------------------------------------------------
// 색인 파일 1건 (upsert)
// ---------------------------------------------------------------------------

/**
 * 파일 1건을 색인에 upsert한다.
 *
 * @param subpath MARKDOWN_ROOT 기준 상대 경로 (POSIX)
 */
export async function indexFile(subpath: string): Promise<void> {
  const absolutePath = resolveUnderRoot(subpath);
  await assertRealPathUnderRoot(absolutePath);

  const raw = await fs.readFile(absolutePath, 'utf8');
  const parsed = matter(raw);

  const title =
    (typeof parsed.data.title === 'string' && parsed.data.title.trim()) ||
    path.basename(subpath, path.extname(subpath));

  const body = parsed.content;

  const tags = Array.isArray(parsed.data.tags)
    ? parsed.data.tags
        .filter((t: unknown): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter(Boolean)
        .join(' ')
    : '';

  const stat = await fs.stat(absolutePath);
  const mtime = Math.round(stat.mtimeMs);

  const d = ensureDb();

  // 트랜잭션으로 원자성 보장
  d.transaction(() => {
    // FTS5는 UPDATE가 없으므로 DELETE + INSERT
    d.prepare('DELETE FROM docs_fts WHERE subpath = ?').run(subpath);
    d.prepare(
      'INSERT INTO docs_fts (subpath, title, body, tags) VALUES (?, ?, ?, ?)',
    ).run(subpath, title, body, tags);
    d.prepare(
      'INSERT OR REPLACE INTO docs_meta (subpath, mtime) VALUES (?, ?)',
    ).run(subpath, mtime);
  })();
}

// ---------------------------------------------------------------------------
// 색인에서 파일 제거
// ---------------------------------------------------------------------------

export function removeFromIndex(subpath: string): void {
  const d = ensureDb();
  d.transaction(() => {
    d.prepare('DELETE FROM docs_fts WHERE subpath = ?').run(subpath);
    d.prepare('DELETE FROM docs_meta WHERE subpath = ?').run(subpath);
  })();
}

/**
 * 주어진 디렉터리 접두사 하위의 모든 색인 항목을 일괄 제거한다.
 * 디렉터리 삭제 시 호출된다.
 */
export function removeDirectoryFromIndex(dirSubpath: string): void {
  const d = ensureDb();
  d.transaction(() => {
    const rows = d
      .prepare('SELECT subpath FROM docs_meta WHERE subpath LIKE ?')
      .all(`${dirSubpath}/%`) as Array<{ subpath: string }>;
    for (const row of rows) {
      d.prepare('DELETE FROM docs_fts WHERE subpath = ?').run(row.subpath);
      d.prepare('DELETE FROM docs_meta WHERE subpath = ?').run(row.subpath);
    }
    // 디렉터리 자체도 제거
    d.prepare('DELETE FROM docs_fts WHERE subpath = ?').run(dirSubpath);
    d.prepare('DELETE FROM docs_meta WHERE subpath = ?').run(dirSubpath);
  })();
}

// ---------------------------------------------------------------------------
// 검색
// ---------------------------------------------------------------------------

interface FtsRow {
  subpath: string;
  title: string;
  snippet: string;
  score: number;
  tags: string;
}

interface MetaRow {
  mtime: number;
}

/**
 * FTS5 MATCH 검색.
 *
 * @param query 사용자 입력 검색어 (2자 이상)
 * @param limit 최대 결과 수 (기본값 50)
 * @returns SearchResult[] (BM25 관련도 순)
 */
export function search(query: string, limit = 50): SearchResult[] {
  const d = ensureDb();

  // FTS5 특수문자 이스케이프: 쌍따옴표로 감싸서 리터럴 검색
  const escaped = `"${query.replace(/"/g, '""')}"`;

  const stmt = d.prepare(`
    SELECT
      subpath,
      title,
      snippet(docs_fts, 2, '${SNIPPET_MARK.open}', '${SNIPPET_MARK.close}', '...', 40) AS snippet,
      rank AS score,
      tags
    FROM docs_fts
    WHERE docs_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);

  const rows = stmt.all(escaped, limit) as FtsRow[];

  const metaStmt = d.prepare('SELECT mtime FROM docs_meta WHERE subpath = ?');

  return rows.map((row) => {
    const meta = metaStmt.get(row.subpath) as MetaRow | undefined;
    return {
      subpath: row.subpath,
      title: row.title,
      snippet: row.snippet,
      score: row.score,
      mtime: meta?.mtime ?? 0,
      tags: row.tags ? row.tags.split(' ').filter(Boolean) : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// 태그 집계
// ---------------------------------------------------------------------------

interface TagRow {
  tags: string;
}

/**
 * 전체 태그 집계. count 내림차순 정렬.
 */
export function getAllTags(): TagCount[] {
  const d = ensureDb();

  const rows = d
    .prepare('SELECT tags FROM docs_fts WHERE tags != \'\'')
    .all() as TagRow[];

  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.tags.split(' ').filter(Boolean)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// 증분 빌드
// ---------------------------------------------------------------------------

/**
 * 색인 초기화. 서버 기동 시 1회 호출.
 * 비동기 백그라운드에서 증분 빌드를 수행한다.
 */
export function initIndex(): void {
  if (buildPromise) return; // 이미 진행 중

  indexingInProgress = true;

  buildPromise = incrementalBuild()
    .catch((error) => {
      console.error('[search-index] incremental build failed:', error);
    })
    .finally(() => {
      indexingInProgress = false;
      buildPromise = null;
    });
}

/** 색인 구축 완료 여부. */
export function isIndexing(): boolean {
  return indexingInProgress;
}

async function incrementalBuild(): Promise<void> {
  const root = path.resolve(getServerEnv().MARKDOWN_ROOT);
  const d = ensureDb();

  // 1. 디스크의 모든 .md 파일 수집
  const diskFiles = await scanMarkdownFiles(root);
  const diskMap = new Map<string, number>();
  for (const entry of diskFiles) {
    diskMap.set(entry.subpath, entry.mtimeMs);
  }

  // 2. DB에 있는 모든 항목 수집
  const dbEntries = d
    .prepare('SELECT subpath, mtime FROM docs_meta')
    .all() as Array<{ subpath: string; mtime: number }>;
  const dbMap = new Map<string, number>();
  for (const entry of dbEntries) {
    dbMap.set(entry.subpath, entry.mtime);
  }

  // 3. 삭제 감지: DB에 있지만 디스크에 없는 파일
  for (const [subpath] of dbMap) {
    if (!diskMap.has(subpath)) {
      removeFromIndex(subpath);
    }
  }

  // 4. 신규/변경 감지: 디스크에 있고 DB에 없거나 mtime이 다른 파일
  for (const [subpath, mtime] of diskMap) {
    const dbMtime = dbMap.get(subpath);
    if (dbMtime === undefined || dbMtime !== mtime) {
      try {
        await indexFile(subpath);
      } catch (error) {
        console.error(`[search-index] failed to index ${subpath}:`, error);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 이동 후 색인 갱신
// ---------------------------------------------------------------------------

/**
 * 파일/디렉터리 이동 후 검색 색인을 갱신한다.
 * best-effort: 실패해도 이동 자체에 영향을 주지 않는다.
 *
 * @param oldSubpath 이동 전 MARKDOWN_ROOT 기준 상대 경로
 * @param newSubpath 이동 후 MARKDOWN_ROOT 기준 상대 경로
 * @param isDirectory 디렉터리 이동 여부
 */
export async function reindexAfterMove(
  oldSubpath: string,
  newSubpath: string,
  isDirectory: boolean,
): Promise<void> {
  if (isDirectory) {
    // 이전 접두사로 시작하는 모든 항목 제거
    const d = ensureDb();
    const rows = d
      .prepare('SELECT subpath FROM docs_meta WHERE subpath LIKE ?')
      .all(`${oldSubpath}/%`) as Array<{ subpath: string }>;

    for (const row of rows) {
      removeFromIndex(row.subpath);
    }

    // 새 위치의 모든 .md 파일 재색인
    const root = path.resolve(getServerEnv().MARKDOWN_ROOT);
    const newAbsPath = path.join(root, ...newSubpath.split('/'));
    const files = await scanMarkdownFiles(newAbsPath);
    for (const file of files) {
      try {
        await indexFile(file.subpath);
      } catch (err) {
        console.error(`[search-index] reindex after move failed for ${file.subpath}:`, err);
      }
    }
  } else {
    // 단일 파일 이동
    removeFromIndex(oldSubpath);
    if (newSubpath.endsWith('.md') || newSubpath.endsWith('.markdown')) {
      await indexFile(newSubpath);
    }
  }
}

// ---------------------------------------------------------------------------
// 테스트 전용
// ---------------------------------------------------------------------------

/**
 * DB를 닫고 상태를 초기화한다. **유닛 테스트 전용**.
 */
export function closeDbForTest(): void {
  if (db) {
    db.close();
    db = null;
  }
  indexingInProgress = false;
  buildPromise = null;
}

/**
 * 증분 빌드 완료를 대기한다. **유닛 테스트 전용**.
 */
export async function waitForBuildForTest(): Promise<void> {
  if (buildPromise) {
    await buildPromise;
  }
}
