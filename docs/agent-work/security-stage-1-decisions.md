# 보안 설계 결정 — Stage 1

- 작성: `security-auth` / 2026-07-23
- 상태: 확정 (구현 완료)
- 대상 독자: `backend-dev`(Wave 2), `qa-integration`, `tech-lead`
- 계약 변경: **없음** — `src/types/api.ts`를 한 글자도 수정하지 않았다.

구현 중 내린 결정 중 **다른 에이전트에게 영향이 있는 것**만 적는다.
사용 방법과 시그니처는 [완료 기록](../complete-work/stage-1-security-complete.md)에 있다.

---

## D-1. 해시 레코드 구분자를 `$`가 아니라 `:`로 한다

**문제.** PHC 관례대로 `scrypt$32768$8$1$salt$hash` 형식으로 만들었더니
서버가 기동하면서 `SESSION_PASSWORD: scrypt 해시여야 합니다`로 실패했다.
원인은 dotenv의 **변수 확장**이다. `.env.local`의 값에 들어간 `$32768`을 변수 참조로 해석해
빈 문자열로 치환해 버린다. 실제 관측값:

| `.env.local`에 적은 값 | 서버가 읽은 값 |
|---|---|
| `A=scrypt$32768$8$1$abc$def` | `scrypt` |
| `B='scrypt$32768$8$1$abc$def'` (작은따옴표) | `scrypt` |
| `C="scrypt$32768$8$1$abc$def"` (큰따옴표) | `scrypt` |
| `D=scrypt\$32768\$8\$1\$abc\$def` (백슬래시 이스케이프) | `scrypt$32768$8$1$abc$def` |

**따옴표로 감싸도 소용없고 백슬래시 이스케이프만 통한다.** 손으로 붙여 넣는 시크릿에
이스케이프를 요구하는 것은 조용히 깨지는 함정이므로, 구분자를 `:`로 바꿨다.
base64 알파벳(`A–Z a–z 0–9 + / =`)에 `:`가 없어 모호함이 없다.

- 출력 형식: `scrypt:<N>:<r>:<p>:<saltBase64>:<hashBase64>`
- 파싱은 관대하게 `:`와 `$` 둘 다 받는다 (`src/lib/password-hash.ts` `FIELD_SEPARATOR_PATTERN`).

**영향받는 사람.** 없음 — `npm run hash-password` 출력을 그대로 붙여 넣으면 된다.

---

## D-2. `RATE_LIMIT_MAX`를 30 → **120**으로 올린다

`frontend-dev`의 결정(파일 1개 = 요청 1개, 순차 전송)을 반영했다.
`.env.local.example`의 기본값 30이면 **파일 30개짜리 폴더를 한 번 드롭하는 정상 사용**이
즉시 429가 된다. 산정 근거는 완료 기록의 "rate limit 값 근거" 절에 있다.

라우트마다 요구가 달라서 env 단일 값으로는 부족하다. 코드에 정책 상수를 두고
`checkRateLimit(key, override)`의 두 번째 인자로 덮어쓴다.

| 라우트 | 정책 | 출처 |
|---|---|---|
| `POST /api/upload` | 120 / 60초 | env `RATE_LIMIT_MAX` |
| `POST /api/share/notify` | 10 / 60초 | `RATE_LIMIT_POLICY.shareNotify` |
| `POST /api/auth/login` | 10 / 300초 | `RATE_LIMIT_POLICY.login` |

**backend-dev 영향:** 라우트에서 `checkRateLimit(key, RATE_LIMIT_POLICY.shareNotify)`처럼
정책을 명시해 호출한다. 업로드는 `RATE_LIMIT_POLICY.upload`(= `null`)이라 생략해도 된다.

---

## D-3. rate limit 키는 `<scope>:s:<세션nonce>` / `<scope>:ip:<IP>`

`scope`를 키에 섞는다. 섞지 않으면 업로드 120회를 소진한 사용자가 공유 알림도 못 쓰게 된다.

IP 폴백은 **위조 가능**하다(→ 위협 모델 T-5). 그래서 세션이 있으면 무조건 세션을 쓴다.
`rateLimitKeyFor(request, scope)`가 이 우선순위를 강제하므로 라우트가 직접 IP를 읽지 않는다.

---

## D-4. 세션은 서버 저장소 없는 HMAC 서명 토큰

단일 사용자·단일 프로세스라 세션 테이블을 두면 **재시작마다 로그아웃**되는 손해만 있다.

한계와 대응을 명시해 둔다:

| 한계 | 대응 |
|---|---|
| 발급된 토큰을 만료 전에 개별 무효화할 수 없다 | `SESSION_SECRET` 교체 = 전면 강제 로그아웃 |
| 로그아웃은 브라우저에서 쿠키를 지우는 것뿐 | 토큰이 이미 탈취됐다면 만료(12시간)까지 유효 |

`POST /api/auth/logout`은 `clearSessionCookie(response.cookies)`만 호출하면 된다.
서버 측에서 지울 상태가 없다.

---

## D-5. 미들웨어를 Node 런타임으로 고정한다

`src/middleware.ts`에 `export const runtime = 'nodejs'`가 **필수**다.
세션 검증이 `node:crypto`(`createHmac`/`timingSafeEqual`)와 `process.env`를 쓰기 때문에
Edge 런타임에서는 동작하지 않는다. Next 16이 미들웨어의 Node 런타임을 정식 지원한다.

> ⚠️ Next 16은 `middleware` 파일 컨벤션을 deprecated로 표시하고 `proxy`를 권장한다
> (빌드 시 경고 1건). 동작에는 문제가 없으나 마이그레이션이 필요하다.
> 파일명 변경은 `docs/plan/stage-1-tasks.md`에 명시된 산출물명을 바꾸는 일이라
> **`tech-lead` 판단 사항**으로 남긴다 → 백로그 제안.

---

## D-6. `env.ts`에서 `path.resolve()`를 쓰지 않는다

`getServerEnv()`는 미들웨어 번들에 포함된다. 여기서 `path.resolve()`를 호출하면
Next의 파일 트레이싱이 "프로젝트 전체가 동적으로 참조된다"고 판단해
빌드 경고(`Encountered unexpected file in NFT list`)와 함께 번들에 프로젝트 전체를 끌어들인다.

→ `env.ts`는 `MARKDOWN_ROOT`를 **원본 문자열 그대로** 보관하고 절대 경로 여부만 확인한다.
   정규화는 `path-safety.ts`의 `getRoot()`가 단독으로 책임진다.
   루트 표기를 확정하는 지점이 한 곳이어야 `isInside()`의 접두사 비교가 안전하다.

**backend-dev 영향:** `getServerEnv().MARKDOWN_ROOT`를 직접 경로 조립에 쓰지 말 것.
항상 `resolveUnderRoot()`를 경유한다(애초에 그래야 한다 — 보안 불변식 2).

---

## D-7. CSRF 2차 방어로 Origin을 확인한다 (미들웨어)

1차 방어는 쿠키의 `SameSite=Lax`다. 그 위에 미들웨어가 확인한다:

- `Origin` 헤더가 **있고** 호스트가 `Host`와 다르면 → **400** `ApiError`
- `Origin`이 **없으면** 통과 (비브라우저 클라이언트. CSRF가 성립하지 않고,
  검증 에이전트의 curl 재현 절차를 막지 않기 위함)

**계약에 403이 없어서 400을 쓴다.** `ApiErrorCode`는 400/401/409/413/415/429/502로 닫혀 있고,
계약을 바꾸는 것보다 400으로 접는 편이 프론트 정규화 규칙과도 일관된다.

**qa-integration 영향:** 브라우저에서 다른 출처로 POST를 시도하면 400이 난다. 정상 동작이다.

---

## D-8. 인증 실패 페이지 응답에서 만료 쿠키를 삭제한다

미인증 페이지 요청을 `/login?next=...`로 되돌릴 때 `Set-Cookie`로 세션 쿠키를 만료시킨다.
만료·위조 쿠키가 브라우저에 남아 매 요청 HMAC 검증 비용을 무의미하게 물지 않도록 하는 정리다.

---

## 남은 것 (내 담당 아님 / 다음 단계)

| 항목 | 담당 | 시점 |
|---|---|---|
| 업로드 크기(413)·확장자(415) 실제 강제 | `backend-dev` | Wave 2 |
| Atomic write (임시파일 → rename) | `backend-dev` | Wave 2 |
| ngrok 엣지 Traffic Policy + Basic Auth | `security-auth` | Stage 1 배포 시 |
| `middleware` → `proxy` 파일 컨벤션 이관 | `tech-lead` 판단 | Stage 2 |
