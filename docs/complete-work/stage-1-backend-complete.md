# Stage 1 — backend-dev 완료 기록 (Wave 2)

- 담당: `backend-dev` (model: opus)
- 완료일: 2026-07-23
- 근거 계약: [contract-stage-0.md](../agent-work/contract-stage-0.md) · [src/types/api.ts](../../src/types/api.ts)
- 선행 산출물: [stage-1-security-complete.md](stage-1-security-complete.md) §3·§4 ·
  [frontend-stage-1-client-contract.md](../agent-work/frontend-stage-1-client-contract.md) §1
- 설계 결정: [backend-stage-1-decisions.md](../agent-work/backend-stage-1-decisions.md)
- 계약 변경: **없음** (`src/types/api.ts` 무수정)

---

## 1. 구현 범위

Stage 1 계획서 [stage-1-tasks.md](../plan/stage-1-tasks.md) Wave 2의 라우트 3개.
세션 검증은 미들웨어가 전담하므로 라우트에서 재확인하지 않는다(security-auth 인수인계 §3).

| 메서드 | 경로 | 상태 |
|--------|------|------|
| POST | `/api/auth/login` | ✅ timing-safe 비교 + 서명 쿠키 발급, 5분 10회 rate limit |
| POST | `/api/auth/logout` | ✅ 쿠키 즉시 만료 |
| POST | `/api/upload` | ✅ 413/415/429/400 + 경로 안전 2단 검증 + atomic write |

## 2. 변경 / 생성 파일

**생성**

| 파일 | 내용 |
|------|------|
| [src/app/api/auth/login/route.ts](../../src/app/api/auth/login/route.ts) | 유일한 무인증 라우트. rate limit → 바디 크기 선검사 → 파싱 → `verifyPassword()` → `applySessionCookie()` |
| [src/app/api/auth/logout/route.ts](../../src/app/api/auth/logout/route.ts) | `clearSessionCookie()` → `{ ok: true }` |
| [src/app/api/upload/route.ts](../../src/app/api/upload/route.ts) | multipart 업로드. 전 파일 선검증 후 atomic write |
| [docs/agent-work/backend-stage-1-decisions.md](../agent-work/backend-stage-1-decisions.md) | 설계 결정 8건 (D-1~D-8) |

**수정한 공용 파일 (1건)**

| 파일 | 변경 | 왜 |
|------|------|-----|
| [next.config.ts](../../next.config.ts) | `experimental.proxyClientMaxBodySize` 추가 (`UPLOAD_MAX_BYTES + 4MiB`) | **버그 수정.** Next 프록시(구 middleware) 계층의 기본 바디 상한이 10MB라, 10MB 초과 업로드는 바디가 **잘린 채** 라우트에 도달해 413이 아니라 400 `Invalid form data.`가 나갔다. `UPLOAD_MAX_BYTES=20MB` 정책이 조용히 무력화된 상태였다. 상세: [D-1](../agent-work/backend-stage-1-decisions.md#d-1-next-프록시구-middleware의-10mb-바디-상한을-nextconfigts에서-올렸다) |

**건드리지 않은 것**: `src/lib/*`, `src/middleware.ts`(security-auth 담당),
`src/lib/fetcher.ts`, `src/app/login/`, `src/app/workspace/`, `src/components/`(frontend-dev 담당),
`src/types/api.ts`(계약).

## 3. 엔드포인트별 동작

### `POST /api/auth/login`

| 상황 | 응답 |
|---|---|
| 정상 | `200 { ok: true }` + `Set-Cookie: mdws_session=...; HttpOnly; SameSite=lax; Max-Age=43200` |
| 패스워드 불일치 | `401 { code: 401, message: "Invalid password." }` |
| 바디가 JSON이 아님 / 필드 없음 / 타입 불일치 | **동일하게 401** — 실패 사유를 구분해 주지 않는다 |
| 5분 10회 초과 | `429` + `Retry-After` |
| 바디 4KB 초과 | `400 { code: 400, message: "Invalid request." }` (파싱 전 차단) |
| `GET` | `401` — 미들웨어가 `POST`만 예외 처리하므로 핸들러를 두지 않았다 |

### `POST /api/auth/logout`

`200 { ok: true }` + `Set-Cookie: mdws_session=; Max-Age=0`.
세션이 stateless HMAC 토큰이라 서버에 지울 상태가 없다.
미인증 요청은 미들웨어가 401로 막는다(이 라우트도 보호 대상이다).

### `POST /api/upload`

처리 순서: **rate limit → 요청 총량 선검사 → multipart 파싱 → 대상 폴더 경로 검증 → 전 파일 선검증 → mkdir → atomic write**

| 상황 | 응답 |
|---|---|
| 정상 | `200 UploadResponse { ok, files[], notified: false }` |
| 분당 120회 초과 | `429` + `Retry-After` (env `RATE_LIMIT_MAX`) |
| 요청 총량 > `UPLOAD_MAX_BYTES + 1MiB` | `413` (헤더만 보고 바디를 읽지 않는다) |
| 파일 크기 > `UPLOAD_MAX_BYTES` | `413 File too large.` |
| 확장자가 `ALLOWED_EXTENSIONS` 밖 / 확장자 없음 | `415 Unsupported file type.` |
| `targetPath` traversal·절대경로·인코딩 우회·심볼릭 링크 탈출 | `400 Invalid path.` (내부 사유는 서버 로그에만) |
| multipart 아님 / 깨진 경계 | `400 Invalid form data.` |
| `file` 필드 없음 | `400 No file provided.` |
| 디스크 쓰기 실패 등 | `500` + `{ code, message }` 모양 유지 ([D-6](../agent-work/backend-stage-1-decisions.md)) |

계약 문서에 없던 부분을 정한 것:

- `targetPath` 필드가 **없으면 루트**로 해석한다(프론트가 루트일 때 필드를 생략한다).
- 파일은 `formData.getAll(UPLOAD_FIELD.file)`로 받아 **배치 전송에도 호환**된다.
  단, 하나라도 검증에 걸리면 **아무것도 저장하지 않는다**(all-or-nothing, D-3).
- 이름이 충돌하면 덮어쓰지 않고 `note-1.md`로 비켜 간다(D-4). 응답에는 **실제 저장된 이름**이 실린다.
- 업로드 파일 권한은 `0600`.

## 4. 계약 준수 자체 점검

| 항목 | 확인 | 근거 |
|------|:---:|------|
| `export const runtime = 'nodejs'` — 세 라우트 전부 | ☑ | 각 파일 상단 |
| 인증 강제 (login 외 전부) | ☑ | 미들웨어 전담. 미인증 업로드·로그아웃 401 실측 (E2E #2·#3) |
| `/api/auth/login`이 유일한 무인증 라우트 | ☑ | `GET /api/auth/login`도 401 실측 (E2E #1) |
| 경로 검증 유틸 경유 — `resolveUnderRoot()` → `assertRealPathUnderRoot()` **순서대로 둘 다** | ☑ | 대상 폴더 1회, 파일별 최종 경로 1회, mkdir 직후 1회, 충돌 회피로 이름이 바뀐 최종 경로 1회 |
| 업로드 검증: 크기 413 / 확장자 415 / 파일명 `sanitizeFilename()` | ☑ | E2E #14·#15. 확장자 판정은 **정제된 이름 기준**(우회 방지) |
| Atomic write (임시 파일 → fsync → rename) | ☑ | `writeFileAtomically()`. 목적지에 직접 `writeFile` 하는 경로 없음 |
| rate limit — 반드시 `rateLimitKeyFor()`로 키 생성 | ☑ | login `RATE_LIMIT_POLICY.login`, upload는 env 기본값. 직접 IP를 읽는 코드 없음 |
| 에러 바디 `ApiError { code, message }` JSON | ☑ | 전 응답 실측 |
| 절대경로·스택트레이스·내부 오류 비노출 (불변식 8) | ☑ | 응답 23종 grep — `/Users/`·`MarkdownDocs`·`Error:`·`scrypt`·`node_modules` **0건**. `PathSafetyError` 사유는 서버 콘솔에만 |
| 응답 경로는 `toSubpath()`로 상대화 | ☑ | `subpath: "2026-Travel/Jeju/jeju.md"` 형태 실측 |
| 색인 갱신(Stage 3)·Webhook(Stage 5)은 TODO 주석만, `notified: false` | ☑ | `TODO(Stage 3)` / `TODO(Stage 5)` 훅 지점 |
| `src/types/api.ts` 무수정 | ☑ | 계약 변경 없음 |
| 코드는 영어 / 주석은 한글 | ☑ | — |

## 5. 검증 결과

### 정적 검증

| 명령 | 결과 |
|---|---|
| `npm run typecheck` | ✅ 오류 0 |
| `npm run lint` | ✅ 오류 0, 경고 0 |
| `npm test` | ✅ **80 테스트 / 4 파일 통과** (기존 스위트 무회귀) |
| `npm run build` | ✅ 성공. `/api/auth/login`·`/api/auth/logout`·`/api/upload`가 ƒ(Dynamic)로 등록 |

### 실서버 E2E (`npm run dev` + curl, 31종)

`MARKDOWN_ROOT=/Users/husky/MarkdownDocs`에 실제로 파일이 저장되는 것까지 확인했다.

| # | 시나리오 | 기대 | 실측 |
|---|---|---|---|
| 1 | `GET /api/auth/login` | 401 | ✅ 401 |
| 2 | 미인증 업로드 | 401 | ✅ 401 |
| 3 | 미인증 로그아웃 | 401 | ✅ 401 |
| 4 | 잘못된 비밀번호 | 401 | ✅ 401 `Invalid password.` |
| 5 | 바디가 JSON이 아님 | 401(동일 문구) | ✅ 401 |
| 6 | 정상 로그인 | 200 + 세션 쿠키 | ✅ `HttpOnly; SameSite=lax; Max-Age=43200` |
| 7 | 인증 업로드 (루트, `targetPath` 생략) | 200 + 저장 | ✅ `note.md` |
| 8 | 인증 업로드 (`2026-Travel/Jeju`) | 200 + 폴더 자동 생성 | ✅ `2026-Travel/Jeju/jeju.md` |
| 9 | 같은 이름 재업로드 | 덮어쓰기 금지 | ✅ `note-1.md`로 저장, 원본 보존 |
| 10 | `targetPath=../../tmp` | 400 | ✅ 400 `Invalid path.` |
| 11 | `targetPath=%2e%2e%2ftmp` (인코딩 우회) | 400 | ✅ 400 |
| 12 | `targetPath=/etc` (절대경로) | 400 | ✅ 400 |
| 13 | `filename=../../escaped.md` | 새니타이즈 후 루트 저장 | ✅ `escaped.md` (루트 밖 유출 없음) |
| 14 | `.exe` 업로드 | 415 | ✅ 415 |
| 15 | 25MB 파일 (상한 20MB) | 413 | ✅ 413 |
| 16 | `file` 필드 없음 | 400 | ✅ 400 `No file provided.` |
| 17 | multipart 아님(JSON) | 400 | ✅ 400 `Invalid form data.` |
| 18 | 배치 2건 중 1건이 415 | 415 + **아무것도 저장 안 됨** | ✅ 저장 0건 |
| 19 | 배치 2건 모두 정상 | 200 + `files` 2건 | ✅ 2건 저장 |
| 20 | 다른 Origin (CSRF) | 400 | ✅ 400 (미들웨어) |
| 21 | 로그아웃 | 200 + 쿠키 만료 | ✅ `Max-Age=0` |
| 22 | 잔여 임시 파일(`.tmp`) | 0건 | ✅ 0건 |
| 23 | 응답 바디 내부정보 누출 | 0건 | ✅ 0건 |
| 24 | **15MB 파일** (구 프록시 상한 10MB 초과) | 200 + 무결성 | ✅ SHA-256 원본 일치 |
| 25 | 업로드 rate limit | 120회 후 429 | ✅ 119+1=120 성공 후 `429` + `retry-after: 16` |
| 26 | 로그인 rate limit | 10회 후 429 | ✅ 10회 후 `429` + `retry-after: 215` |
| 27 | 로그인 바디 9KB | 400 | ✅ 400 `Invalid request.` |
| 28 | rate limit 창 리셋 후 정상 로그인 | 200 | ✅ 200 |
| 29 | 로그아웃 후 삭제된 쿠키로 업로드 | 401 | ✅ 401 |
| 30 | 위조 쿠키로 업로드 | 401 | ✅ 401 |
| 31 | 한글 파일명·한글 폴더 | 200 + 정상 저장 | ✅ `2026-여행/제주 여행기.md` |

**서버 로그**: 예기치 못한 에러·예외 **0건**.
`[upload] path rejected: ...` 3건만 남았고 이는 traversal 차단의 **의도된 서버 측 로깅**이다.

**정리**: 검증 후 `~/MarkdownDocs`의 테스트 산출물 132건을 전부 삭제해 빈 상태로 되돌렸고,
개발 서버도 종료했다(포트 3000 미응답 확인).

### 단계 완료 조건 대조 ([stage-1-tasks.md](../plan/stage-1-tasks.md) §단계 완료 조건)

| # | 조건 | 상태 |
|---|---|---|
| 1 | 로그인 → 업로드 → `~/MarkdownDocs`에 실제 저장 | ✅ E2E #6~#8, #31 |
| 2 | 미인증 요청이 모든 보호 라우트에서 401 | ✅ E2E #1~#3, #29, #30 |
| 3 | traversal 테스트 전부 통과 | ✅ 유닛 53건 + E2E #10~#13 |
| 4 | `npm run build` / `typecheck` / `test` 통과 | ✅ |
| 5 | 검증 리포트 FAIL 0건 | ⏳ `backend-validator` 대기 |

## 6. 의존성 추가

**없음.** `node:crypto`·`node:fs/promises`·`node:path`와 기존 `next`만 사용했다.

## 7. 발견했지만 고치지 않은 것 (보고만)

| # | 내용 | 판단 |
|---|---|---|
| 1 | **빌드 경고 1건** — `Encountered unexpected file in NFT list`. `src/app/api/upload/route.ts` → `src/lib/path-safety.ts`의 동적 `path.resolve/join` 때문에 Turbopack이 프로젝트 전체를 트레이싱한다. 라우트를 제거하면 사라지는 것을 실측 확인했다 | **무해.** 파일시스템 앱의 본질이며 `path-safety.ts`를 고치지 않고는 없앨 수 없다(수정 금지 파일). NFT 목록은 `output: 'standalone'`에서만 쓰이고 우리는 `next start`로 상주한다. 빌드는 성공한다 |
| 2 | `middleware` 파일 컨벤션 deprecation 경고 (Next 16 → `proxy`) | security-auth가 이미 [§7-4](stage-1-security-complete.md)로 보고한 기존 항목. `tech-lead` 판단 대기 |
| 3 | `ALLOWED_EXTENSIONS`에 `svg`가 있어 저장형 XSS 표면이 된다 | security-auth [§7-3](stage-1-security-complete.md)의 기존 항목. Stage 2 뷰어 구현 시 대응 |

프론트엔드·보안 파일에서 **수정이 필요한 문제는 발견하지 못했다.** 인수인계 문서(§3·§4)의
공개 API가 실제 시그니처와 정확히 일치했고, 예시 코드는 그대로 동작했다.

## 8. 미결 / 다음 단계로 넘긴 항목

| # | 항목 | 담당 | 비고 |
|---|---|---|---|
| 1 | 검색 색인 증분 갱신 — 라우트에 `TODO(Stage 3)` 훅 지점만 있음 | `backend-dev` | Stage 3 (FTS5, ADR-007) |
| 2 | 업로드 완료 Webhook — `TODO(Stage 5)`. `notified`는 항상 `false` | `backend-dev` | Stage 5 |
| 3 | `ApiErrorCode`에 500을 추가할지 / 계약 밖 예외로 명시할지 | `tech-lead` | [D-6](../agent-work/backend-stage-1-decisions.md) |
| 4 | `next.config.ts` 프록시 바디 상한 리뷰 | `security-auth` | [D-1](../agent-work/backend-stage-1-decisions.md). `UPLOAD_MAX_BYTES` 변경 시 자동 연동됨 |
| 5 | 배치 전송 시 요청 **총량**이 파일 1개 상한을 넘을 수 없다는 제약 | `tech-lead` 판단 | 현재 프론트(1파일=1요청)에는 영향 없음 |
| 6 | 라우트 유닛 테스트 미작성 (E2E curl 31종으로 대체) | `backend-validator` 판단 | 기존 유닛 스위트 80건은 lib 레이어 커버 |

## 9. 검증 요청

> **TO: `backend-validator`** — 검증 범위:
> [src/app/api/auth/login/route.ts](../../src/app/api/auth/login/route.ts) ·
> [src/app/api/auth/logout/route.ts](../../src/app/api/auth/logout/route.ts) ·
> [src/app/api/upload/route.ts](../../src/app/api/upload/route.ts) ·
> [next.config.ts](../../next.config.ts)(프록시 바디 상한 1건).
>
> 재현 절차는 §5 표 그대로입니다. 개발용 비밀번호는
> [stage-1-security-complete.md §2](stage-1-security-complete.md)에 있습니다.
> 특히 확인을 부탁드리는 지점:
> 1. **10MB 초과 업로드**(E2E #24) — 이 프로젝트에서 가장 놓치기 쉬웠던 실패 모드입니다.
> 2. **이름 충돌 시 덮어쓰기 금지**(E2E #9) — 계약에 없던 결정이라 판단이 필요합니다.
> 3. 배치 전송의 all-or-nothing(E2E #18)이 계약과 어긋나지 않는지.
