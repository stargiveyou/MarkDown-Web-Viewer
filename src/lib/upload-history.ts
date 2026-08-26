/**
 * 업로드 이력 저장소 (서버) — 어떤 경로로 올라왔든 한 곳에 기록한다.
 *
 * 예전에는 브라우저 localStorage에만 쌓아서, curl 같은 API 직접 호출로 올린 파일이
 * Upload Log에 전혀 나타나지 않았다. 기록 주체를 서버(`/api/upload`)로 옮겨
 * 업로드 경로와 무관하게 같은 목록을 보게 한다.
 *
 * 읽음 추적(`reads.db`)과 같은 이유로 검색 색인(search.db)과 분리한다 —
 * 색인은 rebuild로 지워지지만 이력은 남아야 한다.
 */

import 'server-only';

import nodeFs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { getServerEnv } from './env';
import { isVersionBackup } from './file-utils';

import type { UploadHistoryEntry, UploadSource, UploadedFileInfo } from '@/types/api';

// ---------------------------------------------------------------------------
// 모듈 상태
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

/**
 * 보관 상한(건). 초과분은 오래된 것부터 지운다.
 *
 * 캘린더가 과거 달까지 거슬러 보는 화면이라 넉넉히 둔다 — 행 하나가 100바이트 남짓이므로
 * 5만 건이라도 수 MB 수준이고, 조회는 `uploaded_at` 인덱스를 탄다.
 */
const MAX_ROWS = 50_000;

function uploadsDbPath(): string {
  const root = path.resolve(getServerEnv().MARKDOWN_ROOT);
  return path.join(root, '.mdws', 'uploads.db');
}

function ensureUploadsDb(): Database.Database {
  if (db) return db;

  const dir = path.dirname(uploadsDbPath());
  nodeFs.mkdirSync(dir, { recursive: true });

  db = new Database(uploadsDbPath());
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subpath TEXT NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      uploaded_at INTEGER NOT NULL,
      source TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_uploads_at ON uploads (uploaded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_uploads_subpath ON uploads (subpath);

    -- 백필 완료 표시 등 1회성 상태. 매 요청마다 디스크를 훑지 않기 위해 필요하다.
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return db;
}

/** DB row → API 엔트리. `id`는 문자열로 노출한다(클라이언트 key 용도). */
interface UploadRow {
  id: number;
  subpath: string;
  name: string;
  size: number;
  uploaded_at: number;
  source: string;
}

function toSource(raw: string): UploadSource {
  return raw === 'web' || raw === 'scan' ? raw : 'api';
}

function toEntry(row: UploadRow): UploadHistoryEntry {
  return {
    id: String(row.id),
    name: row.name,
    subpath: row.subpath,
    size: row.size,
    at: row.uploaded_at,
    source: toSource(row.source),
  };
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 업로드 성공분을 이력에 기록한다.
 *
 * 실패해도 업로드 자체는 성공이므로 호출부에서 삼킨다(이력은 부가 기능).
 *
 * @param files  저장된 파일 정보
 * @param at     업로드 시각(epoch ms, 서버 시계)
 * @param source 업로드 경로 — 웹 UI인지 API 직접 호출인지
 */
export function recordUploadHistory(
  files: UploadedFileInfo[],
  at: number,
  source: UploadSource,
): void {
  if (files.length === 0) return;

  const d = ensureUploadsDb();
  const insert = d.prepare(
    'INSERT INTO uploads (subpath, name, size, uploaded_at, source) VALUES (?, ?, ?, ?, ?)',
  );

  const insertAll = d.transaction((rows: UploadedFileInfo[]) => {
    for (const file of rows) {
      insert.run(file.subpath, file.name, file.size, at, source);
    }
    // 상한 초과분 정리 — 오래된 것부터 버린다.
    d.prepare(
      `DELETE FROM uploads WHERE id NOT IN (
         SELECT id FROM uploads ORDER BY uploaded_at DESC, id DESC LIMIT ?
       )`,
    ).run(MAX_ROWS);
  });

  insertAll(files);
}

/** 이어 읽기 커서 — 같은 시각에 올라온 배치를 건너뛰지 않도록 id까지 함께 본다. */
export interface UploadCursor {
  at: number;
  id: string;
}

/**
 * 업로드 이력을 최신순으로 돌려준다.
 *
 * @param limit  최대 건수
 * @param before 이 항목보다 오래된 것만 (없으면 처음부터)
 */
export function listUploads(limit: number, before?: UploadCursor): UploadHistoryEntry[] {
  const d = ensureUploadsDb();

  // 정렬이 (uploaded_at DESC, id DESC)이므로 커서 비교도 같은 순서를 따라야
  // 한 번에 기록된 배치(같은 uploaded_at)가 페이지 경계에서 사라지지 않는다.
  const rows = before
    ? (d
        .prepare(
          'SELECT id, subpath, name, size, uploaded_at, source FROM uploads' +
            ' WHERE uploaded_at < ? OR (uploaded_at = ? AND id < ?)' +
            ' ORDER BY uploaded_at DESC, id DESC LIMIT ?',
        )
        .all(before.at, before.at, Number(before.id), limit) as UploadRow[])
    : (d
        .prepare(
          'SELECT id, subpath, name, size, uploaded_at, source FROM uploads ORDER BY uploaded_at DESC, id DESC LIMIT ?',
        )
        .all(limit) as UploadRow[]);

  return rows.map(toEntry);
}

/**
 * 기간 안의 업로드를 최신순으로 돌려준다 (캘린더의 한 달 조회).
 *
 * @param from 시작 시각(포함, epoch ms)
 * @param to   끝 시각(제외, epoch ms)
 */
export function listUploadsInRange(from: number, to: number): UploadHistoryEntry[] {
  const d = ensureUploadsDb();
  const rows = d
    .prepare(
      'SELECT id, subpath, name, size, uploaded_at, source FROM uploads' +
        ' WHERE uploaded_at >= ? AND uploaded_at < ?' +
        ' ORDER BY uploaded_at DESC, id DESC',
    )
    .all(from, to) as UploadRow[];

  return rows.map(toEntry);
}

// ---------------------------------------------------------------------------
// 과거분 백필 — 이력 기록 이전에 올라간 파일도 캘린더에 보이게 한다.
// ---------------------------------------------------------------------------

/** 백필 완료 표시 키. 스캔 규칙이 바뀌면 뒤의 번호를 올려 한 번 더 돌린다. */
const BACKFILL_KEY = 'backfill_v1';

/** 프로세스 안 캐시 — 완료 후에는 DB 조회조차 하지 않는다. */
let backfillDone = false;

/** 스캔에서 제외할 디렉터리 — 앱 내부 저장소와 캐시. */
const SKIP_DIRS = new Set(['.mdws', '.thumbcache']);

/**
 * 파일이 저장소에 놓인 시각. 백필된 항목의 날짜를 정하는 규칙이라 테스트로 고정한다.
 *
 * 생성 시각(birthtime)과 수정 시각(mtime) 중 **이른 쪽**을 쓴다.
 * - 앱으로 올린 파일은 birthtime이 업로드 시점(임시 파일 → rename)이고 편집하면
 *   mtime만 밀리므로 birthtime이 이긴다 — 편집했다고 날짜가 옮겨 다니지 않는다.
 * - 폴더째 복사·복원한 파일은 birthtime이 복사 시각이라 전부 같은 날에 몰린다.
 *   이때는 보존된 mtime이 더 문서다운 날짜라 그쪽이 이긴다.
 *
 * 지원하지 않는 파일시스템(0)이나 시계 이상(미래) 값은 후보에서 뺀다.
 */
export function landedAt(stat: Pick<nodeFs.Stats, 'birthtimeMs' | 'mtimeMs'>, now: number): number {
  const modified = Math.round(stat.mtimeMs);
  const candidates = [Math.round(stat.birthtimeMs), modified].filter(
    (time) => Number.isFinite(time) && time > 0 && time <= now,
  );

  // 둘 다 못 믿을 값이면 mtime을 그대로 쓴다(적어도 파일이 주장하는 시각이다).
  return candidates.length === 0 ? modified : Math.min(...candidates);
}

/** `MARKDOWN_ROOT` 아래 실제 파일을 모두 훑는다. 심볼릭 링크는 따라가지 않는다. */
function scanFiles(root: string): Array<{ subpath: string; stat: nodeFs.Stats }> {
  const found: Array<{ subpath: string; stat: nodeFs.Stats }> = [];
  const queue: string[] = [''];

  while (queue.length > 0) {
    const relative = queue.pop() as string;
    const absolute = relative === '' ? root : path.join(root, relative);

    let entries: nodeFs.Dirent[];
    try {
      entries = nodeFs.readdirSync(absolute, { withFileTypes: true });
    } catch {
      continue; // 권한 없음·경합으로 사라진 폴더는 건너뛴다.
    }

    for (const entry of entries) {
      // 숨김 파일·내부 디렉터리는 사용자 문서가 아니다.
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;

      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;

      if (entry.isDirectory()) {
        queue.push(childRelative);
        continue;
      }
      // 심볼릭 링크는 루트 밖을 가리킬 수 있으므로 아예 다루지 않는다(보안 불변식 2).
      if (!entry.isFile()) continue;
      // 덮어쓰기로 생긴 버전 백업본은 목록에서 숨기는 파일이라 이력에도 넣지 않는다.
      if (isVersionBackup(entry.name)) continue;

      try {
        found.push({ subpath: childRelative, stat: nodeFs.statSync(path.join(root, childRelative)) });
      } catch {
        // 스캔 도중 지워진 파일 — 무시한다.
      }
    }
  }

  return found;
}

/**
 * 이력에 없는 기존 파일을 파일시스템 시각으로 한 번 채워 넣는다.
 *
 * 서버가 업로드를 기록하기 시작한 것은 최근이라, 그전에 올라간 문서는 이력이 없어
 * 캘린더가 비어 보인다. 첫 조회 때 한 번만 훑어 `source: 'scan'`으로 채운다.
 * 완료 표시가 DB에 남으므로 이후 요청은 디스크를 건드리지 않는다.
 *
 * @returns 새로 채운 건수 (이미 완료됐으면 0)
 */
export function ensureUploadHistoryBackfilled(): number {
  if (backfillDone) return 0;

  const d = ensureUploadsDb();
  const flag = d.prepare('SELECT value FROM meta WHERE key = ?').get(BACKFILL_KEY);
  if (flag) {
    backfillDone = true;
    return 0;
  }

  const root = path.resolve(getServerEnv().MARKDOWN_ROOT);
  const now = Date.now();

  // 이미 기록된 파일은 실제 업로드 시각이 정확하므로 건드리지 않는다.
  const known = new Set(
    (d.prepare('SELECT DISTINCT subpath FROM uploads').all() as { subpath: string }[]).map(
      (row) => row.subpath,
    ),
  );

  const missing = scanFiles(root).filter((file) => !known.has(file.subpath));

  const insert = d.prepare(
    'INSERT INTO uploads (subpath, name, size, uploaded_at, source) VALUES (?, ?, ?, ?, ?)',
  );
  const markDone = d.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');

  const run = d.transaction(() => {
    for (const file of missing) {
      insert.run(
        file.subpath,
        path.basename(file.subpath),
        file.stat.size,
        landedAt(file.stat, now),
        'scan',
      );
    }
    d.prepare(
      `DELETE FROM uploads WHERE id NOT IN (
         SELECT id FROM uploads ORDER BY uploaded_at DESC, id DESC LIMIT ?
       )`,
    ).run(MAX_ROWS);
    markDone.run(BACKFILL_KEY, String(now));
  });

  run();
  backfillDone = true;

  return missing.length;
}

// ---------------------------------------------------------------------------
// 테스트 전용
// ---------------------------------------------------------------------------

export function closeUploadsDbForTest(): void {
  backfillDone = false;
  if (db) {
    db.close();
    db = null;
  }
}
