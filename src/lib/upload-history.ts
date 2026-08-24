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
import type { UploadHistoryEntry, UploadedFileInfo } from '@/types/api';

// ---------------------------------------------------------------------------
// 모듈 상태
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

/** 보관 상한(건). 초과분은 오래된 것부터 지운다. 날짜별 조회를 위해 넉넉히 둔다. */
const MAX_ROWS = 5000;

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

function toEntry(row: UploadRow): UploadHistoryEntry {
  return {
    id: String(row.id),
    name: row.name,
    subpath: row.subpath,
    size: row.size,
    at: row.uploaded_at,
    source: row.source === 'web' ? 'web' : 'api',
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
  source: 'web' | 'api',
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

// ---------------------------------------------------------------------------
// 테스트 전용
// ---------------------------------------------------------------------------

export function closeUploadsDbForTest(): void {
  if (db) {
    db.close();
    db = null;
  }
}
