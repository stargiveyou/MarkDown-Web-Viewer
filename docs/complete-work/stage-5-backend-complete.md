# Stage 5 Backend 완료 보고 -- 업로드 완료 알림

- 담당: `backend-dev` (opus)
- 완료일: 2026-07-25
- 기준 문서: `docs/plan/stage-5-tasks.md`

---

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|-----------|------|
| `src/app/api/upload/route.ts` | 수정 | Webhook 알림 통합 + `sanitizeProto` 추가 |
| `src/app/api/share/notify/route.ts` | 수정 | `sanitizeProto` 추가 (backlog P1-20 해소) |
| `src/app/api/upload/upload-notification.test.ts` | 신규 | 알림 유닛 테스트 21건 |
| `docs/complete-work/stage-5-backend-complete.md` | 신규 | 본 문서 |

---

## 엔드포인트별 변경 상세

### POST /api/upload

**변경 내용:**
1. `sendWebhook`, `WebhookPayload`, `ShareTarget` import 추가
2. `sanitizeProto()` 헬퍼 함수 추가 -- `x-forwarded-proto` 헤더를 `'http'` 또는 `'https'`로만 허용
3. TODO 주석(기존 263-265행)을 실제 Webhook 알림 로직으로 교체:
   - `getServerEnv()`로 `DISCORD_WEBHOOK_URL` / `SLACK_WEBHOOK_URL` 확인
   - 설정된 채널을 `Promise.allSettled`로 병렬 발송
   - 하나라도 성공하면 `notified: true`, 전부 실패하거나 미설정이면 `notified: false`
   - 실패 사유는 `console.error`로 서버에만 로깅 (보안 불변식 8)
4. `targetDir` 변수를 try 블록 밖으로 이동 (알림 페이로드에서 참조해야 하므로)

**보안 불변식 준수:**
- `runtime = 'nodejs'` 유지 (기존)
- Webhook URL은 응답에 절대 포함되지 않음 (불변식 6)
- 스택트레이스/내부 정보 비노출 (불변식 8)
- 알림 실패가 업로드 200 응답을 차단하지 않음

### POST /api/share/notify

**변경 내용:**
1. `sanitizeProto()` 헬퍼 함수 추가 (upload 라우트와 동일 로직)
2. 기존 96행의 `request.headers.get('x-forwarded-proto') || 'https'`를 `sanitizeProto()` 호출로 교체
3. backlog P1-20 해소: `javascript:` 등 위험 스키마가 appUrl에 주입되는 것을 차단

---

## 테스트 추가

| # | 테스트 | 결과 |
|---|--------|------|
| 1 | `sanitizeProto('https')` -> `'https'` | PASS |
| 2 | `sanitizeProto('http')` -> `'http'` | PASS |
| 3 | `sanitizeProto('HTTP')` -> `'http'` (대소문자 무관) | PASS |
| 4 | `sanitizeProto('HTTPS')` -> `'https'` | PASS |
| 5 | `sanitizeProto('Http')` -> `'http'` (혼합) | PASS |
| 6 | `sanitizeProto(null)` -> `'https'` (기본값) | PASS |
| 7 | `sanitizeProto('')` -> `'https'` | PASS |
| 8 | `sanitizeProto('javascript:')` -> `'https'` (차단) | PASS |
| 9 | `sanitizeProto('ftp')` -> `'https'` | PASS |
| 10 | `sanitizeProto('data:')` -> `'https'` | PASS |
| 11 | `sanitizeProto(' https ')` -> `'https'` (trim) | PASS |
| 12 | `sanitizeProto('https, http')` -> `'https'` (다중 값) | PASS |
| 13 | Webhook URL 설정 시 -> `notified: true` | PASS |
| 14 | Webhook URL 미설정 시 -> `notified: false`, sendWebhook 미호출 | PASS |
| 15 | Webhook 실패 시 -> 200 + `notified: false` | PASS |
| 16 | Discord 성공 + Slack 실패 -> `notified: true` | PASS |
| 17 | 둘 다 실패 -> `notified: false` | PASS |
| 18 | 둘 다 성공 -> `notified: true` | PASS |
| 19 | 응답에 Webhook URL 비포함 (불변식 6) | PASS |
| 20 | `x-forwarded-proto: http` -> appUrl이 `http://`로 시작 | PASS |
| 21 | `x-forwarded-proto: javascript:` -> appUrl이 `https://`로 시작 | PASS |

---

## 검증 결과

| 검증 | 결과 |
|------|------|
| `npm run typecheck` | 오류 0 |
| `npm test` | 160/160 통과 (9 파일) |
| `npm run lint` | 오류 0 |
| `npm run build` | 성공 |

---

## 미결 항목

없음. Stage 5 백엔드 작업 전항 완료.
