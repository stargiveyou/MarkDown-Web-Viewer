# 최적화/에러 리포트 -- Stage 5

- 검증 일시: 2026-07-25
- 검증 담당: optimizer (Opus 4.6)
- 대상: Stage 5 변경 파일 (업로드 완료 알림)
  - `src/app/api/upload/route.ts` (276-323행 알림 통합)
  - `src/app/api/share/notify/route.ts` (sanitizeProto 추가)
  - `src/components/upload/UploadDropzone.tsx` (notifiedAny 추적)
  - `src/app/api/upload/upload-notification.test.ts` (신규 테스트)
- 기존 FAIL 항목: `backend-stage-5-validation.md` FAIL 0건, `frontend-stage-5-validation.md` FAIL 0건 -- 중복 보고 없음

---

## 오류 (수정 필요)

| 심각도 | 위치(파일:라인) | 문제 | 재현/영향 | 제안 |
|--------|----------------|------|-----------|------|
| 중간 | `src/app/api/upload/upload-notification.test.ts:24-28` | `sanitizeProto` 테스트가 **실제 라우트 함수가 아닌 테스트 파일 안에 복제된 로컬 함수**를 검증한다. `upload/route.ts:79-83`의 `sanitizeProto`가 수정되더라도 이 테스트는 여전히 통과한다 -- 테스트가 구현과 분리되어 있어 회귀 감지를 보장하지 못한다. | 개발자가 `route.ts`의 `sanitizeProto` 로직을 변경(예: `trim()` 제거, 조건 추가 등)하면 실제 코드에 버그가 있어도 테스트는 PASS. 현재는 "함수가 2줄짜리이므로 모듈 추출하지 않는다"는 설계 결정에 따른 것이나, 결과적으로 테스트 유효성이 약하다. | 두 가지 방안 중 택일 -- (A) `sanitizeProto`를 `src/lib/url-safety.ts` 등 공용 모듈로 추출해 export하고 테스트에서 import (단, 기존 설계 결정 "과잉 추상화 방지"와 충돌하므로 `tech-lead` 판단 필요). (B) 현재 구조를 유지하되, **통합 테스트에서 실제 라우트 핸들러를 호출하는 경로**(`upload-notification.test.ts:337-367` 의 `x-forwarded-proto` 헤더 테스트)가 이미 존재하므로, 로컬 복사본 단위 테스트(`sanitizeProto -- 경계값 검증` describe 블록)의 한계를 주석으로 명시. |
| 중간 | `src/app/api/upload/route.ts:286` + `src/app/api/share/notify/route.ts:107` | `host` 헤더 미검증. `request.headers.get('host') \|\| 'localhost:3000'`으로 받아 그대로 `appUrl`에 보간한다. 인증된 사용자가 `curl -H "Host: evil.com\ninjected: header" ...`로 CRLF 주입 또는 `Host: evil.com`으로 호스트를 변조하면 Discord/Slack 채널에 `https://evil.com/workspace/view?...` 형태의 피싱 URL이 게시된다. | ngrok Basic Auth + 세션 인증을 모두 통과한 내부 사용자만 가능. Discord/Slack 수신자가 오염된 링크를 클릭하면 피싱 사이트로 유도될 수 있다. Stage 4 optimize 리포트(SEC-1)에서 `proto` 쪽만 지적하고 `host`는 "D4-2 결정으로 화이트리스트 불가"라고 기록했으나, 최소한 CRLF 문자와 공백 제거 정도는 적용 가능하다. | `host` 값에서 개행/캐리지리턴/공백을 제거하는 1줄 방어를 추가: `const host = (request.headers.get('host') \|\| 'localhost:3000').replace(/[\r\n\s]/g, '')`. ADR D4-2(동적 URL 구성)를 뒤집지 않는 범위의 최소 방어이다. 완전한 host 화이트리스트는 ngrok 도메인이 동적이라 불가하므로, `tech-lead`에게 안건으로만 올린다. |
| 낮음 | `src/app/api/upload/upload-notification.test.ts:199-204` | `beforeEach`에서 매번 `await import('./route')`로 동적 import하지만, Vitest의 모듈 캐싱으로 인해 실제로는 첫 import 이후 같은 모듈 인스턴스가 반환된다. `vi.clearAllMocks()`가 mock 상태를 초기화하므로 현재 동작에 실질적 문제는 없으나, 테스트 의도("mock 적용 후에 모듈을 가져온다")와 실제 동작이 불일치한다. | 현재는 문제 없음. 그러나 향후 테스트 간 모듈 레벨 상태가 공유되는 시나리오에서 false positive이 발생할 수 있다. | `beforeEach` 주석을 "동적 import로 mock이 적용된 상태에서 모듈을 가져온다"에서 "첫 호출 시 mock 적용된 모듈을 로드하며, 이후 호출은 캐시된 인스턴스를 재사용한다"로 정정. 또는 `vi.resetModules()`를 `beforeEach`에 추가해 의도대로 매번 새 인스턴스를 가져오게 변경. |

---

## 성능 개선 (권장)

| 영향도 | 위치(파일:라인) | 현재 동작 | 비용 | 제안 |
|--------|----------------|-----------|------|------|
| 중간 | `src/app/api/upload/route.ts:276-320` | 업로드 성공 후 Webhook 알림을 `await Promise.allSettled(...)`로 **동기적으로 기다린다**. `sendWebhook()`의 타임아웃이 10초(`src/lib/webhook.ts:94`)이므로, Discord와 Slack 모두 설정된 상태에서 양쪽 Webhook 서버가 느리면 업로드 응답이 최대 10초 지연된다. 프론트엔드는 `apiUpload`의 `onload` 콜백이 호출될 때까지 "업로드 중" 상태를 유지하므로, 사용자는 파일이 이미 저장되었는데도 10초간 진행 중 화면을 본다. | `Promise.allSettled`는 병렬이므로 2채널이라도 최대 10초(합산 아님). 정상적인 Discord/Slack 응답은 100-500ms 범위이므로 보통은 체감되지 않는다. 그러나 Webhook 서버 장애 시 사용자 경험이 크게 저하된다. | **fire-and-forget 패턴으로 전환**하면 업로드 응답 지연을 완전히 제거할 수 있다. 다만 `notified` 필드가 항상 `false`가 되는 트레이드오프가 있다. 현재 설계 결정(D5-4 "best-effort + `notified` 반환")을 유지하는 것이 맞으므로, **동기 대기를 유지하되 타임아웃을 3초로 단축**하는 것을 권고한다. Webhook 서버가 3초 안에 응답하지 않으면 `notified: false`를 반환해도 사용자 경험에 해가 없다. 이 변경은 `webhook.ts:94`의 `WEBHOOK_TIMEOUT_MS`를 수정하면 되나, `/api/share/notify`의 수동 공유에도 영향을 주므로 업로드 전용 타임아웃 파라미터를 `sendWebhook`에 추가하는 방법이 더 안전하다. `tech-lead` 판단 필요. |
| 낮음 | `src/app/api/upload/route.ts:287` | `saved[0]` 인덱스 접근. `saved.length > 0` 조건 안에 있으므로 런타임 오류는 없으나, TypeScript의 `noUncheckedIndexedAccess` 옵션이 활성화되면 `UploadedFileInfo \| undefined` 타입이 되어 컴파일 에러가 발생한다. 현재 `tsconfig.json`에 이 옵션이 없으므로 문제없음. | `tsconfig.json`에 `noUncheckedIndexedAccess: true`를 추가하려 할 때 차단 요인이 된다. | `const firstFile = saved[0]!` (non-null assertion) 또는 `const firstFile = saved[0] as UploadedFileInfo` (조건문으로 이미 보장됨). 현재 우선순위 아님. |
| 낮음 | `src/components/upload/UploadDropzone.tsx:156-157` | `items.filter(item => item.status === 'done').length`와 `items.filter(item => item.status === 'error').length`가 **리렌더마다 2회** 배열 순회를 수행한다. | `items`가 수십 개를 넘기 어려운 UI 컨텍스트이므로 실질 비용은 무시 가능. | `backlog.md P2-12`에 이미 기록된 사항. `useMemo` 또는 단일 `reduce`로 통합 가능하나 현재 우선순위 아님. Stage 5에서 신규 추가된 이슈가 아니므로 중복 보고하지 않는다. |

---

## 코드 품질

### CODE-1. sanitizeProto 중복 정의 (3곳)

| 항목 | 내용 |
|------|------|
| 위치 | `upload/route.ts:79-83`, `share/notify/route.ts:45-49`, `upload-notification.test.ts:24-28` |
| 현재 | 동일한 4줄 함수가 3곳에 복사되어 있다. Stage 5 계획 문서(stage-5-tasks.md)에 "2줄짜리 함수라 별도 모듈로 추출하지 않는다"고 설계 결정이 기록되어 있다. |
| 평가 | 함수 본체가 4줄(공백 제외 3줄)이고, 사용처가 2곳(upload, share/notify)뿐이며, 로직이 극히 단순해 드리프트 위험이 낮다. 설계 결정을 존중한다. 다만 **테스트 파일의 복사본**(위 오류 항목 참조)은 구현 변경 시 회귀 감지를 보장하지 못하는 구조적 약점이다. |
| 제안 | 현재 설계 결정 유지. 추후 유사 패턴이 3곳 이상으로 늘어나면 추출을 재검토. |

### CODE-2. 테스트의 fs mock이 `reserveDestination` 동작을 완전히 우회

| 항목 | 내용 |
|------|------|
| 위치 | `upload-notification.test.ts:136-152` |
| 현재 | `fs.open`을 mock해서 항상 성공하도록 설정. 실제 `reserveDestination`의 충돌 감지 로직(`'wx'` 플래그)이 테스트되지 않는다. |
| 평가 | 이 테스트 파일의 목적은 "알림 통합"이므로 fs 동작 자체를 검증할 필요는 없다. 파일 쓰기 관련 테스트는 별도 테스트 파일에서 담당해야 한다. 현재 `upload/route.test.ts`에 해당 테스트가 없는 것은 Stage 5 범위 밖이다. |
| 제안 | 기록만 남긴다. 파일 쓰기 동작의 유닛 테스트가 필요하면 별도 backlog 항목으로 관리. |

---

## 보안 소견

### SEC-1. sanitizeProto 구현 -- 안전

| 항목 | 내용 |
|------|------|
| 위치 | `upload/route.ts:79-83`, `share/notify/route.ts:45-49` |
| 검증 | `'http'`/`'https'` 이외의 모든 값(null, 빈 문자열, `'javascript:'`, `'data:'`, `'ftp'`, 대소문자 혼합, 전후 공백, 다중값 `'https, http'`)이 `'https'`로 대체된다. `toLowerCase()` + `trim()` 적용으로 대소문자/공백 우회가 차단된다. Stage 4 optimize 리포트의 SEC-1(P1-20)이 정확히 해소되었다. |
| 판정 | **안전**. 우회 벡터 없음. |

### SEC-2. host 헤더 미검증 -- 기존 이슈 유지

| 항목 | 내용 |
|------|------|
| 위치 | `upload/route.ts:286`, `share/notify/route.ts:107` |
| 현재 | `request.headers.get('host') \|\| 'localhost:3000'`을 그대로 `appUrl`에 보간. Stage 4 optimize 리포트에서 이미 지적되었으나 `host`는 D4-2 결정(동적 URL 구성)에 의해 화이트리스트 불가로 판정되었다. |
| Stage 5 변화 | `upload/route.ts:286`에 동일 패턴이 **새로 추가**되었다. Stage 4에서는 `share/notify/route.ts`에만 존재하던 문제가 이제 2곳이 되었다. |
| 판정 | 보안 불변식 직접 위반 아님. 인증된 내부 위협자 시나리오에서만 악용 가능. 위 오류 테이블에 CRLF 최소 방어를 제안했다. |

### SEC-3. Webhook 알림이 업로드 응답을 차단하지 않음 -- 안전

| 항목 | 내용 |
|------|------|
| 위치 | `upload/route.ts:302-319` |
| 검증 | `notified` 기본값 `false`(277행). 알림 블록 전체가 `try/catch`(302-319행) 내부. `Promise.allSettled`는 개별 rejection을 먹으므로 외부 catch에 도달하는 경우는 `targets.map(...)` 자체가 throw할 때뿐인데, `sendWebhook`은 "절대 throw하지 않는다" 계약(`webhook.ts` 주석)을 충족하고 있다. 만약 `sendWebhook` 계약이 깨져도 외부 `try/catch`가 `console.error` 후 `notified = false`를 유지한다. |
| 판정 | **안전**. 이중 방어 구조가 올바르다. |

### SEC-4. Webhook 알림이 rate limit을 추가 소모하지 않음 -- 안전

| 항목 | 내용 |
|------|------|
| 위치 | `upload/route.ts:276-320` |
| 검증 | 알림은 업로드 요청 내부에서 `sendWebhook`을 직접 호출한다. `/api/share/notify` 라우트를 거치지 않으므로 `shareNotify` rate limit 버킷을 소모하지 않는다. 업로드 자체의 rate limit(`RATE_LIMIT_POLICY.upload`)만 적용된다(D5-6 결정). |
| 판정 | **안전**. 설계대로 동작. |

---

## 빌드/린트 출력

### `npm run typecheck`
```
> web-md-viewer@0.1.0 typecheck
> tsc --noEmit
(오류 0건)
```

### `npm run lint`
```
> web-md-viewer@0.1.0 lint
> eslint
(오류 0건, 경고 0건)
```

### `npm test`
```
> web-md-viewer@0.1.0 test
> vitest run

 RUN  v4.1.10 /Users/husky/Desktop/Project/Claude/Web-MD-Viewer

 Test Files  9 passed (9)
      Tests  160 passed (160)
   Start at  20:07:27
   Duration  6.54s (transform 2.34s, setup 0ms, import 6.87s, tests 6.46s, environment 2ms)
```

### `npm run build`
```
> web-md-viewer@0.1.0 build
> next build

Next.js 16.2.11 (Turbopack)

경고 2건 (기존 알려진 사항):
  1. "middleware" file convention deprecated -> "proxy" 전환 필요 (backlog P2-6)
  2. NFT tracing 경고: upload/route.ts의 fs 동적 참조 감지 (동작 영향 없음)

빌드 성공. 17개 라우트 생성 (정적 8 + 동적 9).
  - /api/upload (Dynamic, nodejs runtime) -- Webhook 알림 통합 포함
```

Stage 5 신규 빌드 경고: **없음**. 기존 경고 2건만 유지됨.

---

## 요약

| 구분 | 건수 | 심각도 분포 |
|------|------|-------------|
| 오류 (수정 필요) | 3건 | 중간 2, 낮음 1 |
| 성능 개선 (권장) | 3건 | 중간 1, 낮음 2 |
| 코드 품질 소견 | 2건 | 기록 |
| 보안 소견 | 4건 | 안전 확인 3, 기존 이슈 유지 1 |

**높음 수준 오류 없음**. `npm run build`, `typecheck`, `lint`, `test` 전부 통과. Stage 5 구현 품질은 양호하다. Stage 4에서 보고된 P1-20(proto 화이트리스트)이 정확히 해소되었다.

---

## 권장 조치 우선순위

1. **PERF 중간 (Webhook 타임아웃)**: 업로드 응답 지연을 줄이기 위해 업로드 전용 타임아웃 단축(10초 -> 3초)을 검토. `sendWebhook`에 타임아웃 파라미터를 추가하면 `/api/share/notify`의 수동 공유에는 영향 없이 적용 가능. `tech-lead` 판단 필요.
2. **오류 중간 (테스트 복사본)**: `sanitizeProto` 테스트가 로컬 복사본을 검증하는 구조적 약점. 통합 테스트(337-367행)가 실제 라우트를 통해 간접 검증하므로 즉시 차단 이슈는 아니나, 주석으로 한계를 명시하거나 모듈 추출을 검토.
3. **오류 중간 (host CRLF)**: `host` 헤더에서 CRLF/공백 제거하는 최소 방어 1줄 추가. ADR 변경 불필요.
4. 나머지 항목은 현재 규모에서 체감 영향이 없으므로 backlog에 기록만 남긴다.

---

## backlog.md 반영 제안

### 후속 기록 (P2)

```
| 25 | upload Webhook 타임아웃 단축 검토 | `src/app/api/upload/route.ts:303` + `src/lib/webhook.ts:94` -- Webhook 타임아웃 10초가 업로드 응답 지연으로 전파됨. 업로드 전용 3초 타임아웃 또는 fire-and-forget 검토. tech-lead 판단 필요. 출처: optimize-stage-5-report.md PERF 중간 |
| 26 | host 헤더 CRLF 최소 방어 | `src/app/api/upload/route.ts:286`, `src/app/api/share/notify/route.ts:107` -- host 값에서 개행/캐리지리턴/공백을 제거하는 1줄 방어 추가 권고. D4-2 결정(동적 URL 구성) 범위 내 최소 방어. 출처: optimize-stage-5-report.md SEC-2 |
| 27 | sanitizeProto 테스트 로컬 복사본 한계 명시 | `src/app/api/upload/upload-notification.test.ts:24-28` -- 테스트가 실제 라우트 함수가 아닌 로컬 복사본을 검증. 통합 테스트(337-367행)가 간접 보완하나 한계를 주석으로 명시하거나 모듈 추출 검토. 출처: optimize-stage-5-report.md |
```

P1-20(sanitizeProto)은 Stage 5에서 해소 완료. backlog에서 제거 또는 완료 표시 가능.
