# 백엔드 검증 — Stage 1

- 검증 일시: 2026-07-23
- 검증 주체: `backend-validator` (읽기 전용 — 코드 무수정)
- 대상 파일 범위:
  - [src/app/api/auth/login/route.ts](../../src/app/api/auth/login/route.ts)
  - [src/app/api/auth/logout/route.ts](../../src/app/api/auth/logout/route.ts)
  - [src/app/api/upload/route.ts](../../src/app/api/upload/route.ts)
  - [next.config.ts](../../next.config.ts) (`experimental.proxyClientMaxBodySize` 1건)
- 전제: 보안 유틸(`src/lib/{path-safety,session,rate-limit,env}.ts`, `src/middleware.ts`)은
  [security-stage-1-validation.md](security-stage-1-validation.md)에서 이미 PASS.
  본 리포트는 **라우트가 그 유틸을 올바르게 사용하는지**를 판정한다.
- 검증 방법: 전 파일 정독 + `npm run typecheck`/`npm test`(80/80)/`npm run build` + 실서버 E2E(curl 32종, 검증 후 서버 종료·테스트 파일 전량 삭제 확인)

## 종합 판정: **PASS** (FAIL 0건)

계약 위반·보안 불변식 위반 **없음**. 비차단 관찰 사항 5건은 §5에 기록했고,
그중 1건(`%` 포함 파일명 거부)만 backlog 반영을 제안한다(§6).

---

## 1. 엔드포인트별 계약 대조표

| 엔드포인트 | 인증 | 경로검증 | 상태코드 | 판정 |
|-----------|------|---------|---------|------|
| `POST /api/auth/login` | 무인증(유일). `middleware.ts:33-35`가 **메서드까지** 일치해야 통과 | 해당 없음 | 200 / 401 / 429 / 400(4KB 초과) — 전부 실측 | **PASS** |
| `GET /api/auth/login` | 미들웨어가 보호(공개 목록은 POST만). E2E T1: 401 실측 | 해당 없음 | 401 | **PASS** |
| `POST /api/auth/logout` | 미들웨어 보호. E2E T3: 미인증 401 실측 | 해당 없음 | 200 / 401 | **PASS** |
| `POST /api/upload` | 미들웨어 보호. E2E T2(무쿠키)·T28(위조 쿠키): 401 실측 | 2단 검증 4회 경유 (§2 불변식 2) | 200 / 400 / 401 / 413 / 415 / 429 / (500) — 전부 실측(500 제외) | **PASS** |

계약 타입 대조 ([src/types/api.ts](../../src/types/api.ts)):

- 로그인 응답 `LoginResponse { ok: true }` — `login/route.ts:71-72`에서 타입 그대로 사용. 실측 `{"ok":true}` 일치
- 업로드 응답 `UploadResponse { ok, files[], notified }` — `upload/route.ts:275`. `UploadedFileInfo`의
  `name/subpath/size/mtime` 4필드 전부 채워짐(`upload/route.ts:252-258`), 실측 일치
- FormData 필드명은 `UPLOAD_FIELD` 상수 사용(`upload/route.ts:204, 210`) — 문자열 드리프트 없음
- 에러 바디는 전부 `ApiError { code, message }` 형태 — `login/route.ts:33-35`, `upload/route.ts:73-75`,
  `middleware.ts:52-55`. `satisfies ApiError`로 타입 강제
- **500 반환(`upload/route.ts:86-88`)은 계약 위반이 아니다** — `ApiErrorCode`에 500이 명시돼 있다
  (`src/types/api.ts:49`). 단 CLAUDE.md의 상태코드 목록에는 500이 빠져 있다(§5-2 문서 드리프트)
- `src/types/api.ts` 무수정 확인 (계약 변경 없음)

미들웨어 위임의 유효성 — matcher를 직접 확인했다 (`middleware.ts:148-152`):
`'/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|...)$).*)'`
제외 대상은 정적 자산뿐이며, `/api/auth/login`·`/api/auth/logout`·`/api/upload`는 확장자가 없어
**전부 매처에 걸린다**. `src/app` 전수 열거 결과 라우트 파일은 이 3개가 전부이고,
무인증 통과는 `PUBLIC_API`(`middleware.ts:33-35`)의 `POST /api/auth/login` 단 1건이다. 새는 경로 없음.

## 2. 보안 불변식 대조표

| # | 불변식 | 강제 위치(파일:라인) | 판정 |
|---|--------|---------------------|------|
| 1 | login 외 전 라우트 세션 보호 | `middleware.ts:102-124`(검증) + `middleware.ts:148-152`(matcher) + `middleware.ts:33-35`(예외는 POST login뿐). E2E T1·T2·T3·T28 실측 401 | **PASS** |
| 2 | 경로 검증 단일 유틸 경유 — `resolveUnderRoot()` → `assertRealPathUnderRoot()` **둘 다, 순서대로** | ① 대상 폴더 `upload/route.ts:218-219` ② 파일별 최종 경로 `:236-237` ③ mkdir 직후 `:243-245` ④ 충돌 회피로 바뀐 최종 이름 `:161`(문자열 포함검사는 `path-safety.ts:192`가 내장). 우회 경로 없음. E2E T10~T13·T32(심볼릭 링크) 실측 차단 | **PASS** |
| 3 | 업로드 검증: 크기 413 / 확장자 415 / 파일명 새니타이즈 | 총량 `upload/route.ts:188-192`, 파일별 크기 `:224-226`, `sanitizeFilename` `:229`, 확장자 화이트리스트 `:230-233`. **순서 올바름**: 새니타이즈(`:229`)가 확장자 판정(`:230`)과 경로 조립(`:236`)보다 먼저다. E2E T14(415)·T16(413) 실측 | **PASS** |
| 4 | Atomic write (임시 파일 → rename) | `writeFileAtomically()` `upload/route.ts:140-172`: 같은 디렉터리 `.tmp`에 `open('wx',0600)`(`:148`) → `writeFile`+`fsync`(`:150-151`) → `rename`(`:162`). 목적지 직접 `writeFile` **없음**(grep 확인). 실패 시 잔여물 정리 `:166-169`, E2E T29 잔여 `.tmp` 0건 | **PASS** |
| 5 | 무단 덮어쓰기 금지 (취지 적용) | 이름 충돌 시 `open('wx')` 원자 선점으로 `note-1.md` 회피 `upload/route.ts:107-129`. E2E T8 실측 (409 계약은 Stage 2 `PUT /api/file-content` 대상 — 이번 범위 아님) | **PASS** |
| 6 | 시크릿 비노출 | 라우트 어디에도 `SESSION_SECRET`·Webhook URL 참조 없음(세션 서명은 `session.ts:74-77` 내부). 응답 바디 실측에서 시크릿 0건 | **PASS** |
| 7 | rate limit | login `login/route.ts:40`(`rateLimitKeyFor` + `RATE_LIMIT_POLICY.login` 5분 10회), upload `upload/route.ts:179`(env 기본값). **직접 IP를 읽는 코드 없음**(라우트 내 `x-forwarded-for` grep 0건). E2E T23(업로드 120회→429)·T26(로그인→429) 실측, `Retry-After` 헤더 실림 | **PASS** |
| 8 | 내부 정보 비노출 | `PathSafetyError` 사유는 서버 로그만(`upload/route.ts:264-267`) → 클라이언트는 `400 Invalid path.`. 500도 `Upload failed.`뿐(`:86-88`). 응답 경로는 `toSubpath()` 상대화(`:255`). E2E 전 응답에서 `/Users/`·스택·내부 메시지 0건. 서버 로그의 `[upload] path rejected` 5건은 의도된 서버 측 로깅 | **PASS** |

**런타임 선언**: `login/route.ts:21` · `logout/route.ts:20` · `upload/route.ts:47` 모두
`export const runtime = 'nodejs'` — **PASS**.

**스코프 드리프트**: `src/` + `package.json` 전체 grep — `basic-ftp`/FTP/카카오 0건.
라우트 파일 전수 열거 결과 무인증 신규 엔드포인트 없음 — **PASS**.

**인증 부가 확인**: 패스워드 비교는 scrypt + `timingSafeEqual`(`session.ts:83-88`, `login/route.ts:65`),
빈 입력도 KDF를 돌린 뒤 기각. 쿠키는 `HttpOnly; SameSite=lax; Max-Age=43200`(+프로덕션 Secure,
`session.ts:145-155`) — E2E T6 `Set-Cookie` 실측 일치. 로그아웃은 `Max-Age=0` 실측(T27).

## 3. backend-dev 자체 결정(계약 외) 검토

| 결정 | 판정 | 근거 |
|------|------|------|
| **D-1** 프록시 바디 상한 env 연동 (`next.config.ts:18-29`) | **합리적** | 논리 검토: 프록시 상한(`UPLOAD_MAX_BYTES`+4MiB) > 라우트 총량 상한(+1MiB, `upload/route.ts:64,188`)이므로 [+1MiB, +4MiB] 구간 요청이 잘리지 않고 라우트에 도달해 **413이 라우트에서 나온다**. +4MiB 초과 요청도 `content-length` 헤더는 프록시가 건드리지 않으므로 라우트 선검사(`:189-192`)가 413을 먼저 낸다. 옵션 인식은 dev 기동 로그 `Experiments … proxyClientMaxBodySize: 25165824`로 확인. E2E T15: **15MB 업로드 200 + SHA-256 원본 일치**(구 10MB 상한이면 불가능한 결과), T16: 25MB → 413. 단서 1건은 §5-4 |
| **D-2** 요청 총량 상한 = 파일 상한 + 1MiB | **합리적** | `formData()`가 바디 전체를 메모리에 올리므로 파싱 전 차단이 필요(OOM 방어). 미결 항목이던 "배치 총량이 파일 1개 상한과 같다"는 제약을 코드로 확인: `upload/route.ts:188` — 배치 합계가 `UPLOAD_MAX_BYTES`+1MiB를 넘으면 헤더만 보고 413. 현재 프론트는 1파일=1요청이라 실사용 영향 없음. 배치 시 413 메시지가 `File too large.`로 다소 애매한 점만 남는다(총량 초과인지 단일 파일 초과인지 구분 안 됨) — tech-lead 결정 대기 항목 유지 |
| **D-3** 배치 all-or-nothing | **합리적** | 선검증(`:222-240`) 완료 후에만 쓰기(`:242-`). E2E T17: 2건 중 1건 415 → **저장 0건** 실측. 부분 저장의 어중간한 상태보다 예측 가능. 부작용 없음 |
| **D-4** 이름 충돌 시 `note-1.md` 회피 (`open('wx')`) | **합리적** | `rename`의 무경고 덮어쓰기는 불변식 5의 취지 위반이 맞다. `'wx'`는 원자 연산이라 TOCTOU 없음(`:116`). 회피 후 이름도 `:161`에서 재검증. 응답이 실제 저장 이름을 실어 프론트 표시 불일치 없음(E2E T8). 부작용: 크래시가 선점(`:159`)과 rename(`:162`) 사이에 나면 0바이트 자리표시 파일이 남을 수 있으나(§5-5), 오류 경로는 정리됨(`:166-169`) — 수용 가능 |
| 파일 권한 `0600` | **합리적** | `:70,116,148`. 단일 사용자 개인 저장소 전제에 부합. E2E T31: `600` 실측. `next start` 실행 계정이 파일 소유자이므로 이후 단계(Stage 2 읽기·썸네일)에도 지장 없음 |

## 4. 실서버 E2E 실측 (curl 32종 요약)

전 항목 기대값 일치. 주요 결과만 기록한다.

| # | 시나리오 | 실측 |
|---|---|---|
| T1~T3 | `GET login` / 미인증 업로드 / 미인증 로그아웃 | 401 · 401 · 401 |
| T4~T5 | 오답·비JSON 로그인 (사유 미구분) | 둘 다 401 `Invalid password.` |
| T6 | 정상 로그인 | 200 + `HttpOnly; SameSite=lax; Max-Age=43200` |
| T7~T9 | 루트/충돌/폴더 업로드 | `note.md` → `note-1.md` → `2026-Travel/Jeju/note.md` |
| T10~T12 | `../../tmp` / `%2e%2e%2f` / `/etc` | 전부 400 `Invalid path.`, 루트 밖 유출 0건 |
| T13 | `filename=../../escaped.md` | 새니타이즈 후 루트에 `escaped.md` (탈출 없음) |
| T14 | `.exe` | 415 |
| T15 | **15MB** (구 프록시 상한 초과) | 200, SHA-256 원본 일치 |
| T16 | 25MB | 413 |
| T17~T18 | 배치 1건 오류 / 배치 정상 | 415+저장 0건 / 200+2건 |
| T19 | 파일명 `note 50%.md` | **400 `Invalid path.`** — §5-1 관찰 |
| T20~T22 | file 없음 / JSON 바디 / 교차 Origin | 400 · 400 · 400(CSRF) |
| T23 | 업로드 rate limit | 120회 창 소진 후 429 + `retry-after: 16` |
| T24 | 로그인 바디 9KB | 400 `Invalid request.` |
| T25 | 인증된 `GET /api/auth/login` | 405(빈 바디) — §5-3 관찰 |
| T26 | 로그인 rate limit | 10회 소진 후 429 + `retry-after: 120` |
| T27~T28 | 로그아웃 / 위조 쿠키 업로드 | `Max-Age=0` / 401 |
| T29 | 잔여 임시 파일 | 0건 |
| T31 | 저장 파일 권한 | `0600` |
| T32 | 심볼릭 링크 폴더로 업로드 | 400, 링크 대상 디렉터리에 파일 0건 |

부수 확인: XFF 헤더 변경으로 로그인 rate limit 키가 바뀌는 것을 실측 —
이는 `rate-limit.ts:123-129`에 문서화된 **기지의 한계 T-5**이며
security 검증에서 이미 수용된 항목이다(신규 FAIL 아님).

정리: 테스트 산출물 전량 삭제(`~/MarkdownDocs` 잔여 0건), 심볼릭 링크 제거,
dev 서버 종료(포트 3000 미응답 + `next` 프로세스 0건 확인).

## 5. FAIL 상세

**없음.** 아래는 비차단 관찰 사항이다 (PASS 판정에 영향 없음).

### 5-1. `%`를 포함한 정상 파일명이 400으로 거부된다 (P2 제안)

- **현상**: `note 50%.md` 업로드 → `400 Invalid path.` (E2E T19 실측)
- **원인**: `sanitizeFilename()`은 `%`를 통과시키지만, `upload/route.ts:236`이 정제된 이름을
  다시 `resolveUnderRoot()`에 넣고, 그 안의 `decodeAndScreen()`(`path-safety.ts:105-127`)이
  `decodeURIComponent('note 50%.md')` 실패로 `malformed percent-encoding`을 던진다
- **재현**: `curl -b cookies.txt -X POST $B/api/upload -F 'file=@a.md;filename=note 50%.md'`
- **평가**: 오탐 방향이 **안전 쪽**(거부)이고 탈출은 없다. 인코딩 방어 자체는 정상 동작
  (이중 인코딩 `%252e%252e` 계열은 올바르게 차단됨). 다만 "진행률 50%.md" 같은 실사용 이름이
  Stage 2 에디터 저장에서도 같은 경로를 타면 동일하게 거부될 것이므로 정책 결정이 필요하다
- **관련**: 보안 불변식 2·3 (위반 아님)

### 5-2. 500의 계약 지위 — 코드 주석과 문서가 서로 어긋난다 (기록만)

`src/types/api.ts:49`에 500이 **이미 계약 코드로 명시**돼 있다. 따라서 D-6의 미결 질문
("`ApiErrorCode`에 500을 넣을지")은 타입상 이미 해소된 상태이고, 틀린 것은
`upload/route.ts:80-81`의 주석("유니온에는 5xx가 없다")과 CLAUDE.md 상태코드 목록(500 누락)이다.
동작은 계약 적합 — tech-lead가 D-6 정리 시 주석·CLAUDE.md만 맞추면 된다.

### 5-3. 인증된 `GET /api/auth/login` → 405 빈 바디 (기록만)

미들웨어는 통과시키고(세션 유효) 라우트에 GET 핸들러가 없어 Next 기본 405가 나간다(E2E T25).
405는 `ApiErrorCode` 밖이지만 내부 정보 노출이 없고, 정의되지 않은 메서드에 대한
프레임워크 기본 응답이므로 계약 위반으로 보지 않는다.

### 5-4. `proxyClientMaxBodySize` env 연동은 코드 검토로 확인 (기록만)

현재 env(`UPLOAD_MAX_BYTES=20MiB`)에서는 연동값(20+4=24MiB)과 env 부재 시 폴백(24MiB,
`next.config.ts:19`)이 **우연히 같아** E2E만으로는 연동 여부를 구분할 수 없다.
`next.config.ts:21-25` 코드 검토로 연동 로직이 올바름을 확인했다(양의 정수 검증 포함).
`UPLOAD_MAX_BYTES` 변경 시 자동 추종된다 — 미결 항목 4(security-auth 리뷰)는 유지.
부가: `content-length` 없는 chunked 요청은 라우트 선검사(`upload/route.ts:189`)를 지나치지만
프록시 상한이 메모리를 24MiB로 묶고, 잘린 바디는 `formData()` 실패로 400이 된다 — OOM 없음.

### 5-5. 크래시 시 0바이트 자리표시 파일 가능성 (기록만)

`reserveDestination()` 선점(`upload/route.ts:159`)과 `rename`(`:162`) 사이에 프로세스가 죽으면
0바이트 파일이 목적지에 남는다. **오류** 경로는 `:166-169`가 정리하며(E2E T29 잔여 0건),
문제는 kill -9 급 크래시뿐이다. D-4/D-5에 문서화된 트레이드오프로 수용 가능.

## 6. backlog 제안 (직접 수정하지 않음)

FAIL이 아니므로 P0 항목은 없다. `docs/plan/backlog.md`에 다음 **P2** 추가를 제안한다:

> | # | 항목 | 출처 리포트 | 담당 | 비고 |
> |---|------|-------------|------|------|
> | P2 | `%` 포함 파일명 업로드가 400으로 거부됨 — `sanitizeFilename()` 통과 후 경로 재검증에서 `decodeURIComponent` 실패. 허용하려면 경로 조립 시 파일명 세그먼트를 인코딩 검사에서 제외하거나 새니타이즈 단계에서 `%`를 치환하는 정책 결정 필요 (Stage 2 에디터 저장에도 동일 경로 예상) | backend-stage-1-validation.md §5-1 | tech-lead 정책 결정 → backend-dev | 보안상 안전 방향의 오탐. 차단 아님 |
> | P2 | 500 상태코드 문서 정합 — `src/types/api.ts:49`에는 있으나 CLAUDE.md 상태코드 목록과 `upload/route.ts:80` 주석이 어긋남 (D-6 정리 겸) | backend-stage-1-validation.md §5-2 | tech-lead | 동작은 계약 적합 |
