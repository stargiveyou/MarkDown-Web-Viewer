/**
 * Web Push (PWA 알림) — 구독 저장소 + 발송.
 *
 * iOS 16.4+에서 **홈 화면에 추가한** 웹 앱은 표준 Web Push(VAPID)로 알림을 받는다.
 * 서버는 구독 정보(endpoint + 암호화 키)를 저장해 두었다가, 업로드 완료 같은 이벤트에서
 * `web-push`로 각 endpoint(Apple/Google/Mozilla 푸시 서비스)에 암호화된 페이로드를 보낸다.
 *
 * 보안:
 *   - VAPID 개인키는 env 전용(불변식 6). 응답·로그에 싣지 않는다.
 *   - **endpoint는 클라이언트가 보낸 URL**이고 서버가 그 URL로 POST한다 → SSRF 표면이다.
 *     알려진 푸시 서비스 호스트만 허용한다(`PUSH_SERVICE_HOST_SUFFIXES`).
 *   - endpoint 자체가 "이 기기로 알림을 보낼 수 있는 권한"이므로 로그에는 호스트만 남긴다.
 *   - 발송 실패는 업로드 성공에 영향을 주지 않는다(best-effort, 서버 로깅만 — 불변식 8).
 *
 * 저장 위치: `MARKDOWN_ROOT/.mdws/push.db` — 업로드 이력(`uploads.db`)과 같은 이유로
 * 검색 색인(search.db)과 분리한다. 색인은 rebuild로 지워지지만 구독은 남아야 한다.
 */

import 'server-only';

import { ECDH } from 'node:crypto';
import nodeFs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import webpush, { WebPushError } from 'web-push';

import { isMarkdownName } from './doc-title';
import { getServerEnv } from './env';

import type { PushNotificationPayload, UploadedFileInfo } from '@/types/api';

// ---------------------------------------------------------------------------
// 구독 검증 (순수 함수)
// ---------------------------------------------------------------------------

/**
 * 허용하는 푸시 서비스 호스트(접미사 일치).
 *
 * - `push.apple.com`              — Safari / iOS 홈 화면 앱 (`web.push.apple.com`)
 * - `fcm.googleapis.com`          — Chrome / Android / Edge(일부)
 * - `push.services.mozilla.com`   — Firefox (`updates.push.services.mozilla.com`)
 * - `notify.windows.com`          — Edge (WNS)
 */
export const PUSH_SERVICE_HOST_SUFFIXES = [
  'push.apple.com',
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'notify.windows.com',
] as const;

/** endpoint URL 길이 상한. 실제 값은 200~500자 수준이다. */
const MAX_ENDPOINT_LENGTH = 1024;

/** 저장할 수 있는 구독 수 상한. 개인용 앱이라 기기 수가 많지 않다 — 초과 시 오래된 것부터 지운다. */
export const MAX_SUBSCRIPTIONS = 20;

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

function base64UrlByteLength(value: unknown): number {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return -1;
  return Buffer.from(value.replace(/=+$/, ''), 'base64url').length;
}

/**
 * 65바이트가 실제 P-256 곡선 위의 점인지. 길이만 맞는 쓰레기 값은 저장 단계에서 거른다 —
 * 통과시키면 매 업로드마다 암호화 단계에서 실패 로그만 쌓인다.
 */
function isP256Point(base64Url: string): boolean {
  try {
    const raw = Buffer.from(base64Url.replace(/=+$/, ''), 'base64url');
    ECDH.convertKey(raw, 'prime256v1', undefined, undefined, 'compressed');
    return true;
  } catch {
    return false;
  }
}

/** endpoint가 허용된 푸시 서비스의 https URL인지. */
export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH) return false;

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  // 자격 증명·비표준 포트가 섞인 URL은 정상적인 푸시 서비스 endpoint가 아니다.
  if (url.username !== '' || url.password !== '' || url.port !== '') return false;

  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/**
 * 브라우저 `PushSubscription.toJSON()` 형태를 검증해 저장용 레코드로 바꾼다.
 * 형식이 하나라도 틀리면 `null`.
 *
 * - `keys.p256dh`: 65바이트 비압축 P-256 공개키
 * - `keys.auth`:   16바이트 인증 시크릿
 */
export function parsePushSubscription(input: unknown): PushSubscriptionRecord | null {
  if (!input || typeof input !== 'object') return null;
  const { endpoint, keys } = input as { endpoint?: unknown; keys?: unknown };

  if (!isAllowedPushEndpoint(endpoint)) return null;
  if (!keys || typeof keys !== 'object') return null;

  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  if (base64UrlByteLength(p256dh) !== 65 || !isP256Point(p256dh as string)) return null;
  if (base64UrlByteLength(auth) !== 16) return null;

  return { endpoint, p256dh: p256dh as string, auth: auth as string };
}

// ---------------------------------------------------------------------------
// 업로드 알림 페이로드 (순수 함수)
// ---------------------------------------------------------------------------

/** 잠금 화면에 노출되므로 짧게 자른다. */
const MAX_BODY_LENGTH = 120;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function folderUrl(folderSubpath: string): string {
  return folderSubpath === ''
    ? '/workspace'
    : `/workspace?path=${encodeURIComponent(folderSubpath)}`;
}

/**
 * 업로드 완료 알림 내용을 만든다.
 *
 * 잠금 화면에 보이므로 **파일명·폴더명까지만** 싣고 본문 내용은 넣지 않는다.
 * 클릭 시 열 URL은 항상 앱 내부 상대 경로다(서비스 워커가 같은 origin으로만 연다).
 *
 * @param files 이번 요청에서 저장된 파일 (MARKDOWN_ROOT 기준 subpath)
 * @param folderSubpath 업로드 대상 폴더 (루트면 빈 문자열)
 */
export function buildUploadPushPayload(
  files: readonly UploadedFileInfo[],
  folderSubpath: string,
): PushNotificationPayload | null {
  if (files.length === 0) return null;

  const where = folderSubpath === '' ? '루트 폴더' : folderSubpath;

  if (files.length === 1) {
    const [file] = files;
    return {
      title: '📄 새 문서가 업로드되었습니다',
      body: truncate(`${file.name} · ${where}`, MAX_BODY_LENGTH),
      url: isMarkdownName(file.name)
        ? `/workspace/view?path=${encodeURIComponent(file.subpath)}`
        : folderUrl(folderSubpath),
      tag: `upload:${file.subpath}`,
    };
  }

  return {
    title: `📄 ${files.length}개 파일이 업로드되었습니다`,
    body: truncate(`${files[0].name} 외 ${files.length - 1}개 · ${where}`, MAX_BODY_LENGTH),
    url: folderUrl(folderSubpath),
    tag: `upload:${folderSubpath}`,
  };
}

// ---------------------------------------------------------------------------
// 구독 저장소
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

function pushDbPath(): string {
  const root = path.resolve(getServerEnv().MARKDOWN_ROOT);
  return path.join(root, '.mdws', 'push.db');
}

function ensurePushDb(): Database.Database {
  if (db) return db;

  const file = pushDbPath();
  nodeFs.mkdirSync(path.dirname(file), { recursive: true });

  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      endpoint TEXT PRIMARY KEY,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_success_at INTEGER
    );
  `);
  return db;
}

/** 푸시 기능이 켜져 있는지 (VAPID 3종 설정 여부). */
export function isPushConfigured(): boolean {
  return getServerEnv().VAPID !== undefined;
}

/** 클라이언트 구독에 필요한 공개키. 미설정이면 `null`. */
export function getVapidPublicKey(): string | null {
  return getServerEnv().VAPID?.publicKey ?? null;
}

/** 구독을 저장한다(같은 endpoint면 키만 갱신). 상한을 넘으면 가장 오래된 구독을 지운다. */
export function saveSubscription(record: PushSubscriptionRecord, now = Date.now()): void {
  const database = ensurePushDb();

  const save = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO subscriptions (endpoint, p256dh, auth, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run(record.endpoint, record.p256dh, record.auth, now);

    database
      .prepare(
        `DELETE FROM subscriptions WHERE endpoint IN (
           SELECT endpoint FROM subscriptions ORDER BY created_at DESC LIMIT -1 OFFSET ?
         )`,
      )
      .run(MAX_SUBSCRIPTIONS);
  });
  save();
}

/** 구독을 지운다. 없는 endpoint여도 오류가 아니다(멱등). */
export function removeSubscription(endpoint: string): void {
  ensurePushDb().prepare('DELETE FROM subscriptions WHERE endpoint = ?').run(endpoint);
}

export function hasSubscription(endpoint: string): boolean {
  const row = ensurePushDb()
    .prepare('SELECT 1 FROM subscriptions WHERE endpoint = ?')
    .get(endpoint);
  return row !== undefined;
}

export function countSubscriptions(): number {
  const row = ensurePushDb().prepare('SELECT COUNT(*) AS n FROM subscriptions').get() as {
    n: number;
  };
  return row.n;
}

// ---------------------------------------------------------------------------
// 발송
// ---------------------------------------------------------------------------

export interface PushSendResult {
  sent: number;
  /** 푸시 서비스가 404/410(구독 만료)을 돌려줘 삭제한 수. */
  removed: number;
  failed: number;
}

/** 알림 보존 시간(초). 기기가 꺼져 있다 켜져도 하루 안이면 받는다. */
const PUSH_TTL_SEC = 24 * 60 * 60;

/** 푸시 서비스 응답 대기 상한(ms). */
const PUSH_TIMEOUT_MS = 10_000;

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return '(invalid)';
  }
}

/**
 * 저장된 구독 전체(또는 `onlyEndpoint` 하나)에 알림을 보낸다.
 * VAPID 미설정이면 아무것도 하지 않는다.
 */
export async function sendPush(
  payload: PushNotificationPayload,
  onlyEndpoint?: string,
): Promise<PushSendResult> {
  const result: PushSendResult = { sent: 0, removed: 0, failed: 0 };
  const vapid = getServerEnv().VAPID;
  if (!vapid) return result;

  const database = ensurePushDb();
  const rows = (
    onlyEndpoint === undefined
      ? database.prepare('SELECT endpoint, p256dh, auth FROM subscriptions').all()
      : database
          .prepare('SELECT endpoint, p256dh, auth FROM subscriptions WHERE endpoint = ?')
          .all(onlyEndpoint)
  ) as PushSubscriptionRecord[];

  const body = JSON.stringify(payload);

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          body,
          {
            vapidDetails: {
              subject: vapid.subject,
              publicKey: vapid.publicKey,
              privateKey: vapid.privateKey,
            },
            TTL: PUSH_TTL_SEC,
            urgency: 'normal',
            timeout: PUSH_TIMEOUT_MS,
          },
        );
        database
          .prepare('UPDATE subscriptions SET last_success_at = ? WHERE endpoint = ?')
          .run(Date.now(), row.endpoint);
        result.sent += 1;
      } catch (error) {
        const status = error instanceof WebPushError ? error.statusCode : undefined;
        if (status === 404 || status === 410) {
          // 앱 삭제·권한 해제 등으로 만료된 구독. 다시 보내도 영원히 실패한다.
          removeSubscription(row.endpoint);
          result.removed += 1;
          return;
        }
        result.failed += 1;
        console.error(
          `[push] send failed (host=${endpointHost(row.endpoint)}, status=${status ?? 'n/a'}):`,
          error instanceof Error ? error.message : error,
        );
      }
    }),
  );

  return result;
}

/**
 * 업로드 완료 알림 — **응답을 기다리게 하지 않는다.**
 *
 * 푸시 서비스 왕복(최대 `PUSH_TIMEOUT_MS`)만큼 업로드 응답이 늦어지면 안 되므로
 * 발송을 띄워 두고 바로 돌아온다. `next start` 상주 프로세스라 응답 뒤에도 끝까지 실행된다.
 * VAPID 미설정이면 DB도 열지 않고 즉시 반환한다.
 */
export function notifyUploadPush(
  files: readonly UploadedFileInfo[],
  folderSubpath: string,
): void {
  if (!isPushConfigured()) return;

  const payload = buildUploadPushPayload(files, folderSubpath);
  if (!payload) return;

  void sendPush(payload)
    .then((r) => {
      if (r.failed > 0 || r.removed > 0) {
        console.warn(`[push] upload notify: sent=${r.sent} removed=${r.removed} failed=${r.failed}`);
      }
    })
    .catch((error: unknown) => {
      console.error('[push] upload notify unexpected error:', error);
    });
}

/** 테스트 전용 — DB 핸들을 닫아 임시 MARKDOWN_ROOT를 갈아끼울 수 있게 한다. */
export function closePushDbForTest(): void {
  db?.close();
  db = null;
}
