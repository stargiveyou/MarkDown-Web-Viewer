/**
 * 삭제 Lock 저장소 — 실수로 지우면 안 되는 파일/폴더를 잠근다.
 *
 * `reads.db`와 같은 이유로 별도 DB(`locks.db`)를 쓴다.
 * 검색 색인(search.db)은 rebuild-index로 지워질 수 있지만 잠금은 유지돼야 한다.
 *
 * 잠금 규칙(서버가 단독으로 판정한다 — UI 비활성화는 편의일 뿐이다):
 *   - 잠긴 항목 자신은 삭제할 수 없다.
 *   - 폴더 삭제는 하위에 잠긴 항목이 하나라도 있으면 거부한다
 *     (폴더 삭제는 재귀 삭제이므로, 잠긴 파일이 조용히 사라지는 길을 막는다).
 *   - 잠긴 폴더 안의 개별 파일 삭제는 막지 않는다 — 잠금은 "그 항목"에만 걸린다.
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

function locksDbPath(): string {
  const root = path.resolve(getServerEnv().MARKDOWN_ROOT);
  return path.join(root, '.mdws', 'locks.db');
}

function ensureLocksDb(): Database.Database {
  if (db) return db;

  const dir = path.dirname(locksDbPath());
  nodeFs.mkdirSync(dir, { recursive: true });

  db = new Database(locksDbPath());
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS delete_locks (
      subpath TEXT PRIMARY KEY,
      locked_at INTEGER NOT NULL
    );
  `);

  return db;
}

/**
 * 하위 경로 조회용 접두사.
 *
 * `LIKE`를 쓰지 않는 이유는 와일드카드다 — 파일명에 `%`나 `_`가 들어가면
 * 엉뚱한 경로가 걸린다. `substr()` 비교는 이스케이프가 필요 없다.
 */
function childPrefix(subpath: string): string {
  return `${subpath}/`;
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/** 삭제 Lock을 걸거나 해제한다. */
export function setDeleteLock(subpath: string, locked: boolean): void {
  const d = ensureLocksDb();
  if (locked) {
    d.prepare(
      'INSERT OR REPLACE INTO delete_locks (subpath, locked_at) VALUES (?, ?)',
    ).run(subpath, Date.now());
  } else {
    d.prepare('DELETE FROM delete_locks WHERE subpath = ?').run(subpath);
  }
}

/** 해당 경로 자신이 잠겨 있는지. */
export function isDeleteLocked(subpath: string): boolean {
  const d = ensureLocksDb();
  const row = d
    .prepare('SELECT 1 AS hit FROM delete_locks WHERE subpath = ?')
    .get(subpath) as { hit: number } | undefined;
  return row !== undefined;
}

/** 여러 경로의 잠금 여부를 한 번에 조회한다 (목록 응답용). */
export function getLockedSubpaths(subpaths: string[]): Set<string> {
  if (subpaths.length === 0) return new Set();

  const d = ensureLocksDb();
  const stmt = d.prepare('SELECT 1 AS hit FROM delete_locks WHERE subpath = ?');

  const locked = new Set<string>();
  for (const subpath of subpaths) {
    if (stmt.get(subpath) !== undefined) locked.add(subpath);
  }
  return locked;
}

/**
 * 폴더 하위에서 잠긴 항목 하나를 찾는다. 없으면 `null`.
 * 폴더 삭제 거부 메시지에 어떤 항목이 막고 있는지 싣기 위해 경로를 돌려준다.
 */
export function findLockedDescendant(subpath: string): string | null {
  const d = ensureLocksDb();
  const prefix = childPrefix(subpath);
  const row = d
    .prepare(
      'SELECT subpath FROM delete_locks WHERE substr(subpath, 1, ?) = ? ORDER BY subpath LIMIT 1',
    )
    .get(prefix.length, prefix) as { subpath: string } | undefined;
  return row?.subpath ?? null;
}

/**
 * 삭제된 항목(과 폴더라면 그 하위)의 잠금 기록을 정리한다.
 * 삭제는 잠금 검사를 통과한 뒤에만 수행되므로, 여기서는 뒤처리만 한다.
 */
export function removeDeleteLocks(subpath: string, isDirectory: boolean): void {
  const d = ensureLocksDb();
  d.prepare('DELETE FROM delete_locks WHERE subpath = ?').run(subpath);
  if (isDirectory) {
    const prefix = childPrefix(subpath);
    d.prepare('DELETE FROM delete_locks WHERE substr(subpath, 1, ?) = ?').run(
      prefix.length,
      prefix,
    );
  }
}

/**
 * 이동·이름 변경에 맞춰 잠금을 따라가게 한다.
 *
 * 경로를 키로 쓰기 때문에, 이동 후 잠금을 옮기지 않으면 잠금이 조용히 풀린다
 * (이동 → 삭제로 잠금을 우회할 수 있다).
 */
export function moveDeleteLocks(
  oldSubpath: string,
  newSubpath: string,
  isDirectory: boolean,
): void {
  const d = ensureLocksDb();

  const relocate = d.transaction(() => {
    const self = d
      .prepare('SELECT locked_at FROM delete_locks WHERE subpath = ?')
      .get(oldSubpath) as { locked_at: number } | undefined;

    if (self) {
      d.prepare('DELETE FROM delete_locks WHERE subpath = ?').run(oldSubpath);
      d.prepare(
        'INSERT OR REPLACE INTO delete_locks (subpath, locked_at) VALUES (?, ?)',
      ).run(newSubpath, self.locked_at);
    }

    if (!isDirectory) return;

    const oldPrefix = childPrefix(oldSubpath);
    const children = d
      .prepare(
        'SELECT subpath, locked_at FROM delete_locks WHERE substr(subpath, 1, ?) = ?',
      )
      .all(oldPrefix.length, oldPrefix) as Array<{
      subpath: string;
      locked_at: number;
    }>;

    for (const child of children) {
      const tail = child.subpath.slice(oldPrefix.length);
      d.prepare('DELETE FROM delete_locks WHERE subpath = ?').run(child.subpath);
      d.prepare(
        'INSERT OR REPLACE INTO delete_locks (subpath, locked_at) VALUES (?, ?)',
      ).run(`${childPrefix(newSubpath)}${tail}`, child.locked_at);
    }
  });

  relocate();
}

// ---------------------------------------------------------------------------
// 테스트 전용
// ---------------------------------------------------------------------------

export function closeLocksDbForTest(): void {
  if (db) {
    db.close();
    db = null;
  }
}
