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
 *   - `getLinkSnapshot()` 문서·링크 전체 스냅숏 (그래프·백링크 계산용, `link-graph.ts`가 쓴다).
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

import { firstHeading } from './doc-title';
import { extractLinks, type LinkKind } from './wikilinks';
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

/**
 * 색인 변경 카운터. 문서·링크가 바뀔 때마다 1씩 오른다.
 * 그래프 계산 결과를 캐시하는 쪽(`link-graph.ts`)이 무효화 판단에 쓴다.
 */
let indexVersion = 0;

/**
 * 링크 테이블 스키마 버전. 올리면 기존 색인을 한 번 전부 다시 읽어 링크를 채운다.
 * (링크 테이블은 나중에 추가됐다 — mtime이 그대로인 문서는 증분 빌드가 건너뛰므로 강제 재색인이 필요하다.)
 */
const LINKS_SCHEMA_VERSION = '1';

/** 이번 기동에서 링크 전체 재색인이 필요한지. 증분 빌드가 끝나면 버전을 기록한다. */
let linksBackfillPending = false;

/** 문서·링크가 바뀌었음을 알린다. */
function bumpIndexVersion(): void {
  indexVersion += 1;
}

/** 현재 색인 버전. 캐시 키로 쓴다. */
export function getIndexVersion(): number {
  return indexVersion;
}

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
  // 새로 연 DB는 이전 캐시와 다른 상태일 수 있다(테스트의 루트 교체, 재기동).
  bumpIndexVersion();

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

  // 문서 간 링크 (위키링크·상대 .md 링크). 대상은 **해석 전** 값으로 저장한다 —
  // 대상 문서가 나중에 올라와도 다시 색인하지 않고 조회 시점에 연결되게 하기 위해서다.
  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_links (
      source  TEXT NOT NULL,
      kind    TEXT NOT NULL,
      target  TEXT NOT NULL,
      context TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_doc_links_source ON doc_links (source);
    CREATE TABLE IF NOT EXISTS index_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // 링크 테이블 도입 전 색인이면 mtime 기록을 비워 증분 빌드가 전부 다시 읽게 한다.
  // 버전은 증분 빌드가 **끝난 뒤** 기록한다 — 도중에 죽으면 다음 기동에서 다시 시도한다.
  const linksVersion = db
    .prepare("SELECT value FROM index_meta WHERE key = 'links_version'")
    .get() as { value: string } | undefined;
  if (linksVersion?.value !== LINKS_SCHEMA_VERSION) {
    db.prepare('DELETE FROM docs_meta').run();
    linksBackfillPending = true;
  }

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

  // 제목 규칙은 뷰어·캘린더와 공유한다(`doc-title`) — 화면마다 다른 제목이 보이면 안 된다.
  const title =
    (typeof parsed.data.title === 'string' && parsed.data.title.trim()) ||
    firstHeading(parsed.content) ||
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

  // frontmatter를 뺀 본문에서 링크를 뽑는다(frontmatter 안의 `[[…]]`는 링크가 아니다).
  const links = extractLinks(parsed.content, subpath);

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

    d.prepare('DELETE FROM doc_links WHERE source = ?').run(subpath);
    const insertLink = d.prepare(
      'INSERT INTO doc_links (source, kind, target, context) VALUES (?, ?, ?, ?)',
    );
    for (const link of links) {
      insertLink.run(subpath, link.kind, link.target, link.context);
    }
  })();
  bumpIndexVersion();
}

// ---------------------------------------------------------------------------
// 색인에서 파일 제거
// ---------------------------------------------------------------------------

export function removeFromIndex(subpath: string): void {
  const d = ensureDb();
  d.transaction(() => {
    d.prepare('DELETE FROM docs_fts WHERE subpath = ?').run(subpath);
    d.prepare('DELETE FROM docs_meta WHERE subpath = ?').run(subpath);
    d.prepare('DELETE FROM doc_links WHERE source = ?').run(subpath);
  })();
  bumpIndexVersion();
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
      d.prepare('DELETE FROM doc_links WHERE source = ?').run(row.subpath);
    }
    // 디렉터리 자체도 제거
    d.prepare('DELETE FROM docs_fts WHERE subpath = ?').run(dirSubpath);
    d.prepare('DELETE FROM docs_meta WHERE subpath = ?').run(dirSubpath);
  })();
  bumpIndexVersion();
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
// 제목 조회
// ---------------------------------------------------------------------------

/**
 * 여러 문서의 제목을 한 번에 읽는다 — 캘린더 목록이 파일명 대신 제목을 보여줄 때 쓴다.
 *
 * 색인에 없는 경로(이미지 등 비마크다운, 아직 색인 전)는 결과에 담기지 않으므로
 * 호출부가 파일명으로 대체한다. 제목이 파일명과 같으면(=문서에 제목이 없음)
 * 굳이 돌려주지 않아 응답이 불필요하게 커지지 않게 한다.
 *
 * @param subpaths MARKDOWN_ROOT 기준 상대 경로들
 */
export function getTitles(subpaths: string[]): Map<string, string> {
  const titles = new Map<string, string>();
  if (subpaths.length === 0) return titles;

  const d = ensureDb();
  const unique = [...new Set(subpaths)];

  // SQLite 변수 상한(기본 999)에 걸리지 않도록 나눠 조회한다.
  const CHUNK = 500;
  for (let start = 0; start < unique.length; start += CHUNK) {
    const chunk = unique.slice(start, start + CHUNK);
    const rows = d
      .prepare(
        `SELECT subpath, title FROM docs_fts WHERE subpath IN (${chunk.map(() => '?').join(',')})`,
      )
      .all(...chunk) as Array<{ subpath: string; title: string }>;

    for (const row of rows) {
      const fallback = path.basename(row.subpath, path.extname(row.subpath));
      if (row.title && row.title !== fallback) titles.set(row.subpath, row.title);
    }
  }

  return titles;
}

// ---------------------------------------------------------------------------
// 링크 스냅숏 (그래프·백링크)
// ---------------------------------------------------------------------------

export interface IndexedDoc {
  subpath: string;
  title: string;
  tags: string[];
}

export interface IndexedLink {
  source: string;
  kind: LinkKind;
  target: string;
  context: string;
}

export interface LinkSnapshot {
  /** 스냅숏을 뜬 시점의 색인 버전 */
  version: number;
  docs: IndexedDoc[];
  links: IndexedLink[];
}

/**
 * 색인된 문서 전체와 링크 전체를 한 번에 읽는다. 해석(어느 문서를 가리키는지)은 하지 않는다.
 * 파일 시스템을 훑지 않고 색인만 읽는다(ADR-007).
 */
export function getLinkSnapshot(): LinkSnapshot {
  const d = ensureDb();
  const version = indexVersion;

  const docs = (
    d.prepare('SELECT subpath, title, tags FROM docs_fts').all() as Array<{
      subpath: string;
      title: string;
      tags: string;
    }>
  ).map((row) => ({
    subpath: row.subpath,
    title: row.title,
    tags: row.tags ? row.tags.split(' ').filter(Boolean) : [],
  }));

  const links = d
    .prepare('SELECT source, kind, target, context FROM doc_links')
    .all() as IndexedLink[];

  return { version, docs, links };
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
  // 5. 링크 재색인이 필요했던 기동이면 끝났음을 기록한다.
  if (linksBackfillPending) {
    d.prepare(
      "INSERT OR REPLACE INTO index_meta (key, value) VALUES ('links_version', ?)",
    ).run(LINKS_SCHEMA_VERSION);
    linksBackfillPending = false;
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
