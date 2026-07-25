# Stage 5 작업 분해 -- 업로드 완료 알림 (Upload Notification)

- 작성: `tech-lead` / 2026-07-25
- 타입 기준: [src/types/api.ts](../../src/types/api.ts) -- `UploadResponse.notified` 이미 정의 완료
- 목표: `POST /api/upload` 성공 시 Discord/Slack Webhook으로 자동 알림 발송

---

## 배경

Stage 4에서 구축한 Webhook 인프라(`src/lib/webhook.ts`)를 **업로드 라우트에서 재사용**하여,
파일 업로드 성공 직후 Discord/Slack 채널에 자동 알림을 보내는 기능이다.

Stage 4의 `/api/share/notify`는 **사용자가 수동으로 공유 버튼을 누르는** 동작이고,
Stage 5는 **업로드 성공 시 자동으로 발화**되는 알림이다. 호출 시점과 트리거가 다르지만
동일한 `sendWebhook()` + `buildDiscordPayload()` / `buildSlackPayload()`를 재사용한다.

핵심 원칙: **알림 실패가 업로드 성공을 차단하지 않는다.** 업로드 자체가 1순위이고,
알림은 best-effort이다. 실패 시 `UploadResponse.notified = false`로 반환한다.

---

## 선행 결정 (tech-lead 확정)

### D5-1. 알림 대상 채널

**결정: 설정된 모든 Webhook(Discord + Slack)에 병렬로 알림을 보낸다.**

- `DISCORD_WEBHOOK_URL`이 설정되어 있으면 Discord로 알림.
- `SLACK_WEBHOOK_URL`이 설정되어 있으면 Slack으로 알림.
- 둘 다 설정되어 있으면 **둘 다** 알림 (`Promise.allSettled`로 병렬).
- 둘 다 미설정이면 알림을 건너뛰고 `notified: false`를 반환.
- Stage 4의 수동 공유는 사용자가 target을 선택하지만, Stage 5는 자동이므로 설정된 채널 전부에 발송한다.

### D5-2. 알림 페이로드 구성

**결정: Stage 4의 `WebhookPayload` 인터페이스를 그대로 재사용한다.**

- `fileName`: 업로드된 파일의 이름 (`path.basename(subpath)`).
- `filePath`: MARKDOWN_ROOT 기준 상대 경로 (`UploadedFileInfo.subpath`).
- `appUrl`: 뷰어 페이지 URL -- `${proto}://${host}/workspace/view?path=${encodeURIComponent(subpath)}`.
- `mtime`: 저장 후 `stat`에서 얻은 수정일 (`UploadedFileInfo.mtime`).

### D5-3. 앱 URL 구성

**결정: Stage 4와 동일하게 요청 헤더에서 `host` / `x-forwarded-proto`를 읽어 동적으로 구성한다.**

- backlog P1-20의 proto 헤더 검증(D4-2 보완)을 이 단계에서 함께 적용한다.
  `proto`를 `'https'` / `'http'`로만 허용하는 화이트리스트 검증을 추가한다.
- `/api/upload` 라우트에 `request.headers` 참조가 이미 가능하므로 추가 의존성 없음.

### D5-4. 알림 실패 시 동작

**결정: best-effort. 알림 실패는 업로드 응답을 차단하지 않는다.**

- 업로드 파일 저장이 완료된 뒤에만 알림을 시도한다.
- 설정된 채널 중 하나라도 성공하면 `notified: true`.
- 전부 실패하거나 채널이 하나도 설정되지 않았으면 `notified: false`.
- 실패 사유는 서버 콘솔에만 로깅한다 (보안 불변식 8).

### D5-5. 다중 파일 업로드 시 알림 개수

**결정: 요청당 1개의 알림을 보낸다.**

- 프론트엔드는 파일 1건당 1요청으로 순차 전송하므로 (계약 S1), 요청 1건 = 파일 1건이 일반적이다.
- 배치 전송의 경우에도 요청당 1개 알림을 보내되, 메시지에 파일 수를 표시한다.
- 파일 개수가 1개면 파일명을 제목으로, 2개 이상이면 "N개 파일 업로드" 형태로 표시한다.

### D5-6. Rate limit 정책

**결정: 업로드 자체의 rate limit(`RATE_LIMIT_POLICY.upload`)만 적용하고, 알림에 별도 rate limit을 두지 않는다.**

- 업로드 요청이 rate limit을 통과한 뒤에만 알림이 발화되므로, 업로드 rate limit이 곧 알림 rate limit이다.
- 외부 Webhook 서버의 rate limit(Discord 5/5s, Slack 1/1s)은 `sendWebhook()`의 비2xx 응답 처리로 자연스럽게 대응된다. 실패 시 `notified: false`일 뿐 업로드에 영향 없다.

### D5-7. 타입 변경 필요 여부

**결정: `src/types/api.ts`에 변경 불필요.**

- `UploadResponse.notified: boolean`이 Stage 0에서 이미 정의되어 있다.
- 프론트엔드가 이 필드를 읽어 알림 상태를 표시하면 된다.

---

## 범위에 포함되는 변경

| 대상 | 파일 | 변경 유형 |
|------|------|-----------|
| 업로드 라우트 | `src/app/api/upload/route.ts` | **수정** -- Webhook 호출 추가 |
| 업로드 UI | `src/components/upload/UploadDropzone.tsx` | **수정** -- 알림 상태 표시 |
| 공유 라우트 | `src/app/api/share/notify/route.ts` | **수정** -- proto 화이트리스트 (P1-20) |

**신규 파일 없음.** 신규 라이브러리 추가 없음. 타입 변경 없음.

---

## 실행 순서 (Wave)

```
Wave 0 ── tech-lead  : 계획 수립, 결정 확정, 계약 확인 (본 문서)
              |
Wave 1 ──┬── backend-dev   : /api/upload Webhook 호출 통합 + proto 검증
         └── frontend-dev  : UploadDropzone 알림 상태 표시
              |                                  (계약 동일, 병렬)
Wave 2 ──┬── backend-validator    (fable)
         └── frontend-validator   (fable)         동시 실행
              |
Wave 3 ───── qa-integration -> optimizer           (fable)
```

**임계 경로**: Wave 0 완료 후 Wave 1 착수. 프론트/백엔드는 완전 병렬.
Stage 4의 `webhook.ts`가 완성되어 있으므로 즉시 착수 가능.

---

## Wave 0 -- tech-lead (opus)

| # | 작업 | 산출물 |
|---|------|--------|
| 1 | 타입 확인 -- 변경 불필요 | `src/types/api.ts` (이미 정의됨: `UploadResponse.notified`) |
| 2 | 기존 webhook.ts 재사용 확인 | `src/lib/webhook.ts` (변경 불필요) |
| 3 | 이 작업 계획 문서 | `docs/plan/stage-5-tasks.md` (본 문서) |

---

## Wave 1-A -- backend-dev (opus)

`src/lib/webhook.ts`의 `sendWebhook()`을 그대로 사용한다. webhook.ts 자체는 수정하지 않는다.

### 보안 불변식 준수 사항

- `export const runtime = 'nodejs'` -- `/api/upload` 라우트 (이미 선언됨)
- Webhook URL은 `getServerEnv()`에서만 읽고 응답에 절대 포함 안 함 (불변식 6)
- 알림 실패 사유는 서버 콘솔에만 로깅 (불변식 8)
- 기존 보안 불변식(2, 3, 4, 7)은 업로드 라우트에 이미 적용되어 있으므로 손대지 않음

| # | 작업 | 산출물 | 설명 |
|---|------|--------|------|
| 1 | `/api/upload` Webhook 통합 | `src/app/api/upload/route.ts` 수정 | TODO 주석을 실제 구현으로 교체 |
| 2 | proto 화이트리스트 적용 | `src/app/api/share/notify/route.ts` 수정 | backlog P1-20 해소 |
| 3 | 알림 유닛 테스트 보강 | `src/app/api/upload/route.test.ts` 또는 기존 테스트 보강 | 알림 성공/실패 경로 검증 |

### 상세 요구사항

**1. `/api/upload` Webhook 통합 (`src/app/api/upload/route.ts`)**

기존 `TODO(Stage 5)` 주석 위치(265~266행)를 다음 로직으로 교체한다.

```typescript
// 업로드 완료 알림 -- best-effort (D5-1, D5-4)
let notified = false;
const env = getServerEnv(); // 이미 윗쪽에서 호출함 -- 캐시된 인스턴스 반환

const targets: ShareTarget[] = [];
if (env.DISCORD_WEBHOOK_URL) targets.push('discord');
if (env.SLACK_WEBHOOK_URL) targets.push('slack');

if (targets.length > 0 && saved.length > 0) {
  // 앱 URL 구성 (D5-3)
  const proto = sanitizeProto(request.headers.get('x-forwarded-proto'));
  const host = request.headers.get('host') || 'localhost:3000';
  const firstFile = saved[0];
  const appUrl = `${proto}://${host}/workspace/view?path=${encodeURIComponent(firstFile.subpath)}`;

  const payload: WebhookPayload = {
    fileName: saved.length === 1
      ? firstFile.name
      : `${saved.length}개 파일 업로드`,
    filePath: saved.length === 1
      ? firstFile.subpath
      : toSubpath(targetDir),
    appUrl,
    mtime: firstFile.mtime,
  };

  // 설정된 채널 전부에 병렬 발송 (D5-1)
  try {
    const results = await Promise.allSettled(
      targets.map((t) => sendWebhook(t, payload)),
    );
    notified = results.some(
      (r) => r.status === 'fulfilled' && r.value.ok,
    );
    // 실패분 로깅 (보안 불변식 8 -- 서버 콘솔만)
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('[upload] notification error:', r.reason);
      } else if (!r.value.ok) {
        console.error('[upload] notification failed:', r.value.error);
      }
    }
  } catch (err) {
    console.error('[upload] notification unexpected error:', err);
  }
}

const body: UploadResponse = { ok: true, files: saved, notified };
```

**`sanitizeProto` 헬퍼 함수** (업로드 라우트 내부에 private으로 정의):

```typescript
/** x-forwarded-proto를 안전한 값으로 제한한다 (backlog P1-20). */
function sanitizeProto(raw: string | null): string {
  const lower = (raw ?? '').toLowerCase().trim();
  if (lower === 'http' || lower === 'https') return lower;
  return 'https';
}
```

import 추가:
```typescript
import { sendWebhook, type WebhookPayload } from '@/lib/webhook';
import type { ShareTarget } from '@/types/api';
```

**2. proto 화이트리스트 (`src/app/api/share/notify/route.ts`)**

96행의 `const proto = request.headers.get('x-forwarded-proto') || 'https';`를 교체:

```typescript
const proto = sanitizeProto(request.headers.get('x-forwarded-proto'));
```

동일한 `sanitizeProto` 함수를 이 파일에도 정의한다. 함수가 2줄짜리이므로 별도 모듈로
추출하지 않고 라우트 파일마다 로컬 정의한다(과잉 추상화 방지).

**3. 알림 테스트 보강**

| # | 테스트 | 설명 |
|---|--------|------|
| 1 | Webhook URL 설정 시 알림 발송 | `sendWebhook` mock, `notified: true` 반환 확인 |
| 2 | Webhook URL 미설정 시 skip | `notified: false`, `sendWebhook` 미호출 확인 |
| 3 | Webhook 실패 시 업로드 성공 유지 | `sendWebhook` -> `{ ok: false }`, 200 + `notified: false` 확인 |
| 4 | 다중 채널 병렬 발송 | Discord 성공 + Slack 실패 -> `notified: true` |
| 5 | proto 화이트리스트 | `javascript:`, 빈 문자열, `https` 등 경계값 |

---

## Wave 1-B -- frontend-dev (opus)

| # | 작업 | 산출물 | 설명 |
|---|------|--------|------|
| 1 | 업로드 알림 상태 표시 | `src/components/upload/UploadDropzone.tsx` 수정 | `notified` 필드 표시 |

### 상세 요구사항

**1. UploadDropzone 알림 상태 표시**

`UploadDropzone.tsx`의 업로드 성공 처리 부분(112~116행)에서 `UploadResponse.notified` 값을 읽어
성공 토스트에 알림 상태를 추가한다.

변경 영역:

```typescript
// 기존 (132-134행):
emitToast({ message: `${uploaded.length}개 파일을 업로드했습니다.`, variant: 'success' });

// 변경:
const notifiedAny = uploadResponses.some((r) => r.notified);
const baseMsg = `${uploaded.length}개 파일을 업로드했습니다.`;
const notifyMsg = notifiedAny ? ' (알림 전송됨)' : '';
emitToast({ message: baseMsg + notifyMsg, variant: 'success' });
```

구현 접근:
- `runQueue` 함수에서 각 `apiUpload<UploadResponse>` 호출의 응답을 수집한다.
- `uploadResponses` 배열에 응답 전체를 저장하되, 기존 `uploaded` 배열(파일 정보만)은 그대로 유지한다.
- 전부 완료 후 `notified`가 하나라도 `true`인 경우에만 "(알림 전송됨)"을 표시한다.

또한, 개별 파일 항목의 상태 표시에 알림 아이콘(Bell)을 추가할 수도 있지만,
이는 UI 복잡도를 불필요하게 높인다. **토스트 메시지에만 표시하는 것으로 충분하다.**

---

## Wave 2 -- 검증 (fable)

`backend-validator`와 `frontend-validator`가 동시에 실행한다.

### backend-validator 체크리스트

| # | 검증 항목 | 통과 조건 |
|---|-----------|-----------|
| 1 | `npm run typecheck` | 오류 0 |
| 2 | `npm test` | 전체 통과, 실패 0 |
| 3 | `npm run lint` | 오류 0 |
| 4 | `npm run build` | 성공 |
| 5 | Webhook URL 설정 시 업로드 -> `notified: true` | curl E2E 또는 mock 테스트 |
| 6 | Webhook URL 미설정 시 -> `notified: false` | 환경변수 미설정 상태에서 확인 |
| 7 | Webhook 실패 시 업로드 200 유지 | `notified: false`, 파일 저장은 완료 |
| 8 | Discord + Slack 병렬 발송 | 둘 다 설정 시 두 채널 모두 호출 |
| 9 | proto 화이트리스트 (/api/upload) | `javascript:` 등 위험 스키마 차단 확인 |
| 10 | proto 화이트리스트 (/api/share/notify) | 동일 검증 (P1-20 해소) |
| 11 | 기존 보안 불변식 유지 | 2(경로), 3(검증), 4(atomic), 7(rate limit), 8(비노출) |
| 12 | `runtime = 'nodejs'` | `/api/upload` 라우트에 선언 (기존) |
| 13 | Webhook URL 응답 비노출 | 성공/실패 응답에 URL 미포함 (불변식 6) |
| 14 | 에러 응답 내부 정보 비노출 | 스택트레이스, 절대 경로 미포함 (불변식 8) |
| 15 | `sendWebhook` import | `src/lib/webhook.ts`에서 import (server-only 모듈) |

### frontend-validator 체크리스트

| # | 검증 항목 | 통과 조건 |
|---|-----------|-----------|
| 1 | 빌드 성공 | `npm run build` 에러 없음 |
| 2 | `UploadResponse.notified` 사용 | `notified` 필드를 읽어 표시 |
| 3 | 알림 성공 시 토스트 | "(알림 전송됨)" 문구 포함 |
| 4 | 알림 미발송 시 토스트 | 문구 없이 기본 성공 메시지만 |
| 5 | 기존 업로드 동작 퇴행 없음 | 드래그앤드롭, 파일 선택, 진행률, 에러 표시 |
| 6 | 모든 API 호출이 `apiUpload` 경유 | raw XHR/fetch 사용 없음 |

---

## Wave 3 -- qa-integration + optimizer (fable)

### qa-integration

- 로그인 -> 업로드 -> 200 + `notified: true/false` 확인
- Webhook URL 미설정 환경 -> 업로드 성공 + `notified: false`
- Webhook URL 설정 환경 -> 업로드 성공 + `notified: true` (mock 또는 실제)
- 업로드 실패(413/415) -> Webhook 미발화 확인 (파일 저장 안 됨)
- rate limit 초과 -> 429 (기존 동작 유지)
- proto 화이트리스트 -> `/api/share/notify`에도 적용 확인
- `npm run typecheck` + `npm test` + `npm run lint` + `npm run build` 전체 통과

### optimizer

- `Promise.allSettled` 병렬 호출 시 타임아웃(10초 x 2채널 = 최대 10초, 병렬이므로 합산 아님) 확인
- 업로드 응답 지연 최소화 -- Webhook 호출이 응답 시간에 미치는 영향 측정
- 불필요한 객체 복사 / 리렌더 점검

---

## 단계 완료 조건

1. `POST /api/upload` 성공 시 설정된 Discord/Slack 채널로 자동 알림 전송
2. Webhook 실패 시 업로드 200 유지, `notified: false` 반환
3. 설정된 채널 전부에 병렬 발송 (`Promise.allSettled`)
4. Webhook URL 미설정 시 알림 skip, `notified: false`
5. 프론트엔드에서 `notified` 상태를 토스트에 반영
6. proto 화이트리스트 적용 (`/api/upload` + `/api/share/notify` 양쪽)
7. 기존 보안 불변식(1~8) 전항 유지
8. `npm run build` / `typecheck` / `test` / `lint` 통과
9. 검증 리포트 FAIL 0건

---

## 변경 범위 요약

이번 단계는 **기존 인프라를 연결하는 통합 작업**이다.

| 항목 | 내용 |
|------|------|
| 신규 파일 | 0개 |
| 수정 파일 | 3개 (`upload/route.ts`, `share/notify/route.ts`, `UploadDropzone.tsx`) |
| 신규 타입 | 0개 |
| 신규 의존성 | 0개 |
| 예상 코드 변경량 | ~60행 (백엔드 ~40행, 프론트 ~10행, share/notify proto 수정 ~5행, 테스트 ~30행) |
