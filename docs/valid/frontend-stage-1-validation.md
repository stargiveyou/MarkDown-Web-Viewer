# 프론트엔드 검증 — Stage 1

- 검증 일시: 2026-07-23
- 검증자: `frontend-validator` (model: fable)
- 대상 범위: `src/lib/fetcher.ts`, `src/components/ui/**`, `src/components/upload/**`,
  `src/app/login/page.tsx`, `src/app/workspace/page.tsx`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
  (근거: [docs/complete-work/stage-1-frontend-complete.md](../complete-work/stage-1-frontend-complete.md))
- 검증 방법: 전 파일 정독 + grep 전수 확인 + `npm run typecheck` / `npm run lint` / `npm run build` +
  `.next/static` 번들 시크릿 스캔 + `npm run dev` 스모크 테스트(검증 후 서버 종료 확인)
- **종합 판정: FAIL (FAIL 2건 — F1 기능 결함 1건, F2 문서 드리프트 1건)**

## 항목별 결과

| # | 항목 | 판정 | 근거(파일:라인) |
|---|------|------|------------------|
| 1 | 계약 준수 — 엔드포인트 경로·바디 형태 | PASS | `POST /api/auth/login` `src/app/login/page.tsx:66-69`(`LoginRequest` JSON), `POST /api/auth/logout` `src/app/workspace/page.tsx:35`, `POST /api/upload` multipart `src/components/upload/UploadDropzone.tsx:104`. CLAUDE.md Canonical 계약 표와 일치 |
| 2 | 계약 준수 — 타입을 `@/types/api`에서만 import | PASS | `src/lib/fetcher.ts:15`, `src/app/login/page.tsx:12`, `src/components/upload/UploadDropzone.tsx:15`, `src/components/upload/UploadModal.tsx:12`, `src/app/workspace/page.tsx:13`. 계약 타입 로컬 재정의 grep 0건 (`upload-errors.ts:23`의 `UploadFailure`는 UI 전용 형태로 계약 중복 아님) |
| 3 | 전역 래퍼 강제 — raw `fetch` 부재 | PASS | grep 전수: `fetch(`는 `src/lib/fetcher.ts:121` 단 1건(래퍼 내부). `XMLHttpRequest`도 `fetcher.ts:162`뿐. axios/ky 등 0건 |
| 4 | 401 → `/login` 리다이렉트 | PASS | `src/lib/fetcher.ts:83-89` — `next` 파라미터 포함 리다이렉트, `:85`에서 현재 경로가 `/login`이면 생략(루프 차단). 런타임 스모크: 미인증 `/workspace` → `307 /login?next=%2Fworkspace` 확인 |
| 5 | 로그인 페이지 자체의 401 루프 방지 | PASS | `src/lib/fetcher.ts:85`(리다이렉트 생략) + `src/app/login/page.tsx:31`(401을 "패스워드 오류"로 해석) + `safeNext`가 `next=/login`을 차단 `src/app/login/page.tsx:24` |
| 6 | 429 → rate limited 토스트 | PASS | `src/lib/fetcher.ts:97-99`(발행) + `:137`(`apiFetch`는 `toastOn429=true`) → `Toaster.tsx:36-49` 표시. 토스트 마운트는 `src/app/layout.tsx:34` |
| 7 | 업로드 경로 429 중복 토스트 없음 | PASS | `apiUpload`는 `toastOn429=false`로 fetcher 토스트 억제 `src/lib/fetcher.ts:187`. UI 측은 인라인 표시(`UploadDropzone.tsx:111`) + 큐 중단 시 토스트 1건만 발행(`UploadDropzone.tsx:114-117`) — 합계 토스트 1건 |
| 8 | 429 수신 시 남은 업로드 큐 중단 | PASS | `src/components/upload/UploadDropzone.tsx:113-117`(`stopped = true`), `:91-95`(잔여 항목을 `skipped` 처리, 추가 요청 없음). 401도 동일하게 중단 |
| 9 | 업로드 413/415/429 구분 표시 | PASS | `src/components/upload/upload-errors.ts:15-17`(413/415/429 각기 다른 문구, 코드 기반 분기) → `UploadDropzone.tsx:110-111` 파일별 귀속, `:255-263` `role="alert"` 표시 |
| 10 | `UPLOAD_FIELD` 상수 사용 (리터럴 금지) | PASS | `src/components/upload/UploadDropzone.tsx:100-101`. grep 결과 `'file'`/`'targetPath'` 문자열 리터럴 0건(`type="file"`은 HTML 속성) |
| 11 | `targetPath` 루트일 때 필드 생략 | PASS | `src/components/upload/UploadDropzone.tsx:101` `if (targetPath) form.append(...)` — 빈 문자열(루트)이면 필드 미전송. 계약 문서 §1-2와 일치 |
| 12 | 대상 폴더 입력 UX (품질) | **FAIL (F1)** | `src/components/upload/UploadModal.tsx:23-25, 45` — 키 입력마다 후행 `/`를 제거해 **하위 폴더 경로를 타이핑으로 입력할 수 없음**. 상세는 아래 F1 |
| 13 | `ApiErrorCode` 500 추가의 일관 반영 — 코드 | PASS | `src/types/api.ts:49`(계약) ↔ `src/lib/fetcher.ts:35`(`CONTRACT_CODES`에 500 포함, 통과) + `:45`(500 기본 문구) ↔ `src/components/upload/upload-errors.ts:18-19`(500 문구, 502와 구분). 계약 밖 5xx(501·503 등)만 502로 접음 `fetcher.ts:54-58` |
| 14 | `ApiErrorCode` 500 추가의 일관 반영 — 문서 | **FAIL (F2)** | `docs/agent-work/frontend-stage-1-client-contract.md:59-60, 67` — "5xx(예: 500)를 502로 접음", "유니온에 500이 없기 때문"이라고 서술. 현행 계약·코드와 모순. 상세는 아래 F2 |
| 15 | 스코프 드리프트 (Node fs / FTP / 카카오) | PASS | 검증 대상 전 파일 grep: `fs`/`node:`/`basic-ftp`/`ftp`/`kakao` 0건 (ADR-001/003/004 위반 없음) |
| 16 | 원본 이미지 직접 로드 (Stage 2 선점 금지) | PASS | 검증 대상에 `<img>`/`next/image`/`createObjectURL`/이미지 확장자 URL 0건 — 카드 이미지 코드 자체가 아직 없음(Stage 2 범위) |
| 17 | 시크릿·Webhook URL 비노출 | PASS | 소스 grep: `webhook`/`SESSION_SECRET`/`process.env` 0건(클라이언트 파일). 빌드 후 `.next/static` 전수 스캔: `discord.com/api/webhooks`/`hooks.slack.com`/`webhook` 문자열 0건, `.env.local`의 채워진 값 5종(`MARKDOWN_ROOT`·`SESSION_PASSWORD`·`SESSION_SECRET`·`UPLOAD_MAX_BYTES`·`ALLOWED_EXTENSIONS`) 모두 번들에 없음 |
| 18 | 로딩 / 빈 상태 / 에러 상태 | PASS | 로그인: 로딩 `login/page.tsx:130-136`, 에러 `:118-122`, Suspense 폴백 `:146-155`. 업로드: 진행률 `UploadDropzone.tsx:231-252`, 빈 상태 `:201-202`, 파일별 에러 `:255-263`, 요약 `aria-live` `:205-209`. 워크스페이스: 빈 상태 `workspace/page.tsx:86-98`, 로그아웃 진행 `:67-70`, 실패 토스트 `:41-44` |
| 19 | 키보드 접근성 | PASS | Enter 제출(form onSubmit) `login/page.tsx:51,84`. 모달 Esc `Modal.tsx:57-62`, 포커스 트랩 `:63-79`, 포커스 이동/복원 `:41-51`. 토스트 Esc 닫기 `Toaster.tsx:59-70`, `aria-live` `:73-78`. 드롭존이 `<button>`이라 키보드 조작 가능 `UploadDropzone.tsx:161-164`. 전 인터랙션에 `focus-visible` 링 |
| 20 | 반응형 | PASS | 모달: 모바일 바텀시트/데스크톱 중앙 `Modal.tsx:88,101`(`items-end sm:items-center`, `rounded-t-2xl sm:rounded-2xl`). 토스트 `sm:items-end` `Toaster.tsx:78`. 컨테이너 `max-w-5xl` `workspace/page.tsx:51,76`. 그리드 2열/4열은 Stage 2 범위라 해당 없음 |
| 21 | 빌드 게이트 | PASS | `npm run typecheck` 에러 0 / `npm run lint` 에러·경고 0 / `npm run build` 성공(9페이지, `/login`·`/workspace` 정적 생성) |

런타임 스모크 테스트(`npm run dev`, 종료 확인 완료): `/login` 200, 미인증 `/workspace` 307 → `/login?next=%2Fworkspace`,
미인증 `POST /api/upload` → `{"code":401,...}`, 오답 로그인 → 401. 브라우저 수준 E2E(실제 리다이렉트·토스트 렌더)는
완료 문서에 명시된 대로 Wave 4 `qa-integration` 범위로 남긴다.

## FAIL 상세

### F1. 대상 폴더 입력란에서 하위 폴더 경로를 타이핑할 수 없음 — `UploadModal.tsx`

- **무엇이 잘못됐는가**: `src/components/upload/UploadModal.tsx:45`가 **매 키 입력마다** `normalizeTargetPath()`(`:23-25`)를 적용한다.
  이 함수는 후행 슬래시를 제거하는데(`replace(/\/+$/, '')`), 입력란은 controlled input(`value={targetPath}`, `:43`)이므로
  사용자가 경로 끝에 `/`를 치는 순간 상태에서 즉시 사라진다. 커서는 항상 문자열 끝에 있으므로,
  placeholder가 안내하는 `2026-Travel/Jeju`(`:44`) 같은 중첩 경로를 키보드로 입력하면 `2026-TravelJeju`가 된다.
- **재현 절차**: `/workspace` → "업로드" → 저장 폴더 입력란에 `2026-Travel/Jeju`를 순서대로 타이핑 →
  `/`가 입력 직후 제거되어 최종 값이 `2026-TravelJeju`가 됨. (전체 경로를 붙여넣기하는 경우에만 내부 `/`가 보존된다.)
- **기대 동작**: 입력 중에는 원문을 유지하고, 정규화(선행/후행 슬래시 제거)는 **전송 시점**(FormData 구성 직전) 또는
  blur 시점에만 적용한다. `UploadDropzone.tsx:101`의 루트 판정(`if (targetPath)`)은 정규화된 값으로 수행하면 된다.
- **관련 근거**: 클라이언트 계약 §1-2 "targetPath는 선행/후행 슬래시 없는 상대 경로로 **정규화해서 보낸다**"
  ([frontend-stage-1-client-contract.md](../agent-work/frontend-stage-1-client-contract.md)) — 정규화는 전송 규칙이지 입력 차단 규칙이 아니다.
  하위 폴더 지정이 사실상 불가능해 Stage 1 업로드 기능 요구(대상 폴더 지정 업로드)를 훼손한다.
- **판정 방법 주기**: controlled component 의미론에 따른 코드 논증(결정적). 브라우저 자동화 도구 부재로 화면 재현은 생략했다.

### F2. `ApiErrorCode` 500 추가가 계약 공유 문서에 반영되지 않음 (문서-코드 드리프트)

- **무엇이 잘못됐는가**: 계약(`src/types/api.ts:49`)과 코드(`src/lib/fetcher.ts:35,45`, `src/components/upload/upload-errors.ts:18-19`)는
  500을 계약 코드로 통과시키고 502와 문구를 구분한다. 그러나 backend-dev/security-auth가 참조하는
  `docs/agent-work/frontend-stage-1-client-contract.md`는 여전히
  - `:59` 정규화 표에서 계약 코드를 `400/401/409/413/415/429/502`로 열거(500 누락)
  - `:60` "5xx (계약 외, 예: 500) → 502로 접음"
  - `:67` "`ApiErrorCode` 유니온에 500이 없기 때문에 접기가 필요했다"
  라고 서술한다. 백엔드가 이 문서를 믿으면 "500을 보내도 프론트가 502로 뭉갠다"고 오판할 수 있다.
- **기대 동작**: CLAUDE.md 운영 규칙 "계약을 바꿔야 하면 **코드보다 `docs/agent-work/`의 계약 문서를 먼저 갱신**"에 따라
  §2 정규화 표를 현행(500은 그대로 통과, 계약 외 5xx만 502로 접음)으로 갱신하고 tech-lead 승인 기록을 남긴다.
- **범위 주의**: 코드 자체는 일관적이므로(항목 13 PASS) 이 FAIL은 코드 수정이 아니라 **문서 갱신** 사안이다.

## 참고 (FAIL 아님 — 후속 판단용 메모)

- `POST /api/auth/logout` 응답 타입이 `src/types/api.ts`에 없어 `workspace/page.tsx:35`가 인라인 `{ ok: true }`를 쓴다.
  계약에 `LogoutResponse`를 추가하면 항목 2의 원칙이 완결된다 (현재는 중복 정의가 아니므로 PASS 유지).
- `Modal.tsx:59`의 `stopPropagation()`은 같은 `document`에 걸린 다른 keydown 리스너(`Toaster.tsx:68`)를 막지 못한다.
  모달과 토스트가 동시에 떠 있을 때 Esc 한 번에 둘 다 닫힌다. 의도 여부만 확인하면 됨(`stopImmediatePropagation` 검토).
- `UploadModal`은 열려 있는 동안 `initialTargetPath` 변경을 반영하지 않는다. Stage 1에서는 호출부가 고정값이라 무해.

## backlog 제안 (직접 수정하지 않음 — frontend-dev 되돌림 항목)

- **[P1] F1**: `UploadModal.tsx` — targetPath 정규화를 onChange에서 전송 시점(또는 blur)으로 이동. 재현: 위 F1 절차.
- **[P2] F2**: `frontend-stage-1-client-contract.md` §2 — 500 정규화 서술을 현행 계약(`ApiErrorCode`에 500 포함)에 맞게 갱신, tech-lead 승인.
