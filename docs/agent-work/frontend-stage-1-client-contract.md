# 프론트 클라이언트 계약 — Stage 1

- 작성: `frontend-dev` / 2026-07-23
- 상태: 확정 (구현 완료, 계약 변경 없음)
- 근거: [contract-stage-0.md](contract-stage-0.md) · [src/types/api.ts](../../src/types/api.ts)

`src/types/api.ts`를 **한 글자도 바꾸지 않았다.** 아래는 프론트가 실제로 보내는 요청 형태와
구현 중 내린 결정이며, backend-dev / security-auth가 알아야 할 내용이다.

---

## 1. 프론트가 보내는 요청 (backend-dev 필독)

### `POST /api/auth/login`
```
Content-Type: application/json
Accept: application/json
Body: { "password": "..." }        // LoginRequest
```
- 기대 성공 응답: `LoginResponse` = `{ "ok": true }` + httpOnly 세션 쿠키(`Set-Cookie`).
- 패스워드 불일치는 **401**로 응답한다. 프론트는 이 화면에서만 401을 "패스워드 오류"로 해석하고
  리다이렉트하지 않는다(이미 `/login`이므로 루프 방지 로직이 동작).
- 429(로그인 무차별 대입 방지)도 그대로 표시 가능하다.

### `POST /api/auth/logout`
```
Body 없음. 응답 { "ok": true } 기대.
```

### `POST /api/upload`
```
Content-Type: multipart/form-data (boundary는 브라우저가 설정 — 프론트는 헤더를 지정하지 않는다)
필드: UPLOAD_FIELD.file       ("file")        — File 1건
      UPLOAD_FIELD.targetPath ("targetPath")  — 대상 폴더가 루트가 아닐 때만 포함
```

> **TO: backend-dev** — 다음 3가지를 전제로 라우트를 작성해 주세요.
>
> 1. **요청 1건당 파일 1개**를 보낸다. 여러 파일을 드롭해도 순차적으로 N번 POST한다.
>    이유: 413/415를 **어느 파일이 문제인지** 파일 단위로 귀속시켜 표시해야 하기 때문.
>    다만 계약(`UploadResponse.files: UploadedFileInfo[]`)은 배열이므로,
>    파싱은 `formData.getAll(UPLOAD_FIELD.file)`로 해 두면 향후 배치 전송에도 그대로 호환된다.
> 2. `targetPath`는 **선행/후행 슬래시가 없는 상대 경로**로 정규화해서 보낸다(`2026-Travel/Jeju`).
>    루트면 필드 자체를 보내지 않는다 → 백엔드는 미존재를 루트로 해석할 것.
>    물론 서버에서 경로 안전 유틸에 다시 통과시켜야 한다(보안 불변식 2).
> 3. 에러 바디는 `ApiError` = `{ code, message }` JSON으로 통일해 주세요.
>    바디가 비어 있거나 JSON이 아니어도 프론트는 상태 코드만으로 문구를 결정하므로 깨지지 않는다.

> **TO: security-auth** — `/api/upload`의 rate limit 창(`RATE_LIMIT_MAX`)을 정할 때
> "파일 1개 = 요청 1개"임을 감안해 주세요. 10개 파일 드롭 = 10요청입니다.
> 프론트는 429를 받으면 **남은 큐를 즉시 중단**하므로 폭주하지는 않습니다.

---

## 2. `fetcher` 정규화 규칙

| 상황 | `ApiRequestError.code` | 부수 효과 |
|------|------------------------|-----------|
| 계약 코드(400/401/409/413/415/429/**500**/502) | 그대로 | — |
| 그 외 5xx (501·503 등) | `502`로 접음 | — |
| 그 외 알 수 없는 코드 | `400`으로 접음 | — |
| 네트워크 단절 / CORS / abort | `502` | — |
| 401 | `401` | `/login?next=<현재경로>`로 리다이렉트 후 throw. 이미 `/login`이면 리다이렉트 생략 |
| 429 (`apiFetch`) | `429` | rate limited 토스트 발행 |
| 429 (`apiUpload`) | `429` | 토스트 없음 — 업로드 UI가 파일별 인라인으로 표시(중복 방지) |

> **2026-07-23 갱신 (tech-lead)** — 최초 작성 시점에는 `ApiErrorCode`에 500이 없어 클라이언트에서 502로 접었다.
> 이후 backend-dev가 디스크 쓰기 실패에 쓸 코드를 문의해 **계약에 500을 정식 추가**했다
> (`src/types/api.ts:49`). 502(webhook 실패)와 뭉뚱그리면 사용자가 취할 행동이 달라지기 때문이다 —
> 502는 재시도가 의미 있지만 500은 저장 공간 확인이 필요하다.
> 따라서 **500은 더 이상 접히지 않고 그대로 전달된다.** `fetcher.ts`와 `upload-errors.ts`에 전용 문구가 있다.

### `?next=` 오픈 리다이렉트 방어
로그인 후 이동 경로는 `safeNext()`를 통과해야 한다. `/`로 시작하지 않거나 `//`·`/\`로 시작하면
전부 `/workspace`로 되돌린다. 외부 도메인으로 튕겨나갈 수 없다.

---

## 3. 결정 사항

| # | 결정 | 이유 |
|---|------|------|
| 1 | 토스트를 React 컨텍스트가 아니라 **pub/sub 버스**(`src/components/ui/toast-bus.ts`)로 구현 | `src/lib/fetcher.ts`는 컴포넌트가 아니라서 훅을 쓸 수 없다. 버스가 있으면 순수 모듈에서도 발행 가능하다 |
| 2 | 업로드는 파일 1건당 1요청 순차 전송 | 413/415를 파일 단위로 귀속시키기 위함. 429 시 남은 큐 중단 |
| 3 | 업로드 에러 문구는 **서버 메시지가 아니라 코드**로 결정 | 백엔드 문구 변경에 UI가 흔들리지 않게. 보안 불변식 8과도 일관 |
| 4 | `/` 루트를 `/workspace`로 리다이렉트 | Next 템플릿 페이지 제거. 미인증이면 middleware가 `/login`으로 되돌린다 |
| 5 | 업로드는 모달(`Modal`)로 진입 | 키보드 접근성 요구(Esc 닫기·포커스 트랩)를 한곳에서 만족. Stage 4 공유 모달이 그대로 재사용한다 |

---

## 4. 프론트가 아직 안 만든 것 (Stage 2 이후)

- GridView / 브레드크럼 / 검색·정렬·태그 — Stage 2·3
- Monaco 에디터와 409 충돌 UI — Stage 2 (`fetcher`는 이미 409를 `ApiRequestError`로 올린다)
- 업로드 성공 후 실제 목록 재조회 — `src/app/workspace/page.tsx`의 `handleUploaded`에
  `TODO(Stage 2)` 훅 지점만 잡아 뒀다. 현재는 최근 업로드분을 로컬 상태로만 보여 준다.
