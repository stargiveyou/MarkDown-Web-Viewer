# 보안 검증 리포트 — Stage 1

- 작성: `security-auth` / 2026-07-23
- 대상: Stage 1 (인증 + 웹 업로드) 중 **security-auth 담당분**
- 판정: **PASS** (담당 범위 내 FAIL 0건) — 단, 불변식 3·4는 Wave 2 `backend-dev` 미착수로 **N/A(대기)**
- 재현 환경: Node 22.23.1 / Next 16.2.11 / Vitest 4.1.10 / macOS

---

## 1. 게이트 실행 결과

| 명령 | 결과 |
|------|------|
| `npm run typecheck` | **PASS** — 오류 0 |
| `npm test` | **PASS** — 4 파일 / **80 테스트** 통과 |
| `npm run lint` | **PASS** — 오류 0, 경고 0 |
| `npm run build` | **PASS** — 컴파일 성공, NFT 경고 해소됨 |

> `npm run build`는 경고 1건(`"middleware" 파일 컨벤션 deprecated → "proxy" 권장`)을 남긴다.
> 동작에는 영향이 없다. 파일명 변경은 계획 문서의 산출물명을 바꾸는 일이라
> `tech-lead` 판단으로 남겼다 ([security-stage-1-decisions.md](../agent-work/security-stage-1-decisions.md) D-5).

### 테스트 구성

| 파일 | 테스트 수 | 다루는 불변식 |
|------|-----------|----------------|
| `src/lib/path-safety.test.ts` | 53 | 2, 3(파일명), 8 |
| `src/lib/session.test.ts` | 15 | 1 |
| `src/lib/rate-limit.test.ts` | 10 | 7 |
| `src/test/setup.test.ts` | 2 | (환경 스모크) |

---

## 2. 보안 불변식 → 강제 지점 매핑

CLAUDE.md "보안 불변식" 8개가 **어디서** 강제되는지의 파일:라인 매핑이다.

### 불변식 1 — 모든 페이지·API가 세션 보호 · 401 → `/login` — **PASS**

| 강제 지점 | 위치 |
|---|---|
| 전 경로 가로채기 (정적 자산만 제외) | `src/middleware.ts:148-152` (`config.matcher`) |
| 무인증 예외 정의 — **`/login`과 `POST /api/auth/login` 뿐** | `src/middleware.ts:30`, `:33-36`, `:91` |
| 메서드까지 일치해야 예외 적용 | `src/middleware.ts:57-61` (`isPublicApi`) |
| 세션 검증 호출 | `src/middleware.ts:103-104` |
| API 미인증 → 401 `ApiError` JSON | `src/middleware.ts:107-108` + `:52-55` |
| 페이지 미인증 → `/login?next=` 리다이렉트 | `src/middleware.ts:110-118` |
| 만료 쿠키 정리 | `src/middleware.ts:120-122` |
| 쿠키 서명·만료 검증 (timing-safe) | `src/lib/session.ts:112-142` |
| 패스워드 timing-safe 비교 | `src/lib/password-hash.ts:158-178` → `src/lib/session.ts:83-89` |
| 미들웨어 Node 런타임 고정 | `src/middleware.ts:27` |

**증거(실서버 curl, `npm start`):**

| # | 요청 | 기대 | 실측 |
|---|------|------|------|
| 1 | `GET /` | 307 → `/login?next=%2F` | ✅ |
| 2 | `GET /workspace` | 307 → `/login?next=%2Fworkspace` | ✅ |
| 3 | `GET /login` | 200 | ✅ |
| 4 | `GET /api/files` | 401 `{"code":401,"message":"Authentication required."}` | ✅ |
| 5 | `POST /api/auth/login` | 미들웨어 통과 (404 = 라우트 미구현) | ✅ |
| 6 | `GET /api/auth/login` | **401** (메서드 불일치 → 보호 대상) | ✅ |
| 7 | 유효 쿠키 + `GET /workspace` | 200 | ✅ |
| 8 | 유효 쿠키 + `GET /api/files` | 404 (통과) | ✅ |
| 9 | 서명 위조 쿠키 | 401 | ✅ |
| 10 | 만료 쿠키 | 401 + `Set-Cookie` 삭제 | ✅ |

### 불변식 2 — 모든 `path` 파라미터가 단일 유틸 경유 — **PASS**

| 방어 | 위치 |
|---|---|
| **단일 구현** (다른 곳에 경로 조립 없음) | `src/lib/path-safety.ts` 전체 |
| 제어문자·NUL 거부 | `:54`, `:79-81` |
| 백슬래시 거부 | `:83-85` |
| 절대 경로 거부 | `:86-88` |
| 드라이브 문자 거부 | `:89-92` |
| `..` 세그먼트 거부 | `:93-95` |
| `normalize` 후 상위 탈출 거부 | `:96-98` |
| **다단계 퍼센트 디코딩 + 매 단계 검사** | `:105-127` |
| 최종 `path.resolve` 후 루트 포함 검사 | `:155-160` |
| **realpath(심볼릭 링크) 검사** | `:174-226` |
| 존재하지 않는 경로도 조상까지 거슬러 검사 | `:199-225` |
| 루트 표기 정규화 단일 지점 | `:63-65` (`getRoot`) |
| 접두사 비교 단일 지점 | `:68-72` (`isInside`) |

**유닛 테스트 (CLAUDE.md 요구 4종 전부 + 정상 케이스):**

| 공격 유형 | 테스트 위치 | 케이스 수 |
|---|---|---|
| `../` 상위 탈출 (중첩 포함) | `path-safety.test.ts:84-107` | 11 |
| 절대 경로 주입 | `:113-135` | 8 |
| 인코딩 traversal (`%2e%2e%2f`, `..%2f`, 이중 인코딩, `%00`, 깨진 인코딩) | `:137-164` | 11 |
| **심볼릭 링크 탈출 (실제 링크 생성)** | `:166-205` | 6 |
| 정상 경로 통과 | `:207-241` | 5 |
| `toSubpath` 역노출 방지 | `:243-265` | 4 |
| `sanitizeFilename` | `:267-끝` | 8 |

심볼릭 링크 테스트는 **모킹이 아니라 실제 `fs.symlink()`**로 3종을 만들어 검증한다:
루트 밖 파일 링크 / 루트 밖 디렉터리 링크 / 루트 안 정상 링크(허용돼야 함).
`os.tmpdir()`를 쓰므로 macOS에서 `/tmp → /private/tmp`인 상황,
즉 **루트 자체가 심볼릭 링크인 경우**까지 자연히 커버된다.

### 불변식 3 — 업로드 검증 — **부분 PASS / 나머지 대기**

| 항목 | 상태 | 위치 |
|---|---|---|
| 파일명 새니타이즈 | **PASS** | `src/lib/path-safety.ts:256-307` |
| 크기 상한(413) 정책값 제공 | **PASS** | `src/lib/env.ts:132` (`UPLOAD_MAX_BYTES`) |
| 확장자 화이트리스트(415) 정책값 제공 | **PASS** | `src/lib/env.ts:134-144` (`ALLOWED_EXTENSIONS`) |
| 413/415 **실제 반환** | ⏳ **N/A — Wave 2 `backend-dev`** | `src/app/api/upload/route.ts` (미생성) |

`sanitizeFilename`이 막는 것: 경로 성분(`../../etc/passwd` → `passwd`),
인코딩된 구분자, 제어문자, 선행 점(`.env` → `env`, 숨김파일·`..` 차단),
위험 문자(`<>:"|?*` → `_`), 후행 점·공백, 255바이트 초과(확장자 보존 절단).
정제 결과가 비면 `PathSafetyError`를 던진다(조용히 임의 이름을 만들지 않는다).

### 불변식 4 — Atomic write — ⏳ **N/A — Wave 2 `backend-dev`**

security-auth 담당 범위 밖이다. 요구사항은
[완료 기록](../complete-work/stage-1-security-complete.md)의 인수인계 절에 명시했다.

### 불변식 5 — 편집 충돌 409 — ⏳ **N/A — Stage 2**

### 불변식 6 — 시크릿이 `.env.local` 전용, 클라이언트 번들 금지 — **PASS**

| 강제 지점 | 위치 |
|---|---|
| `import 'server-only'` 가드 | `env.ts:11`, `session.ts:25`, `path-safety.ts:22`, `rate-limit.ts:16` |
| `NEXT_PUBLIC_` 접두사 미사용 | 전 파일 (grep 0건) |
| `.env.local` gitignore | `.gitignore:3` (`git check-ignore` 확인 완료) |
| 에러 메시지에 값 미포함 (키 이름·사유만) | `src/lib/env.ts:31-40` |

**증거 — 프로덕션 빌드 산출물 grep:**

| 검사 | 결과 |
|---|---|
| `SESSION_SECRET` 값이 `.next/static`에 | **0건** |
| `SESSION_PASSWORD` 해시가 `.next/static`에 | **0건** |
| `MARKDOWN_ROOT` 경로가 `.next/static`에 | **0건** |
| 문자열 `scrypt`가 `.next/static`에 | **0건** |
| `SESSION_SECRET` 값이 `.next/server`에 | **0건** (런타임 `process.env` 조회 — 인라인조차 되지 않음) |

### 불변식 7 — rate limit — **PASS (라이브러리 완성 / 라우트 배선은 Wave 2)**

| 항목 | 위치 |
|---|---|
| 인메모리 카운터 | `src/lib/rate-limit.ts:43` |
| 윈도 계산·차단·`Retry-After` | `:86-117` |
| **세션 키 우선 / IP 폴백** | `:133-141` (`rateLimitKeyFor`) |
| scope 분리(라우트 간 예산 비공유) | `:133-141` |
| 라우트별 정책 | `:53-61` (`RATE_LIMIT_POLICY`) |
| **메모리 DoS 방어** (버킷 상한 + 만료·LRU 축출) | `:37-43`, `:65-77` |
| `X-Forwarded-For` 위조 경고 (코드 주석) | `:37-40`, `:119-131`, `:145-147` |
| `X-Forwarded-For` 위조 경고 (문서) | 본 문서 T-5 |

### 불변식 8 — 내부 오류·스택트레이스 미노출 — **PASS**

| 강제 지점 | 위치 |
|---|---|
| `ApiError`는 `{code, message}`만 | `src/middleware.ts:52-55` |
| 미들웨어 응답 문구가 고정 상수 (예외 메시지 전달 없음) | `:97`, `:108`, `:129-131` |
| 절대 경로 → 상대 경로 역변환 강제 | `src/lib/path-safety.ts:234-253` (`toSubpath`) |
| `PathSafetyError` 메시지에 입력 경로 미포함 | `src/lib/path-safety.ts:30-35` |
| env 오류 메시지에 값 미포함 | `src/lib/env.ts:31-40` |

**증거:** 미인증 401 응답 본문은 정확히 `{"code":401,"message":"Authentication required."}`로,
경로·스택·서버 정보가 없다. 15개 curl 시나리오 동안 서버 로그 에러 **0건**.

---

## 3. 위협 모델

**신뢰 경계**: 공개 인터넷 → ngrok 엣지(TLS + Basic Auth) → `next start` :3000 → 로컬 디스크.
인바운드 라우터 포트는 닫혀 있고 아웃바운드 443만 사용한다.
**공격자 = 앱 URL을 아는 임의의 인터넷 사용자.**

### 막는 것

| # | 위협 | 방어 | 결과 |
|---|------|------|------|
| T-1 | 로그인 없이 파일 열람·업로드 | 미들웨어 전 경로 보호. 예외는 `/login`과 `POST /api/auth/login` 둘뿐 | 401 / `/login` 리다이렉트 |
| T-2 | 경로 조작으로 `MARKDOWN_ROOT` 밖 파일 읽기·쓰기 | `resolveUnderRoot` + `assertRealPathUnderRoot` 2단 방어 | 400 |
| T-3 | 심볼릭 링크를 심어 루트 밖으로 탈출 | realpath 검사. 미존재 경로도 조상까지 추적 | 400 |
| T-4 | 쿠키 위조로 세션 획득 | HMAC-SHA256 서명 + `timingSafeEqual` + 만료 + TTL 상한 | 401 |
| T-6 | 패스워드 무차별 대입 | scrypt(N=2^15) + 로그인 10회/5분 제한 + ngrok Basic Auth 선행 | 429 |
| T-7 | 타이밍 공격으로 패스워드 추측 | 조기 반환 없음. 길이 초과 입력도 KDF를 끝까지 돌린 뒤 기각 | 정보 없음 |
| T-8 | 업로드로 임의 위치에 파일 심기 | `sanitizeFilename` + `resolveUnderRoot` + realpath | 400 |
| T-9 | 숨김 파일·설정 파일 덮어쓰기(`.env` 등) | 선행 점 제거 | 무해한 이름으로 정제 |
| T-10 | CSRF로 로그인된 사용자의 업로드 유발 | `SameSite=Lax` + Origin 확인 | 400 |
| T-11 | 클릭재킹 | `X-Frame-Options: DENY` | 프레임 차단 |
| T-12 | MIME 스니핑 | `X-Content-Type-Options: nosniff` | 차단 |
| T-13 | Referrer로 내부 경로 유출 | `Referrer-Policy: same-origin` | 외부로 미전송 |
| T-14 | 응답으로 서버 디렉터리 구조 파악 | `toSubpath` 강제 + 고정 에러 문구 | 정보 없음 |
| T-15 | 클라이언트 번들에서 시크릿 추출 | `server-only` 가드 + `NEXT_PUBLIC_` 미사용 | 번들 grep 0건 |
| T-16 | 시크릿 미설정 상태로 조용히 기동 | `getServerEnv()`가 부팅 시 throw | 기동 실패 |
| T-17 | 긴 경로/깊은 인코딩/거대 헤더로 CPU·메모리 소모 | 경로 4096자, 디코딩 5회, 토큰 512자, IP 키 64자, 버킷 10,000개 상한 | 조기 거부 |

### 막지 못하는 것 (알려진 한계 — 수용됨)

| # | 한계 | 왜 | 완화 |
|---|------|-----|------|
| **T-5** | **`X-Forwarded-For` 위조로 IP rate limit 우회** | 앱이 ngrok 터널 뒤에 있어 소켓 주소가 항상 127.0.0.1이다. IP는 헤더에서 읽을 수밖에 없고, 그 헤더는 원격 클라이언트가 임의로 채울 수 있다 | ① 로그인 후에는 **세션 키가 우선**이라 무의미 ② 무인증 경로는 `POST /api/auth/login` 하나뿐 ③ 그 앞에 ngrok Basic Auth가 있다 ④ 그래서 패스워드 강도 자체가 실질 방어선 |
| T-18 | 세션 토큰 개별 무효화 불가 | 서버 세션 저장소 없는 stateless 설계 | `SESSION_SECRET` 교체 = 전면 강제 로그아웃 |
| T-19 | `SESSION_SECRET` 유출 시 임의 세션 위조 | HMAC의 본질 | `.env.local` 전용 + gitignore. 유출 의심 시 즉시 교체 |
| T-20 | 단일 패스워드라 사용자 구분·감사 추적 없음 | ADR-005의 의도된 범위 | 단일 사용자 워크스페이스 전제 |
| T-21 | 프로세스 재시작 시 rate limit 카운터 초기화 | 인메모리 | 단일 상주 프로세스 전제 (ADR) |
| T-22 | 업로드 파일 내용 자체의 악성 여부(악성 SVG 등) | 확장자 화이트리스트는 형식만 본다 | Stage 2 렌더 시 sanitize 필요 → **백로그 제안** |
| T-23 | 맥미니 물리 접근·OS 계정 탈취 | 앱 범위 밖 | — |

> **T-22 후속 제안**: `ALLOWED_EXTENSIONS` 기본값에 `svg`가 있다. SVG는 스크립트를 품을 수 있어
> 뷰어에서 그대로 렌더하면 저장형 XSS가 된다. Stage 2 뷰어 구현 시
> ① SVG를 `<img>`로만 렌더하거나 ② 화이트리스트에서 제외하거나 ③ sanitize가 필요하다.
> Stage 1은 뷰어가 없어 노출되지 않으므로 이번 단계의 FAIL은 아니다.

---

## 4. 재현 절차

```bash
# 1. 정적 게이트
npm run typecheck && npm test && npm run lint && npm run build

# 2. traversal 테스트만
npx vitest run src/lib/path-safety.test.ts

# 3. 런타임 인증 확인
npm start &
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:3000/      # 307 /login?next=%2F
curl -s http://127.0.0.1:3000/api/files                                              # {"code":401,...}
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/auth/login # 404 (통과, 라우트는 Wave 2)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/auth/login         # 401 (GET은 보호)

# 4. 클라이언트 번들 시크릿 유출 검사 (전부 0이어야 한다)
grep -rl "$(grep '^SESSION_SECRET=' .env.local | cut -d= -f2)" .next/static | wc -l
grep -rl 'scrypt' .next/static | wc -l
```

---

## 5. 판정

| 불변식 | 판정 |
|---|---|
| 1. 전 페이지·API 세션 보호 | **PASS** |
| 2. 경로 안전 단일 유틸 + 4종 유닛 테스트 | **PASS** |
| 3. 업로드 검증 | 파일명 새니타이즈 **PASS** / 413·415 강제는 **N/A(Wave 2)** |
| 4. Atomic write | **N/A(Wave 2)** |
| 5. 편집 충돌 409 | **N/A(Stage 2)** |
| 6. 시크릿 격리 | **PASS** |
| 7. Rate limit | **PASS**(라이브러리) / 라우트 배선 **N/A(Wave 2)** |
| 8. 내부 오류 미노출 | **PASS** |

**security-auth 담당 범위 FAIL 0건 → Stage 1 Wave 1-A 완료 조건 충족.**
Stage 1 전체 완료 판정은 Wave 2·3 이후 `qa-integration`이 내린다.
