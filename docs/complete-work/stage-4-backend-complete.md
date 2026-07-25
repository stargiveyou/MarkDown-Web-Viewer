# Stage 4 Backend 완료 기록 -- 소셜 공유 (Discord / Slack Webhook)

- 담당: `backend-dev`
- 완료일: 2026-07-25
- 검증: `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` 전부 통과

---

## 변경 파일 목록

### 신규

| 파일 | 설명 |
|------|------|
| `src/lib/webhook.ts` | Discord Embed / Slack Block Kit 페이로드 생성 + Webhook 전송 유틸리티 |
| `src/app/api/share/notify/route.ts` | `POST /api/share/notify` 라우트 핸들러 |
| `src/lib/webhook.test.ts` | Webhook 유닛 테스트 (20건) |

### 수정 없음 (이미 Stage 0-1에서 완비)

| 파일 | 사유 |
|------|------|
| `src/lib/env.ts` | `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL` 선택 env 이미 정의됨 |
| `src/lib/rate-limit.ts` | `RATE_LIMIT_POLICY.shareNotify` (60초/10회) 이미 정의됨 |
| `src/types/api.ts` | `ShareTarget`, `ShareNotifyRequest`, `ShareNotifyResponse` 이미 정의됨 |
| `.env.local.example` | Webhook URL 예시 이미 포함 |

---

## 엔드포인트별 상태

### POST /api/share/notify

| 항목 | 상태 |
|------|------|
| 라우트 파일 | `src/app/api/share/notify/route.ts` |
| `runtime = 'nodejs'` | O |
| 세션 보호 (불변식 1) | O -- middleware 자동 적용 |
| 경로 검증 (불변식 2) | O -- `resolveUnderRoot` + `assertRealPathUnderRoot` 2단 방어 |
| 시크릿 비노출 (불변식 6) | O -- Webhook URL 응답/로그 미포함, `import 'server-only'` |
| Rate limit (불변식 7) | O -- `RATE_LIMIT_POLICY.shareNotify` (60초/10회), 429 + `Retry-After` |
| 내부 정보 비노출 (불변식 8) | O -- 절대 경로/스택트레이스/Webhook URL 미포함 |
| 500 vs 502 구분 | O -- webhook 실패=502, 서버 내부=500 |
| Discord Embed 전송 | O |
| Slack Block Kit 전송 | O |

---

## 보안 불변식 점검

| # | 불변식 | 적용 | 확인 |
|---|--------|------|------|
| 1 | 세션 보호 | middleware | PASS |
| 2 | 경로 검증 | `resolveUnderRoot` + `assertRealPathUnderRoot` | PASS |
| 6 | 시크릿 비노출 | `import 'server-only'`, URL 로그/응답 미포함 | PASS |
| 7 | Rate limit | `checkRateLimit(key, RATE_LIMIT_POLICY.shareNotify)` | PASS |
| 8 | 내부 정보 비노출 | `apiError()` / `internalError()` 경유 | PASS |

---

## 테스트 결과

```
 Test Files  8 passed (8)
      Tests  139 passed (139)
```

### webhook.test.ts 테스트 케이스 (20건)

| # | 그룹 | 테스트 | 결과 |
|---|------|--------|------|
| 1 | buildDiscordPayload | embeds 배열 포함 | PASS |
| 2 | buildDiscordPayload | embed 필수 필드 (title, description, url, color, timestamp, footer) | PASS |
| 3 | buildSlackPayload | blocks 배열 포함 | PASS |
| 4 | buildSlackPayload | section block에 파일명/경로/수정일 포함 | PASS |
| 5 | buildSlackPayload | context block에 MD Workspace 텍스트 | PASS |
| 6 | sendWebhook 성공 | Discord 성공 (204) | PASS |
| 7 | sendWebhook 성공 | Slack 성공 (200 + "ok") | PASS |
| 8 | sendWebhook 성공 | Content-Type application/json | PASS |
| 9 | 페이로드 전달 | Discord embeds 전달 확인 | PASS |
| 10 | 페이로드 전달 | Slack blocks 전달 확인 | PASS |
| 11 | sendWebhook 실패 | Webhook 비2xx 응답 | PASS |
| 12 | sendWebhook 실패 | 네트워크 오류 | PASS |
| 13 | sendWebhook 실패 | Discord URL 미설정 | PASS |
| 14 | sendWebhook 실패 | Slack URL 미설정 | PASS |
| 15 | sendWebhook 실패 | 타임아웃 처리 | PASS |
| 16 | sendWebhook 실패 | throw 없이 ok=false 반환 | PASS |
| 17 | 보안 불변식 6 | 에러에 Webhook URL 미포함 | PASS |
| 18 | 보안 불변식 6 | 네트워크 오류에도 URL 미포함 | PASS |
| 19 | 보안 불변식 6 | fetch는 URL 사용하되 에러에는 미포함 | PASS |
| 20 | AbortSignal | signal 옵션 전달 확인 | PASS |

---

## 빌드 결과

```
Route (app)
├ ƒ /api/share/notify     <-- 신규 추가
```

빌드 성공. 기존 경고(NFT tracing)는 Stage 1부터 존재하던 것으로 신규 아님.

---

## 미결 항목

없음. Stage 5(업로드 완료 알림)에서 `webhook.ts`의 `sendWebhook`을 재사용할 예정.

---

## Stage 5 재사용 지점

`src/lib/webhook.ts`의 `sendWebhook(target, payload)` 함수는 범용적으로 설계되어 있어,
업로드 라우트(`src/app/api/upload/route.ts`)에서 `TODO(Stage 5)` 주석 위치에서 바로 호출할 수 있다.
