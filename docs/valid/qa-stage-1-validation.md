# QA 통합 검증 -- Stage 1 (인증 + 업로드)

- 검증 일시: 2026-07-24
- 검증자: `qa-integration` (model: opus)
- 대상 범위: Stage 1 전체 -- 인증(login/logout), 업로드(multipart -> 로컬 저장), 보안 기반(middleware/session/path-safety/rate-limit/env)
- 선행 검증 참조:
  - [security-stage-1-validation.md](security-stage-1-validation.md) -- PASS (FAIL 0건)
  - [backend-stage-1-validation.md](backend-stage-1-validation.md) -- PASS (FAIL 0건)
  - [frontend-stage-1-validation.md](frontend-stage-1-validation.md) -- 원래 FAIL 2건 (F1 UploadModal targetPath, F2 문서 드리프트). 수정 완료 확인
- 검증 방법: 정적 게이트(typecheck/test/lint/build) + 전 파일 코드 리뷰 + 실서버 curl E2E 스모크 + 번들 시크릿 스캔
- **종합 판정: PASS (FAIL 0건, UNVERIFIED 2건)**

---

## 1. 정적 게이트

| 항목 | 결과 | 비고 |
|------|------|------|
| `npm run typecheck` | PASS | 에러 0건 |
| `npm test` (Vitest) | PASS | 6 파일, **106 테스트** 전부 통과 (2.99s) |
| `npm run lint` (ESLint) | PASS | 에러 0건, 경고 0건 |
| `npm run build` (프로덕션) | PASS | 빌드 경고 1건(NFT tracing -- backlog P2-6 문서화됨), 중단점 없음 |

빌드 산출물 라우트:
```
Route (app)
  /              (Static) -- redirect to /workspace
  /_not-found    (Static)
  /api/auth/login   (Dynamic)
  /api/auth/logout  (Dynamic)
  /api/upload       (Dynamic)
  /login            (Static)
  /workspace        (Static)
```

---

## 2. 보안 불변식 검증

### 불변식 1: 전 라우트 세션 보호

| # | 검증 | 판정 | 근거 |
|---|------|------|------|
| 1-1 | POST /api/auth/login만 무인증 허용 | PASS | `src/middleware.ts:33-35` -- PUBLIC_API 배열에 POST 메서드+경로만 등록. GET /api/auth/login은 401 반환 확인 (curl) |
| 1-2 | 미인증 페이지 -> /login 리다이렉트 | PASS | curl: `GET /workspace` -> `307 /login?next=%2Fworkspace`, `GET /` -> `307 /login?next=%2F` |
| 1-3 | 미인증 API -> 401 JSON | PASS | curl: `POST /api/upload` -> `{"code":401,"message":"Authentication required."}`, `POST /api/auth/logout` -> 동일 |
| 1-4 | /login 페이지 무인증 접근 | PASS | curl: `GET /login` -> 200 |
| 1-5 | 위조 쿠키 거부 | PASS | `Cookie: mdws_session=forged.invalid.cookie.value.here` -> 401 |
| 1-6 | 세션 쿠키 속성 | PASS | `Set-Cookie: mdws_session=v1...; Path=/; Max-Age=43200; HttpOnly; SameSite=lax`. dev에서 Secure 없음, production에서 Secure 있음 (`src/lib/session.ts:151`) |
| 1-7 | 로그아웃 쿠키 제거 | PASS | `POST /api/auth/logout` -> `Set-Cookie: mdws_session=; Path=/; Max-Age=0; HttpOnly; SameSite=lax` |
| 1-8 | CSRF 방어 | PASS | `src/middleware.ts:71-84` -- Origin 헤더가 Host와 불일치 시 거부 + SameSite=Lax 1차 방어 |
| 1-9 | 오픈 리다이렉트 방어 | PASS | `src/app/login/page.tsx:20-26` -- `//`, `/\`, 비-`/` 시작, `/login` 자기 참조 전부 차단 |
| 1-10 | 보안 헤더 | PASS | 모든 응답에 `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` (curl 확인) |

### 불변식 2: 경로 안전 단일 유틸

| # | 검증 | 판정 | 근거 |
|---|------|------|------|
| 2-1 | `resolveUnderRoot` + `assertRealPathUnderRoot` 사용 | PASS | upload route: `src/app/api/upload/route.ts:201-202` (targetDir), `:219-220` (destination), `:228` (mkdir 후 재검증), `:144` (충돌 해소 후). 모든 경로 접근이 유틸을 경유 |
| 2-2 | `../` 거부 | PASS | curl: `targetPath=../../tmp` -> `{"code":400,"message":"Invalid path."}` |
| 2-3 | 인코딩 우회 거부 | PASS | curl: `targetPath=%2e%2e%2ftmp` -> `{"code":400,"message":"Invalid path."}` |
| 2-4 | 절대경로 거부 | PASS | curl: `targetPath=/etc` -> `{"code":400,"message":"Invalid path."}` |
| 2-5 | 유닛 테스트 커버리지 | PASS | `src/lib/path-safety.test.ts` -- 53건 전부 통과 (심볼릭 링크, 인코딩 다중, 제어문자 포함) |

### 불변식 3: 업로드 검증

| # | 검증 | 판정 | 근거 |
|---|------|------|------|
| 3-1 | 크기 상한(413) | PASS | `src/app/api/upload/route.ts:207-209` -- `file.size > env.UPLOAD_MAX_BYTES` -> 413. 헤더 선검사 `:173` |
| 3-2 | 확장자 화이트리스트(415) | PASS | curl: `.exe` 파일 -> `{"code":415,"message":"Unsupported file type."}`. 코드: `:214` |
| 3-3 | 파일명 새니타이즈 | PASS | `src/lib/path-safety.ts:256-307` -- 제어문자/셸 메타/선행 점/길이 상한. 유닛 테스트 완비 |

### 불변식 4: Atomic write

| # | 검증 | 판정 | 근거 |
|---|------|------|------|
| 4-1 | 임시파일 -> fsync -> rename | PASS | `src/app/api/upload/route.ts:128-155` -- `.mdws-upload-<random>.tmp` -> `fsync` -> `rename`. 실패 시 잔여물 정리 `:149-152` |
| 4-2 | 이름 충돌 비파괴 | PASS | curl: 같은 파일 재업로드 -> `qa-test-1.md` (덮어쓰기 없이 `-1` 접미). `reserveDestination` `:90-112` 사용 `open('wx')` 원자 선점 |

### 불변식 5: 편집 충돌 (Stage 1 범위 밖)

UNVERIFIED -- `PUT /api/file-content`는 Stage 2에서 구현 예정. 계약(`src/types/api.ts:113-131`)은 `baseMtime` 기반 409를 정의하고 있으며, `fetcher.ts`는 이미 409를 `ApiRequestError`로 올린다.

### 불변식 6: 시크릿 클라이언트 미노출

| # | 검증 | 판정 | 근거 |
|---|------|------|------|
| 6-1 | `NEXT_PUBLIC_` 접두사 부재 | PASS | `.env.local` grep: 0건 |
| 6-2 | 클라이언트 번들 시크릿 스캔 | PASS | `.next/static/**` 전수 grep: `SESSION_SECRET`, `SESSION_PASSWORD`, `MARKDOWN_ROOT`, `scrypt`, `e2aded888d35be60`, `MarkdownDocs` 전부 0건 |
| 6-3 | `server-only` import | PASS | `env.ts`, `session.ts`, `path-safety.ts`, `rate-limit.ts`, `api-response.ts`, `file-utils.ts` 전부 `import 'server-only'` 선언. `password-hash.ts`는 CLI 공유를 위해 의도적 미선언(문서화됨) |

### 불변식 7: Rate limit

| # | 검증 | 판정 | 근거 |
|---|------|------|------|
| 7-1 | 로그인 rate limit | PASS | `src/app/api/auth/login/route.ts:36` -- `RATE_LIMIT_POLICY.login` (10회/5분) |
| 7-2 | 업로드 rate limit | PASS | `src/app/api/upload/route.ts:162` -- env 기본값 (120회/60초) |
| 7-3 | 세션 키 우선 | PASS | `src/lib/rate-limit.ts:134` -- `sessionIdentifier`(nonce) 우선, 없으면 IP 폴백 |
| 7-4 | Retry-After 헤더 | PASS | `login/route.ts:39`, `upload/route.ts:165` -- 429 응답에 `Retry-After` 헤더 포함 |

### 불변식 8: 내부 정보 비노출

| # | 검증 | 판정 | 근거 |
|---|------|------|------|
| 8-1 | 에러 응답 내부경로 비포함 | PASS | curl: traversal 시도 -> `"Invalid path."` (절대경로/스택트레이스 없음). `apiError`/`internalError` 헬퍼가 일관 적용 |
| 8-2 | 서버 에러 로깅만 | PASS | `src/lib/api-response.ts:28` -- `console.error`로 서버 로깅, 클라이언트에는 `"Internal server error."` |
| 8-3 | PathSafetyError 처리 | PASS | `src/app/api/upload/route.ts:248-250` -- `error.message`를 서버 로깅만, 응답은 `"Invalid path."` |

---

## 3. API 계약 일치 (통합 관점)

| # | 검증 | 판정 | 근거 |
|---|------|------|------|
| 3-1 | POST /api/auth/login 요청/응답 | PASS | 프론트: `LoginRequest` JSON (`src/app/login/page.tsx:65-68`). 백엔드: `request.json()` -> `LoginResponse` (`src/app/api/auth/login/route.ts:53-54,67`). 형태 일치 |
| 3-2 | POST /api/auth/logout | PASS | 프론트: 바디 없음 (`workspace/page.tsx:35`). 백엔드: 파라미터 없음 (`logout/route.ts:22`). `{ ok: true }` 반환. `LogoutResponse` 타입이 `api.ts`에 정의 안 됨 (참고사항, 비차단) |
| 3-3 | POST /api/upload FormData 필드명 | PASS | 양측 `UPLOAD_FIELD.file`/`UPLOAD_FIELD.targetPath` 상수 사용 (grep 확인). 문자열 리터럴 직접 사용 0건 |
| 3-4 | POST /api/upload targetPath 생략/포함 | PASS | 프론트: 빈 문자열이면 필드 미전송 (`UploadDropzone.tsx:109`). 백엔드: 미존재시 `''` -> 루트 해석 (`upload/route.ts:193-194`). 양측 일치 |
| 3-5 | UploadResponse 형태 | PASS | 양측 동일 타입 참조 (`@/types/api`). curl 확인: `{"ok":true,"files":[{"name":"...","subpath":"...","size":67,"mtime":...}],"notified":false}` |
| 3-6 | 에러 응답 형태 일관성 | PASS | 모든 에러가 `{ code, message }` (`ApiError` 타입). 프론트 `fetcher.ts`가 코드로 분기, 서버 메시지는 보조 참고만 |
| 3-7 | 상태코드 집합 일치 | PASS | 프론트 `CONTRACT_CODES = {400,401,409,413,415,429,500,502}` (`fetcher.ts:35`). 백엔드 `ApiErrorCode` 동일 집합 (`api.ts:42-50`). 500은 계약 문서 갱신 완료 (`frontend-stage-1-client-contract.md:59,67-71`) |
| 3-8 | 500 vs 502 구분 전달 | PASS | 백엔드: 디스크 에러 -> 500 (`api-response.ts:29`), webhook 실패 -> 502 (Stage 5 구현 예정). 프론트: 500을 그대로 통과 (`fetcher.ts:55`), `upload-errors.ts`에 500/502 별도 문구 |

---

## 4. E2E 스모크 테스트 결과 (curl, dev 모드)

| # | 시나리오 | 기대 | 실제 | 판정 |
|---|---------|------|------|------|
| T1 | 미인증 GET /workspace | 307 -> /login?next=%2Fworkspace | 307 -> /login?next=%2Fworkspace | PASS |
| T2 | 미인증 GET / | 307 -> /login?next=%2F | 307 -> /login?next=%2F | PASS |
| T3 | GET /login (공개) | 200 | 200 | PASS |
| T4 | 미인증 POST /api/upload | 401 | 401 `Authentication required.` | PASS |
| T5 | 미인증 POST /api/auth/logout | 401 | 401 `Authentication required.` | PASS |
| T6 | GET /api/auth/login (잘못된 메서드) | 401 | 401 `Authentication required.` | PASS |
| T7 | POST /api/auth/login 오답 | 401 | 401 `Invalid password.` | PASS |
| T8 | POST /api/auth/login 비JSON 바디 | 401 (오답과 구분불가) | 401 `Invalid password.` | PASS |
| T9 | POST /api/auth/login 정답 | 200 + Set-Cookie | 200 + `{"ok":true}` + httpOnly 쿠키 | PASS |
| T10 | 인증 후 GET /workspace | 200 | 200 | PASS |
| T11 | 인증 후 업로드 (루트) | 200 + UploadResponse | `{"ok":true,"files":[{"name":"qa-test.md","subpath":"qa-test.md",...}],"notified":false}` | PASS |
| T12 | 업로드 (하위 폴더) | 200 + subpath에 폴더 포함 | `subpath:"qa-test-folder/sub-test.md"` | PASS |
| T13 | 경로 traversal `../../tmp` | 400 | `{"code":400,"message":"Invalid path."}` | PASS |
| T14 | 인코딩 traversal `%2e%2e%2f` | 400 | `{"code":400,"message":"Invalid path."}` | PASS |
| T15 | 절대경로 `/etc` | 400 | `{"code":400,"message":"Invalid path."}` | PASS |
| T16 | 허용 외 확장자 `.exe` | 415 | `{"code":415,"message":"Unsupported file type."}` | PASS |
| T17 | 이름 충돌 (중복 업로드) | 200 + 접미사 붙은 이름 | `name:"qa-test-1.md"` | PASS |
| T18 | 미인증 업로드 | 401 | 401 `Authentication required.` | PASS |
| T19 | 파일 필드 누락 | 400 | `{"code":400,"message":"No file provided."}` | PASS |
| T20 | 로그아웃 | 200 + 쿠키 만료 | `{"ok":true}` + `Max-Age=0` | PASS |
| T22 | 위조 쿠키 | 401 | 401 `Authentication required.` | PASS |
| T23 | 보안 헤더 확인 | X-Content-Type-Options 등 | nosniff + DENY + same-origin 모두 존재 | PASS |

---

## 5. 접근성 (코드 리뷰)

| # | 검증 | 판정 | 근거 |
|---|------|------|------|
| A-1 | 키보드 내비게이션 | PASS | 로그인 form onSubmit (Enter 제출), 업로드 드롭존은 `<button>` (Tab/Enter 가능), 모달 Esc 닫기 + 포커스 트랩 |
| A-2 | 포커스 상태 | PASS | 전 인터랙티브 요소에 `focus-visible` 링 스타일 |
| A-3 | 모달 Esc/Enter | PASS | `src/components/ui/Modal.tsx:57-62` Esc 닫기, `:63-79` Tab 포커스 트랩, `:41-51` 포커스 이동/복원 |
| A-4 | 스크린 리더 | PASS | `aria-live="polite"` (토스트, 업로드 진행), `role="dialog"` + `aria-modal="true"` (모달), `role="alert"` (에러), `aria-invalid` (로그인 입력) |
| A-5 | 반응형 | PASS | 모달: 모바일 바텀시트 + 데스크톱 중앙 (`Modal.tsx:88,101`). 컨테이너 `max-w-5xl`. 2열/4열 그리드는 Stage 2 |

---

## 6. 프론트 검증 FAIL 항목 해소 확인

| FAIL | 내용 | 확인 | 판정 |
|------|------|------|------|
| F1 | UploadModal targetPath 정규화가 onChange마다 적용 | `target-path.ts` 분리, onChange는 원문 보관, onBlur와 전송 직전에만 `normalizeTargetPath` 적용 (`UploadModal.tsx:46`, `UploadDropzone.tsx:74`). 유닛 테스트 4건 추가 (`target-path.test.ts`) | **PASS (해소됨)** |
| F2 | frontend-stage-1-client-contract.md 500 문서 드리프트 | `frontend-stage-1-client-contract.md:59` 표에 500 포함, `:67-71`에 갱신 이력 추가 | **PASS (해소됨)** |

---

## 7. UNVERIFIED 항목

| # | 항목 | 이유 |
|---|------|------|
| U-1 | 업로드 용량 초과 413 (실제 대용량 파일) | 20MB 초과 테스트 파일을 생성해 전송하는 E2E 미실행. 코드 리뷰로 content-length 선검사(`upload/route.ts:173`) + file.size 검사(`:207`)는 확인됨. 헤더 기반 선차단이 정상 동작하는지는 실파일 테스트 필요 |
| U-2 | 업로드 rate limit 429 (실제 초과) | 120회/60초 윈도를 실제로 소진하는 테스트 미실행. 코드 리뷰 + rate-limit.test.ts 유닛 테스트(13건 PASS)로 로직은 확인됨 |

---

## 8. 참고사항 (FAIL 아님)

1. **테스트 파일 잔존**: QA 테스트 중 `/Users/husky/MarkdownDocs/`에 생성된 파일 4건(qa-test.md, qa-test-1.md, qa-test-2.md, qa-test-folder/sub-test.md)의 자동 정리가 도구 권한 문제로 실패. **수동 삭제 필요**.

2. **`LogoutResponse` 타입 미정의**: `src/types/api.ts`에 `LogoutResponse`가 없어 `workspace/page.tsx:35`가 인라인 `{ ok: true }`를 쓴다. 현재는 타입 중복 정의가 아니므로 계약 위반은 아니지만, 완결성을 위해 추가를 권장한다.

3. **빌드 경고 NFT tracing**: `next.config.ts`의 `process.env.UPLOAD_MAX_BYTES` 동적 접근이 Turbopack NFT tracing 경고를 유발한다. 동작에는 영향 없음. `backlog.md` P2-6으로 추적 중.

4. **middleware deprecated 경고**: Next 16이 `middleware` 파일 컨벤션을 deprecated 처리. `proxy`로 이름 변경 필요. `backlog.md` P2-6으로 추적 중.

5. **dev/production 쿠키 Secure 차이**: dev 모드(`NODE_ENV !== 'production'`)에서 Secure 플래그가 빠져 localhost HTTP에서 쿠키가 동작한다. production에서는 Secure가 켜져 HTTPS(ngrok TLS 종단) 환경에서만 쿠키 전송. 의도된 설계.

---

## 9. 종합 판정

**PASS**

Stage 1(인증 + 업로드)의 보안 불변식 8개 항목, API 계약 일치, E2E 해피패스, 프론트-백엔드 통합 지점 전부 검증 통과. FAIL 0건. UNVERIFIED 2건(U-1, U-2)은 코드 리뷰와 유닛 테스트로 로직이 확인되어 차단 사유가 아님.

이전 프론트엔드 검증의 FAIL 2건(F1 targetPath UX, F2 문서 드리프트) 모두 해소 확인.

Stage 1은 **완료 판정**이 가능하다.
