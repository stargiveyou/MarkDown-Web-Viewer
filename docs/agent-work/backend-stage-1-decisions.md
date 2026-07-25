# 업로드 라우트 설계 결정 — Stage 1

- 작성: `backend-dev` / 2026-07-23
- 상태: 확정 (구현 완료)
- 근거: [contract-stage-0.md](contract-stage-0.md) · [src/types/api.ts](../../src/types/api.ts) ·
  [stage-1-security-complete.md](../complete-work/stage-1-security-complete.md) §3·§4 ·
  [frontend-stage-1-client-contract.md](frontend-stage-1-client-contract.md) §1

`src/types/api.ts`를 **한 글자도 바꾸지 않았다.** 아래는 구현 중 내린 결정과, 계약 문서만으로는
정해지지 않았던 빈칸을 어떻게 메웠는지에 대한 기록이다.

---

## D-1. Next 프록시(구 middleware)의 10MB 바디 상한을 `next.config.ts`에서 올렸다

**증상.** 15MB `.md` 업로드가 413도 200도 아닌 **400 `Invalid form data.`** 로 실패했다.
`UPLOAD_MAX_BYTES=20971520`(20MB)인데 10MB를 넘는 파일이 아예 저장되지 않는 상태였다.

**원인.** `src/middleware.ts`의 매처가 `/api/upload`를 포함하므로 Next 16은 프록시 단계에서
요청 바디를 버퍼링한다. 이때 기본 상한이 **10MB**이고, 초과분은 **거부가 아니라 잘림(truncate)** 이다.
잘린 멀티파트가 라우트에 도달하니 `request.formData()` 파싱이 깨져 400이 나갔다.
개발 서버 로그에 근거가 그대로 남는다:

```
Request body exceeded 10MB for /api/upload. Only the first 10MB will be available unless configured.
```

**결정.** `next.config.ts`에 `experimental.proxyClientMaxBodySize`를 추가하고,
값을 `UPLOAD_MAX_BYTES + 4MiB`로 **env에 연동**해 계산한다.

- 하드코딩하지 않은 이유: `UPLOAD_MAX_BYTES`를 올렸을 때 이 상한이 따라오지 않으면
  같은 버그가 조용히 재발한다. 정책값의 출처는 언제나 env 하나여야 한다.
- 여유 4MiB > 라우트 자신의 총량 상한 여유 1MiB인 이유: **413 판정이 라우트에서 나와야** 하기 때문이다.
  프록시가 먼저 자르면 클라이언트는 "너무 크다"가 아니라 "형식이 이상하다"(400)를 받는다.
- env를 못 읽는 환경(CI 등)에서는 24MiB 기본값으로 떨어진다. env 검증 자체는 `src/lib/env.ts` 책임이다.

**확인.** 15MB 파일 업로드 200 + SHA-256 원본 일치, 25MB 파일 413.

> **TO: security-auth / tech-lead** — `next.config.ts`는 보안 파일 목록에 없어 직접 수정했습니다.
> 다만 **업로드 크기 정책의 실효성에 직결**되는 값이므로 리뷰를 요청합니다.
> 특히 `UPLOAD_MAX_BYTES`를 바꿀 때 프록시 상한이 자동으로 따라온다는 점을 유지해 주세요.

## D-2. 파일 단위 상한과 별개로 **요청 총량 상한**을 둔다

`request.formData()`는 스트리밍이 아니라 바디 전체를 메모리에 올린다.
파일 단위 상한(413)만으로는 "20MB짜리 100개를 한 요청에" 같은 입력을 **파싱 전에** 끊을 수 없다.

→ `content-length` 헤더만 보고 `UPLOAD_MAX_BYTES + 1MiB` 초과를 413으로 즉시 거부한다.
프론트는 파일 1개당 1요청이므로 정상 사용에는 영향이 없다.
배치 전송을 쓰더라도 **요청 총량**이 파일 1개 상한 안에 들어와야 한다는 제약이 생긴다(문서화).

## D-3. 전 파일 선검증 → 그 다음 쓰기 (all-or-nothing)

security-auth 예시 코드는 파일별로 검증하고 바로 쓰는 형태였다.
배치 전송에서 3번째 파일이 415면 앞의 2개만 저장된 어중간한 상태가 남는다.

→ 크기·확장자·파일명·경로 검증을 **전 파일에 대해 먼저 끝내고**, 하나라도 실패하면 아무것도 쓰지 않는다.
파일 1개 전송(현재 프론트 동작)에서는 동작 차이가 없고, 배치에서만 의미가 생긴다.

## D-4. 이름 충돌 시 덮어쓰지 않고 `name-1.ext`로 비켜 간다

계약에 규정이 없던 부분이다. `rename`은 기존 파일을 조용히 덮어쓴다 —
같은 이름을 두 번 올리면 사용자 데이터가 경고 없이 사라진다.
"무단 덮어쓰기 금지"(보안 불변식 5)의 취지에 어긋난다.

→ `open(target, 'wx')`(존재하면 EEXIST로 실패하는 **원자 연산**)로 이름을 선점한다.
   TOCTOU 없이 예약되며, 충돌하면 `-1`, `-2` … 100회까지, 그 뒤에는 랜덤 접미사로 비켜 간다.
   응답의 `UploadedFileInfo.name` / `subpath`는 **실제로 저장된 이름**이라 프론트 표시도 어긋나지 않는다.

## D-5. Atomic write 절차 (보안 불변식 4)

```
temp = open('<dir>/.mdws-upload-<random>.tmp', 'wx', 0600)
  → writeFile(data) → fsync → close        # 내용을 디스크에 확정
destination = reserveDestination(dir, safeName)   # open('wx')로 원자적 선점
  → assertRealPathUnderRoot(destination)          # 충돌 회피로 이름이 바뀌었을 수 있으므로 재검증
  → rename(temp, destination)                     # 같은 파일시스템 = 원자적
실패 시 temp와 선점 파일을 모두 정리한다(잔여물 0).
```

- 임시 파일을 **같은 디렉터리**에 두는 이유: `rename`이 원자적이려면 같은 파일시스템이어야 한다.
- `fsync`를 `rename` 전에 하는 이유: 순서가 바뀌면 크래시 시 목적지에 빈 파일이 남을 수 있다.
- 파일 권한 `0600`: 개인 저장소이므로 소유자 전용으로 만든다.

## D-6. 5xx는 계약 코드 집합 밖이다 — 500을 쓰되 바디 모양은 유지

`ApiErrorCode`에는 5xx가 502(webhook 실패)뿐이다. 디스크 쓰기 실패에 502를 붙이면 의미가 어긋난다.
→ 표준 **500**을 쓰되 바디는 `{ code, message }` 모양을 유지한다.
프론트 `fetcher`가 5xx를 502로 정규화하므로 클라이언트 동작은 깨지지 않는다
([frontend-stage-1-client-contract.md](frontend-stage-1-client-contract.md) §2).

> **TO: tech-lead** — 계약상 "이 외의 코드는 반환하지 않는다"와 충돌하는 회색지대입니다.
> `ApiErrorCode`에 500을 추가할지, 500을 계약 밖 예외로 명시할지 판단을 요청합니다.

## D-7. 로그인 바디 크기 상한 4KB

`/api/auth/login`은 유일한 무인증 라우트라 미들웨어 뒤가 아니라 **바깥**에 노출된다.
`request.json()`도 바디를 전부 메모리에 올리므로, 거대한 바디로 메모리를 소모시키는 시도를
`content-length`만 보고 400으로 끊는다. 정상 요청은 `{"password":"..."}` 수준이다.

## D-8. 실패 사유를 구분해 알려주지 않는다

- 로그인: JSON 파싱 실패·필드 없음·타입 불일치·패스워드 불일치를 **전부 401 `Invalid password.`** 로 접는다.
- 업로드: `PathSafetyError`의 내부 사유(`parent traversal` 등)는 **서버 콘솔에만** 남기고,
  클라이언트에는 `400 Invalid path.`만 보낸다(보안 불변식 8).

## 미결 항목

| # | 항목 | 담당 |
|---|---|---|
| 1 | `ApiErrorCode`에 500을 넣을지 결정 (D-6) | `tech-lead` |
| 2 | `next.config.ts` 프록시 바디 상한 리뷰 (D-1) | `security-auth` |
| 3 | 검색 색인 증분 갱신 — 라우트에 `TODO(Stage 3)` 훅만 있음 | `backend-dev` / Stage 3 |
| 4 | 업로드 완료 Webhook — `TODO(Stage 5)`, `notified`는 항상 `false` | `backend-dev` / Stage 5 |
