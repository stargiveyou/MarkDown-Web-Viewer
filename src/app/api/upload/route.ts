/**
 * `POST /api/upload` — multipart 업로드를 `MARKDOWN_ROOT` 하위에 저장한다.
 *
 * 보안 불변식 2·3·4·7·8이 한 라우트에 모두 걸리는 지점이다.
 *
 * 흐름
 * ----
 *   1. rate limit (세션 키 우선) ................................ 초과 시 429 + `Retry-After`
 *   2. 요청 크기 선검사 (formData()는 바디를 통째로 메모리에 올린다) ... 초과 시 413
 *   3. multipart 파싱 — 파일은 `getAll`로 받는다(배치 호환)
 *   4. 대상 폴더 경로 안전 검증 — `resolveUnderRoot` → `assertRealPathUnderRoot`
 *   5. **모든** 파일 선검증 (크기 413 / 확장자 415 / 파일명 새니타이즈)
 *   6. mkdir(recursive) → 파일별 **atomic write** (임시 파일 → fsync → rename)
 *   7. `UploadResponse` 반환. 경로는 반드시 `toSubpath()`로 상대화한다
 *
 * 5번을 6번보다 먼저 전부 끝내는 이유: 배치 전송에서 3번째 파일이 415라고
 * 앞의 2개만 저장된 어중간한 상태를 남기지 않기 위해서다(전부 저장하거나 전부 거부).
 *
 * 프론트 계약: 요청 1건당 파일 1개를 순차 전송하고, `targetPath`는 루트일 때 아예 보내지 않는다
 * (docs/agent-work/frontend-stage-1-client-contract.md §1). 서버는 미존재를 루트로 해석한다.
 *
 * 담당: backend-dev / Stage 1 Wave 2
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { apiError, internalError } from '@/lib/api-response';
import { getServerEnv } from '@/lib/env';
import {
  PathSafetyError,
  assertRealPathUnderRoot,
  resolveUnderRoot,
  sanitizeFilename,
  sanitizeFolderPath,
  toSubpath,
} from '@/lib/path-safety';
import { checkRateLimit, rateLimitKeyFor } from '@/lib/rate-limit';
import { indexFile } from '@/lib/search-index';
import { sendWebhook, type WebhookPayload } from '@/lib/webhook';
import {
  UPLOAD_FIELD,
  type UploadResponse,
  type UploadedFileInfo,
} from '@/types/api';
import type { ShareTarget } from '@/types/api';

export const runtime = 'nodejs';

/**
 * 멀티파트 경계·헤더·부가 필드에 허용하는 여유(바이트).
 *
 * 요청 총량 상한 = `UPLOAD_MAX_BYTES` + 이 값이다.
 *
 * 왜 총량 상한이 따로 필요한가: `request.formData()`는 스트리밍이 아니라 바디 전체를
 * 메모리에 올린다. 파일 단위 상한(413)만으로는 "20MB짜리 100개를 한 요청에" 같은
 * 입력을 파싱 **전에** 끊을 수 없어 프로세스를 OOM 시킬 수 있다(인터넷에 노출되는 앱이다).
 *
 * 프론트는 파일 1개당 1요청으로 보내므로 이 상한이 정상 사용을 막지 않는다.
 * 배치 전송을 쓰더라도 **요청 총량**이 파일 1개 상한을 넘지 않아야 한다.
 *
 * ⚠️ `next.config.ts`의 `experimental.proxyClientMaxBodySize`와 짝이다.
 *    그 값이 여기보다 작으면 Next가 바디를 잘라 버려 415/413 대신 "Invalid form data"가 된다.
 */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/** 파일명 충돌 시 `name-1.ext`, `name-2.ext` … 로 몇 번까지 시도할지. */
const MAX_NAME_COLLISION_ATTEMPTS = 100;

/** 업로드 파일 권한. 개인 저장소이므로 소유자 전용으로 만든다. */
const UPLOADED_FILE_MODE = 0o600;

/**
 * `x-forwarded-proto` 헤더를 안전한 값으로 제한한다 (backlog P1-20).
 * 'http' 또는 'https'만 허용하며, 그 외(`javascript:` 등)는 'https'로 대체한다.
 */
function sanitizeProto(raw: string | null): string {
  const lower = (raw ?? '').toLowerCase().trim();
  if (lower === 'http' || lower === 'https') return lower;
  return 'https';
}

/** 검증을 통과한 업로드 후보. */
interface PreparedUpload {
  file: File;
  /** `sanitizeFilename`을 거친 안전한 파일명. */
  safeName: string;
}

/**
 * 목적지 파일명을 **원자적으로 선점**한다.
 *
 * `open(..., 'wx')`는 파일이 이미 있으면 EEXIST로 실패하는 원자 연산이라,
 * "존재 확인 후 쓰기"의 TOCTOU 없이 이름을 예약할 수 있다.
 * 같은 이름이 이미 있으면 덮어쓰지 않고 `name-1.ext`로 비켜 간다 —
 * 업로드가 기존 파일을 조용히 파괴하지 않게 하기 위함이다(보안 불변식 5의 취지).
 *
 * @returns 선점에 성공한 절대 경로 (0바이트 자리표시 파일이 생성된 상태)
 */
async function reserveDestination(directory: string, safeName: string): Promise<string> {
  const ext = path.extname(safeName);
  const base = safeName.slice(0, safeName.length - ext.length);

  for (let attempt = 0; attempt <= MAX_NAME_COLLISION_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 0 ? safeName : `${base}-${attempt}${ext}`;
    const target = path.join(directory, candidate);

    try {
      const handle = await fs.open(target, 'wx', UPLOADED_FILE_MODE);
      await handle.close();
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  // 100번을 다 쓴 경우의 마지막 수단. 랜덤 접미사는 사실상 충돌하지 않는다.
  const fallback = path.join(directory, `${base}-${randomBytes(4).toString('hex')}${ext}`);
  const handle = await fs.open(fallback, 'wx', UPLOADED_FILE_MODE);
  await handle.close();
  return fallback;
}

/**
 * Atomic write — 보안 불변식 4.
 *
 * 같은 디렉터리의 임시 파일에 전부 쓰고 `fsync`로 디스크에 확정한 뒤 `rename`한다.
 * 같은 파일시스템 안의 `rename`은 원자적이므로, 중간에 프로세스가 죽어도
 * 목적지에 **반쯤 쓰인 파일이 남지 않는다**. (직접 `writeFile(destination)` 금지)
 *
 * @returns 실제로 저장된 절대 경로 (이름 충돌 시 `-1` 등이 붙을 수 있다)
 */
async function writeFileAtomically(
  directory: string,
  safeName: string,
  data: Buffer,
): Promise<string> {
  const tempPath = path.join(directory, `.mdws-upload-${randomBytes(12).toString('hex')}.tmp`);

  // 1) 임시 파일에 전량 기록 + fsync
  const temp = await fs.open(tempPath, 'wx', UPLOADED_FILE_MODE);
  try {
    await temp.writeFile(data);
    await temp.sync();
  } finally {
    await temp.close();
  }

  // 2) 목적지 이름 선점 → 검증 → rename
  let destination = '';
  try {
    destination = await reserveDestination(directory, safeName);
    // 선점한 최종 이름도 예외 없이 경로 안전 검증을 거친다(충돌 회피로 이름이 바뀌었을 수 있다).
    await assertRealPathUnderRoot(destination);
    await fs.rename(tempPath, destination);
    return destination;
  } catch (error) {
    // 실패 시 잔여물을 남기지 않는다.
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    if (destination !== '') {
      await fs.rm(destination, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const env = getServerEnv();

  // --- 1. rate limit (보안 불변식 7) ------------------------------------------
  // 세션 키가 자동으로 우선 적용된다. 직접 IP를 읽으면 그 규칙이 깨진다.
  const limit = checkRateLimit(rateLimitKeyFor(request, 'upload'));
  if (!limit.allowed) {
    return apiError(429, 'Too many uploads. Try again shortly.', {
      'Retry-After': String(limit.retryAfterSec),
    });
  }

  // --- 2. 요청 총량 선검사 -----------------------------------------------------
  // 바디를 읽기 전에 헤더만으로 끊는다(파싱 비용·메모리를 아예 쓰지 않는다).
  const maxRequestBytes = env.UPLOAD_MAX_BYTES + MULTIPART_OVERHEAD_BYTES;
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    return apiError(413, 'File too large.');
  }

  // --- 3. multipart 파싱 -------------------------------------------------------
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Content-Type 불일치·깨진 경계 등. 내부 사유는 노출하지 않는다.
    return apiError(400, 'Invalid form data.');
  }

  // 프론트는 파일 1건씩 순차 전송하지만, getAll로 받아 두면 향후 배치 전송에도 호환된다.
  const files = form.getAll(UPLOAD_FIELD.file).filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return apiError(400, 'No file provided.');
  }

  // 필드가 없으면 루트로 해석한다(프론트가 루트일 때 필드를 생략한다).
  const targetPathRaw = form.get(UPLOAD_FIELD.targetPath);
  // Windows 한글 폴더명 깨짐 방지: NFC 정규화 + 위험문자·U+FFFD 제거
  const targetPath = typeof targetPathRaw === 'string'
    ? sanitizeFolderPath(targetPathRaw)
    : '';

  const saved: UploadedFileInfo[] = [];
  // targetDir을 try 블록 밖에서도 사용해야 하므로(알림 페이로드) 바깥에 선언한다.
  let targetDir = '';

  try {
    // --- 4. 대상 폴더 (보안 불변식 2) -----------------------------------------
    // 프론트가 정규화해 보내더라도 서버에서 예외 없이 다시 검증한다.
    targetDir = resolveUnderRoot(targetPath);
    await assertRealPathUnderRoot(targetDir);

    // --- 5. 전 파일 선검증 (보안 불변식 3) ------------------------------------
    const prepared: PreparedUpload[] = [];
    for (const file of files) {
      if (file.size > env.UPLOAD_MAX_BYTES) {
        return apiError(413, 'File too large.');
      }

      // 파일명 정제가 먼저다 — 확장자 판정도 정제된 이름 기준이어야 우회가 없다.
      const safeName = sanitizeFilename(file.name);
      const ext = path.extname(safeName).slice(1).toLowerCase();
      if (ext === '' || !env.ALLOWED_EXTENSIONS.includes(ext)) {
        return apiError(415, 'Unsupported file type.');
      }

      // 조립된 최종 경로도 루트 하위인지 확인한다(정제된 이름이라도 예외 없이).
      const destination = resolveUnderRoot(path.posix.join(toSubpath(targetDir), safeName));
      await assertRealPathUnderRoot(destination);

      prepared.push({ file, safeName });
    }

    // --- 6. 디렉터리 생성 + atomic write (보안 불변식 4) ----------------------
    await fs.mkdir(targetDir, { recursive: true });
    // mkdir 이후 실제로 만들어진 경로를 한 번 더 확인한다(중간 경로가 심볼릭 링크일 수 있다).
    await assertRealPathUnderRoot(targetDir);

    for (const { file, safeName } of prepared) {
      const data = Buffer.from(await file.arrayBuffer());
      const destination = await writeFileAtomically(targetDir, safeName, data);
      const stat = await fs.stat(destination);

      saved.push({
        name: path.basename(destination),
        // 절대 경로 노출 금지(보안 불변식 8) — 항상 루트 기준 상대 경로로 되돌린다.
        subpath: toSubpath(destination),
        size: stat.size,
        mtime: Math.round(stat.mtimeMs),
      });

      // 색인 증분 갱신 (실패해도 업로드 성공에 영향 없음)
      try {
        const uploadedSubpath = toSubpath(destination);
        if (uploadedSubpath.endsWith('.md') || uploadedSubpath.endsWith('.markdown')) {
          await indexFile(uploadedSubpath);
        }
      } catch (indexError) {
        console.error('[upload] index update failed:', indexError);
      }
    }
  } catch (error) {
    if (error instanceof PathSafetyError) {
      // 내부 사유·경로를 클라이언트에 넘기지 않는다. 서버 로깅만 한다(보안 불변식 8).
      console.error('[upload] path rejected:', error.message);
      return apiError(400, 'Invalid path.');
    }
    return internalError('upload', error);
  }

  // --- 업로드 완료 알림 -- best-effort (D5-1, D5-4) ---------------------------
  let notified = false;

  const targets: ShareTarget[] = [];
  if (env.DISCORD_WEBHOOK_URL) targets.push('discord');
  if (env.SLACK_WEBHOOK_URL) targets.push('slack');

  if (targets.length > 0 && saved.length > 0) {
    // 앱 URL 구성 (D5-3)
    const proto = sanitizeProto(request.headers.get('x-forwarded-proto'));
    const host = request.headers.get('host') || 'localhost:3000';
    const firstFile = saved[0];
    const appUrl = `${proto}://${host}/workspace/view?path=${encodeURIComponent(firstFile.subpath)}`;

    const payload: WebhookPayload = {
      fileName: saved.length === 1
        ? firstFile.name
        : `${saved.length}개 파일 업로드`,
      filePath: saved.length === 1
        ? firstFile.subpath
        : toSubpath(targetDir),
      appUrl,
      mtime: firstFile.mtime,
    };

    // 설정된 채널 전부에 병렬 발송 (D5-1)
    try {
      const results = await Promise.allSettled(
        targets.map((t) => sendWebhook(t, payload)),
      );
      notified = results.some(
        (r) => r.status === 'fulfilled' && r.value.ok,
      );
      // 실패분 로깅 (보안 불변식 8 -- 서버 콘솔만)
      for (const r of results) {
        if (r.status === 'rejected') {
          console.error('[upload] notification error:', r.reason);
        } else if (!r.value.ok) {
          console.error('[upload] notification failed:', r.value.error);
        }
      }
    } catch (err) {
      console.error('[upload] notification unexpected error:', err);
    }
  }

  const body: UploadResponse = { ok: true, files: saved, notified };
  return NextResponse.json(body);
}
