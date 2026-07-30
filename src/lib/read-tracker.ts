/**
 * 파일 읽음 상태 추적 — 새 파일/업데이트 파일에 "!" 배지를 표시한다.
 *
 * 검색 색인 DB(search.db)와 별도의 `reads.db`를 사용한다.
 * search.db는 rebuild-index 시 삭제되지만, reads.db는 유지된다.
 *
 * 판정 기준:
 *   - 읽음 기록 없음 → unread (새 파일)
 *   - 파일 mtime > read_at → unread (업데이트된 파일)
 *   - 파일 mtime <= read_at → read
 */

import 'server-only';

import nodeFs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { getServerEnv } from './env';

// ---------------------------------------------------------------------------
// 모듈 상태
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

// ---------------------------------------------------------------------------
// DB 초기화
// ---------------------------------------------------------------------------

function readsDbPath(): string {
  const root = path.resolve(getServerEnv().MARKDOWN_ROOT);
  return path.join(root, '.mdws', 'reads.db');
}

function ensureReadsDb(): Database.Database {
  if (db) return db;

  const dir = path.dirname(readsDbPath());
  nodeFs.mkdirSync(dir, { recursive: true });

  db = new Database(readsDbPath());
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS file_reads (
      subpath TEXT PRIMARY KEY,
      read_at INTEGER NOT NULL
    );
  `);

  return db;
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 파일을 "읽음"으로 표시한다.
 *
 * @param subpath MARKDOWN_ROOT 기준 상대 경로
 * @param mtime 파일의 현재 mtime (epoch ms). 이 값으로 read_at을 설정한다.
 */
export function markAsRead(subpath: string, mtime: number): void {
  const d = ensureReadsDb();
  d.prepare(
    'INSERT OR REPLACE INTO file_reads (subpath, read_at) VALUES (?, ?)',
  ).run(subpath, mtime);
}

/**
 * 여러 파일의 unread 여부를 일괄 판정한다.
 *
 * @param entries 각 파일의 subpath + mtime 배열
 * @returns unread인 subpath의 Set
 */
export function getUnreadSubpaths(
  entries: Array<{ subpath: string; mtime: number }>,
): Set<string> {
  if (entries.length === 0) return new Set();

  const d = ensureReadsDb();
  const stmt = d.prepare('SELECT read_at FROM file_reads WHERE subpath = ?');

  const unread = new Set<string>();
  for (const entry of entries) {
    const row = stmt.get(entry.subpath) as { read_at: number } | undefined;
    if (!row || entry.mtime > row.read_at) {
      unread.add(entry.subpath);
    }
  }

  return unread;
}

// ---------------------------------------------------------------------------
// 테스트 전용
// ---------------------------------------------------------------------------

export function closeReadsDbForTest(): void {
  if (db) {
    db.close();
    db = null;
  }
}
