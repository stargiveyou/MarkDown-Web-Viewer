# Stage 1 완료 기록 — security-auth (Wave 1-A)

- 작성: `security-auth` / 2026-07-23
- 판정: **완료** — [검증 리포트](../valid/security-stage-1-validation.md) FAIL 0건
- 설계 결정: [security-stage-1-decisions.md](../agent-work/security-stage-1-decisions.md)
- 계약 변경: **없음** (`src/types/api.ts` 무수정)

> **backend-dev는 §3(공개 API)과 §4(라우트별 사용 예시)만 읽어도 Wave 2를 시작할 수 있다.**

---

## 1. 산출물

| # | 계획 항목 | 파일 | 상태 |
|---|---|---|---|
| 1 | `env.ts` 구현 | [src/lib/env.ts](../../src/lib/env.ts) | ✅ |
| 2 | `path-safety.ts` 구현 | [src/lib/path-safety.ts](../../src/lib/path-safety.ts) | ✅ |
| 3 | traversal 유닛 테스트 | [src/lib/path-safety.test.ts](../../src/lib/path-safety.test.ts) | ✅ 53 테스트 |
| 4 | `session.ts` 구현 | [src/lib/session.ts](../../src/lib/session.ts) | ✅ |
| 5 | `middleware.ts` | [src/middleware.ts](../../src/middleware.ts) | ✅ |
| 6 | `rate-limit.ts` 구현 | [src/lib/rate-limit.ts](../../src/lib/rate-limit.ts) | ✅ |
| 7 | `.env.local` 생성 | (gitignore 대상) | ✅ |
| 8 | 위협 모델 + 체크리스트 | [docs/valid/security-stage-1-validation.md](../valid/security-stage-1-validation.md) | ✅ |

**계획에 없었지만 추가한 것** (모두 위 항목을 성립시키기 위해 필요했다):

| 파일 | 왜 |
|---|---|
| [src/lib/password-hash.ts](../../src/lib/password-hash.ts) | scrypt 원시 함수. `session.ts`(서버)와 CLI가 **같은 구현**을 공유해야 한다. `server-only`를 import하지 않는 유일한 lib이며 시크릿·env 접근이 없다 |
| [src/scripts/hash-password.mts](../../src/scripts/hash-password.mts) | 비밀번호 변경용 CLI (`npm run hash-password`) |
| [src/lib/session.test.ts](../../src/lib/session.test.ts) | 세션 15 테스트 |
| [src/lib/rate-limit.test.ts](../../src/lib/rate-limit.test.ts) | rate limit 10 테스트 |

**수정한 공용 파일**

| 파일 | 변경 |
|---|---|
| `package.json` | `hash-password` 스크립트 추가 |
| `tsconfig.json` | `allowImportingTsExtensions: true` (CLI가 `../lib/password-hash.ts`를 확장자까지 명시해 import. `noEmit: true`라 안전) |
| `.env.local.example` | `SESSION_PASSWORD` 생성법·형식, `SESSION_SECRET` 교체 의미, `RATE_LIMIT_MAX` 근거 주석 보강 + 기본값 30 → 120 |

**건드리지 않은 것**: `src/lib/fetcher.ts`, `src/app/login/`, `src/app/workspace/`,
`src/components/`, `src/app/layout.tsx`, `src/app/globals.css`(frontend-dev 담당), `src/app/api/`(backend-dev 담당).

---

## 2. 🔑 개발용 임시 비밀번호

`.env.local`에 들어 있는 `SESSION_PASSWORD`는 아래 평문의 scrypt 해시다.

```
MdWs-Dev-2026!
```

- 로그인 화면에 이 값을 그대로 입력하면 된다. (검증 완료: 해시 대조 `true`)
- **평문은 `.env.local`을 포함해 어디에도 저장돼 있지 않다.** 이 문서에만 적혀 있다.
- `.env.local`은 `.gitignore:3`에 걸려 커밋되지 않는다 (`git check-ignore`로 확인함).

### ⚠️ 인터넷에 노출하기 전에 반드시 교체

```bash
npm run hash-password                    # 대화형 (입력이 화면에 표시되지 않음)
npm run hash-password -- '새 비밀번호'     # 인자 전달 (셸 히스토리 주의)
echo '새 비밀번호' | npm run hash-password  # 파이프
```

출력된 `SESSION_PASSWORD=scrypt:...` 한 줄로 `.env.local`의 기존 줄을 **통째로 교체**하고
서버를 재시작한다. 12자 미만은 CLI가 거부한다.

> 기존에 발급된 세션 쿠키는 비밀번호를 바꿔도 만료(12시간) 전까지 유효하다.
> **즉시 전면 로그아웃**하려면 `SESSION_SECRET`도 함께 새로 만든다:
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

> 💡 해시 구분자가 `$`가 아니라 `:`인 것은 의도적이다 — dotenv가 `$`를 변수 참조로 해석해
> **따옴표로 감싸도** 값을 잘라먹기 때문이다. 실제로 그 버그를 만나서 형식을 바꿨다
> ([decisions D-1](../agent-work/security-stage-1-decisions.md#d-1-해시-레코드-구분자를-가-아니라-로-한다)).

---

## 3. 공개 API (backend-dev 인수인계)

모든 모듈은 `server-only`다. 라우트 핸들러에는 **`export const runtime = "nodejs"`가 필수**다.

### `@/lib/env`

```ts
function getServerEnv(): ServerEnv          // 미설정 시 EnvConfigError throw (부팅 실패)
class EnvConfigError extends Error

interface ServerEnv {
  MARKDOWN_ROOT: string;        // ⚠️ 원본 문자열. 직접 경로 조립 금지 — resolveUnderRoot를 쓸 것
  SESSION_PASSWORD: string;     // scrypt 레코드 (해시)
  SESSION_SECRET: string;
  UPLOAD_MAX_BYTES: number;     // 413 기준
  ALLOWED_EXTENSIONS: string[]; // 소문자, 점 없음 — 예: ['md','png']. 415 기준
  RATE_LIMIT_MAX: number;
  RATE_LIMIT_WINDOW_SEC: number;
  DISCORD_WEBHOOK_URL?: string; // 미설정이면 undefined → 해당 채널 비활성 처리
  SLACK_WEBHOOK_URL?: string;
}
```

### `@/lib/path-safety` — 보안 불변식 2

```ts
class PathSafetyError extends Error                                  // → 400으로 변환할 것

function resolveUnderRoot(userPath: string): string                  // 상대 경로 → 검증된 절대 경로 (동기)
async function assertRealPathUnderRoot(absolutePath: string): Promise<void>  // 심볼릭 링크 검사
function toSubpath(absolutePath: string): string                     // 절대 → 상대 (응답용). 루트면 ''
function sanitizeFilename(name: string): string                      // 업로드 파일명 정제
```

**두 함수는 대체재가 아니라 순서대로 둘 다 호출한다.**

| 함수 | 수준 | 언제 |
|---|---|---|
| `resolveUnderRoot` | 문자열 / `path.resolve` | **모든** 사용자 경로 입력에 예외 없이 |
| `assertRealPathUnderRoot` | 파일시스템 `realpath` | 그 경로로 **읽거나 쓰기 직전** |

- `resolveUnderRoot('')`, `('.')`, `('./')` → 루트 절대 경로 (목록 조회 기본값)
- `assertRealPathUnderRoot`는 **아직 없는 파일도 안전하게 처리**한다 —
  존재하는 최근접 조상까지 거슬러 realpath를 구하므로 업로드 대상에 그대로 쓰면 된다.
- `sanitizeFilename`은 정제 결과가 비면 **throw**한다(조용히 임의 이름을 만들지 않는다).
- 응답에 경로를 실을 때는 반드시 `toSubpath()`를 통과시킨다. 절대 경로 노출 금지(불변식 8).

### `@/lib/session` — 보안 불변식 1

```ts
const SESSION_COOKIE: 'mdws_session'
const SESSION_TTL_SEC: number                                        // 43200 (12시간)

async function verifyPassword(input: string): Promise<boolean>       // scrypt + timingSafeEqual
async function createSessionCookie(): Promise<string>                // 서명 토큰 값
async function verifySessionCookie(value: string | undefined): Promise<boolean>

async function applySessionCookie(writer: CookieWriter): Promise<void>  // 👈 로그인에서 이것만 쓰면 된다
function clearSessionCookie(writer: CookieWriter): void                // 👈 로그아웃

function sessionCookieOptions(): SessionCookieOptions                // 직접 Set-Cookie를 만들 때
function clearedSessionCookieOptions(): SessionCookieOptions
function readSessionCookie(request: Request): string | undefined
function sessionIdentifier(token: string | undefined): string | null
```

`CookieWriter`는 `{ set(...) }` 구조 타입이라 **`NextResponse.cookies`와 `await cookies()` 양쪽 모두** 그대로 넘길 수 있다.

> 세션 검증은 **미들웨어가 이미 전부 처리**한다. 라우트 핸들러에서 다시 확인할 필요는 없다.
> (원하면 `verifySessionCookie(readSessionCookie(req))`로 이중 확인은 가능하다.)

### `@/lib/rate-limit` — 보안 불변식 7

```ts
interface RateLimitResult { allowed: boolean; remaining: number; retryAfterSec: number }

function checkRateLimit(key: string, override?: RateLimitOverride): RateLimitResult
function rateLimitKeyFor(request: Request, scope: string): string    // 세션 우선, IP 폴백
function clientIpFromHeaders(request: Request): string               // ⚠️ 위조 가능 — 로깅/제한용만

const RATE_LIMIT_POLICY = {
  upload: null,                        // env 값 사용 (120/60초)
  shareNotify: { max: 10, windowSec: 60 },
  login: { max: 10, windowSec: 300 },
}
```

**`rateLimitKeyFor`를 쓸 것.** 직접 IP를 읽으면 세션 우선 규칙이 깨진다.

---

## 4. 라우트별 사용 예시

### `POST /api/auth/login` — 유일한 무인증 라우트

```ts
// src/app/api/auth/login/route.ts
import { NextResponse } from 'next/server';

import { RATE_LIMIT_POLICY, checkRateLimit, rateLimitKeyFor } from '@/lib/rate-limit';
import { applySessionCookie, verifyPassword } from '@/lib/session';
import type { ApiError, LoginRequest, LoginResponse } from '@/types/api';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  // 1) 무차별 대입 방지. 미인증 라우트라 키는 IP 폴백이 된다(위조 가능 — 위협 모델 T-5).
  const limit = checkRateLimit(rateLimitKeyFor(request, 'login'), RATE_LIMIT_POLICY.login);
  if (!limit.allowed) {
    const body: ApiError = { code: 429, message: 'Too many attempts. Try again later.' };
    return NextResponse.json(body, {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSec) },
    });
  }

  // 2) 입력 파싱. 형식 오류도 401로 접어 "패스워드가 틀렸다"와 구분되지 않게 한다.
  let password = '';
  try {
    password = ((await request.json()) as LoginRequest).password ?? '';
  } catch {
    password = '';
  }

  // 3) timing-safe 비교
  if (!(await verifyPassword(password))) {
    const body: ApiError = { code: 401, message: 'Invalid password.' };
    return NextResponse.json(body, { status: 401 });
  }

  // 4) 세션 쿠키 발급 — httpOnly/SameSite/Secure/만료가 전부 여기 안에 있다
  const body: LoginResponse = { ok: true };
  const response = NextResponse.json(body);
  await applySessionCookie(response.cookies);
  return response;
}
```

### `POST /api/auth/logout`

```ts
// src/app/api/auth/logout/route.ts
import { NextResponse } from 'next/server';

import { clearSessionCookie } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true } as const);
  clearSessionCookie(response.cookies);   // 서버에 지울 상태는 없다(stateless 세션)
  return response;
}
```

### `POST /api/upload` — 경로 안전 + 업로드 하드닝

```ts
// src/app/api/upload/route.ts
import path from 'node:path';

import { NextResponse } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { PathSafetyError, assertRealPathUnderRoot, resolveUnderRoot, sanitizeFilename, toSubpath } from '@/lib/path-safety';
import { checkRateLimit, rateLimitKeyFor } from '@/lib/rate-limit';
import { UPLOAD_FIELD, type ApiError } from '@/types/api';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  const env = getServerEnv();

  // 1) rate limit — 세션 키가 자동으로 우선 적용된다
  const limit = checkRateLimit(rateLimitKeyFor(request, 'upload'));
  if (!limit.allowed) {
    return NextResponse.json({ code: 429, message: 'Rate limited.' } satisfies ApiError, {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSec) },
    });
  }

  const form = await request.formData();
  // 프론트는 파일 1건씩 순차 전송하지만, getAll로 받아 두면 향후 배치에도 호환된다
  const files = form.getAll(UPLOAD_FIELD.file).filter((f): f is File => f instanceof File);
  const targetPath = String(form.get(UPLOAD_FIELD.targetPath) ?? '');

  try {
    // 2) 대상 폴더 — 반드시 경로 안전 유틸 경유 (프론트가 정규화해 보내더라도 재검증)
    const targetDir = resolveUnderRoot(targetPath);
    await assertRealPathUnderRoot(targetDir);

    for (const file of files) {
      // 3) 크기 → 413
      if (file.size > env.UPLOAD_MAX_BYTES) {
        return NextResponse.json({ code: 413, message: 'File too large.' } satisfies ApiError, { status: 413 });
      }

      // 4) 파일명 정제 후 확장자 → 415
      const safeName = sanitizeFilename(file.name);
      const ext = path.extname(safeName).slice(1).toLowerCase();
      if (!env.ALLOWED_EXTENSIONS.includes(ext)) {
        return NextResponse.json({ code: 415, message: 'Unsupported file type.' } satisfies ApiError, { status: 415 });
      }

      // 5) 최종 경로 — 조립 후 다시 검증한다(정제된 이름이라도 예외 없이)
      const destination = resolveUnderRoot(path.posix.join(toSubpath(targetDir), safeName));
      await assertRealPathUnderRoot(destination);

      // 6) TODO(backend-dev): atomic write — 임시 파일에 쓰고 rename (보안 불변식 4)
      //    응답의 subpath는 반드시 toSubpath(destination) — 절대 경로 노출 금지(불변식 8)
    }
  } catch (error) {
    if (error instanceof PathSafetyError) {
      // 내부 사유·경로를 클라이언트에 넘기지 않는다. 서버 로깅만 한다(불변식 8).
      console.error('[upload] path rejected:', error.message);
      return NextResponse.json({ code: 400, message: 'Invalid path.' } satisfies ApiError, { status: 400 });
    }
    throw error;
  }

  // ...
}
```

### 다른 라우트 공통 패턴 (Stage 2 이후)

```ts
// GET /api/file-content?path=... 등 — 읽기 전
const absolute = resolveUnderRoot(searchParams.get('path') ?? '');
await assertRealPathUnderRoot(absolute);        // ← 이걸 빠뜨리면 심볼릭 링크 탈출이 열린다
const content = await fs.readFile(absolute, 'utf8');
return NextResponse.json({ content, mtime, subpath: toSubpath(absolute) });
```

---

## 5. rate limit 값 근거 (`RATE_LIMIT_MAX=120` / 60초)

`frontend-dev`가 **파일 1개당 요청 1개**로 순차 전송하기로 했다
([frontend-stage-1-client-contract.md](../agent-work/frontend-stage-1-client-contract.md) §1).
따라서 이 값은 "분당 업로드 가능한 **파일 수**"와 같다.

| 후보 | 판단 |
|---|---|
| 30 (예제 기본값) | ❌ 파일 30개 폴더를 한 번 드롭하면 즉시 429. **정상 사용이 막힌다** |
| 60 | △ 사진 100장 업로드가 중간에 끊긴다 |
| **120** | ✅ 100장 배치 + 여유 20. 지속 남용은 2 req/s로 억제 |
| 1000 | ❌ 사실상 제한 없음. 불변식 7이 형해화 |

**120을 고른 이유**: "사진 100장짜리 폴더 하나를 통째로 올린다"를 정상 사용의 상한으로 잡고,
재시도 여유 20%를 얹었다. 프론트가 429를 받으면 남은 큐를 즉시 중단하므로
한도에 걸려도 서버가 폭주 요청을 계속 받지는 않는다.

**단, 이 값을 공유 알림·로그인에 그대로 쓰면 안 된다.** 그래서 `RATE_LIMIT_POLICY`로 분리했다
(공유 10/분, 로그인 10/5분). 업로드만 env 값을 따른다.

---

## 6. 검증 결과

| 명령 | 결과 |
|---|---|
| `npm run typecheck` | ✅ 오류 0 |
| `npm test` | ✅ **80 테스트 / 4 파일 통과** |
| `npm run lint` | ✅ 오류 0, 경고 0 (기존 스텁 경고 12건도 해소됨) |
| `npm run build` | ✅ 성공 |

실서버 curl 15종(미인증 401·리다이렉트, 유효/위조/만료 쿠키, 메서드별 예외, CSRF, 정적 자산)
전부 기대대로 동작했고 **서버 에러 로그 0건**이다. 상세는 [검증 리포트](../valid/security-stage-1-validation.md) §2.

프로덕션 빌드의 `.next/static`에서 `SESSION_SECRET`·해시·`MARKDOWN_ROOT`·`scrypt` 문자열
**전부 0건** 검출 = 보안 불변식 6 충족.

---

## 7. 남은 것 / 후속 제안

| # | 항목 | 담당 | 비고 |
|---|---|---|---|
| 1 | 업로드 413/415 실제 반환, atomic write | `backend-dev` | Wave 2. §4 예시에 훅 지점 표시 |
| 2 | ngrok 엣지 Basic Auth + Traffic Policy | `security-auth` | 배포 시점 |
| 3 | **SVG 저장형 XSS** — `ALLOWED_EXTENSIONS` 기본값에 `svg`가 있다 | `security-auth` / `frontend-dev` | Stage 2 뷰어 구현 시. 백로그 등록 권장 |
| 4 | `middleware` → `proxy` 파일 컨벤션 이관 (Next 16 deprecation 경고) | `tech-lead` 판단 | 계획 문서 산출물명 변경을 수반 |
| 5 | 인터넷 노출 전 임시 비밀번호 교체 | 사용자 | §2 참조 |
