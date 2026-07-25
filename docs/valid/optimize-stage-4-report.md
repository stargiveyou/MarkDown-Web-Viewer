# 최적화/에러 리포트 -- Stage 4

- 검증 일시: 2026-07-25
- 검증 담당: optimizer (Sonnet 4.6)
- 대상: Stage 4 신규/변경 파일 (소셜 공유 -- Discord/Slack Webhook)
- 기존 FAIL 항목은 `docs/valid/backend-stage-4-validation.md`, `docs/valid/frontend-stage-4-validation.md`에 등록된 항목이 없으므로 중복 보고 없음

---

## 오류 (수정 필요)

| 심각도 | 위치(파일:라인) | 문제 | 재현/영향 | 제안 |
|--------|----------------|------|-----------|------|
| 중간 | `src/app/api/share/notify/route.ts:96-97` | `x-forwarded-proto`와 `host` 헤더를 검증 없이 `appUrl`에 직접 보간한다. 인증된 사용자가 헤더를 `host: evil.com`으로 조작해 요청하면 Discord/Slack 채널에 `https://evil.com/workspace/view?path=...` 형태의 피싱 URL이 게시된다. `proto`를 `javascript`로 조작하면 `javascript://` 스키마가 삽입된다 (Discord/Slack 클라이언트가 차단할 가능성이 높으나 설계적으로 취약). | ngrok Basic Auth + 세션 인증을 통과한 내부 사용자가 curl -H "Host: evil.com" POST /api/share/notify로 호출하면 Webhook 메시지의 "열기" 링크가 `https://evil.com/...`로 오염된다. | `new URL(appUrl)` 파싱 후 `parsed.protocol`이 `'https:'` 또는 `'http:'`인지 검사하고, 두 조건 모두 실패 시 `proto = 'https'`로 강제. `host` 헤더는 D4-2 결정(동적 구성)으로 화이트리스트 불가이지만, 최소한 프로토콜 방어는 추가 가능하다. 상세는 아래 SEC-1 참조. |
| 낮음 | `src/app/api/share/notify/route.ts:85-93` | `fs.stat` 실패 시 ENOENT(파일 미존재)와 EPERM/EACCES(권한 오류)/EIO(I/O 오류)를 구분하지 않고 모두 `apiError(400, 'File not found.')` 반환한다. EPERM은 서버 내부 구성 문제(파일시스템 권한)이므로 500이 더 적절하다. | 서버 운영 중 파일시스템 권한 변경 시 사용자에게 "파일 없음"으로 잘못 안내. | catch 블록에서 `(error as NodeJS.ErrnoException).code`를 확인해 `ENOENT` → 400, `EPERM`/`EACCES`/`EIO` → `internalError()` (500)으로 구분. |
| 낮음 | `src/app/workspace/view/page.tsx:27-43`, `src/app/workspace/edit/page.tsx:33-43` | `isExternalUrl`과 `resolveImageSrc` 헬퍼 함수가 두 파일에 **완전히 동일하게** 복제되어 있다. 현재는 기능 오류가 아니나, 한 파일만 수정했을 때 동작이 갈릴 수 있다 (향후 드리프트 위험). | 예를 들어 뷰어에서 경로 해석 버그를 수정해도 에디터 미리보기에서 동일 버그가 남는다. | 두 함수를 `src/lib/image-utils.ts` 또는 `src/lib/markdown-utils.ts` 같은 공용 모듈로 추출. Stage 4 범위 신규 파일이지만 Stage 2에서 도입된 패턴이므로 별도 backlog P2 항목으로 기록 권고. |

---

## 성능 개선 (권장)

### S-1. `POST /api/share/notify` 응답에 Cache-Control 헤더 누락

| 항목 | 내용 |
|------|------|
| 영향도 | 낮음 |
| 위치 | `src/app/api/share/notify/route.ts:120-121` |
| 현재 동작 | `NextResponse.json(response)` -- Cache-Control 미설정. 브라우저가 기본 캐시 정책을 적용한다. |
| 비용 | POST 메서드는 브라우저가 기본적으로 캐시하지 않으므로 실질적 영향 없음. 그러나 프록시/CDN이 앞에 있는 경우 명시적 `no-store` 선언이 권장된다. |
| 제안 | `NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } })`로 명시. 성능 영향은 없으나 방어적 명시성 확보. |

---

### S-2. `webhook.ts`의 `buildSlackPayload`에서 `toLocaleString('ko-KR')` 서버 로케일 의존

| 항목 | 내용 |
|------|------|
| 영향도 | 낮음 |
| 위치 | `src/lib/webhook.ts:73` |
| 현재 동작 | `new Date(payload.mtime).toLocaleString('ko-KR')` -- Node.js의 ICU 데이터 포함 여부에 따라 결과가 달라질 수 있다. Node 22는 full ICU 기본 포함이지만, minimal ICU 빌드 환경에서는 시스템 로케일 fallback이 발생한다. |
| 비용 | Node 22.23.1(현재) 환경에서는 문제없음. 그러나 다른 Node 버전으로 배포 환경이 바뀌면 형식이 달라질 수 있다. |
| 제안 | `toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })`로 타임존을 명시하거나, `new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(payload.mtime))`으로 명시적 포맷 지정. 현재는 낮은 우선순위이므로 backlog P2 기록만 권고. |

---

### C-1. `view/page.tsx`와 `edit/page.tsx`에서 `onClose` 인라인 함수 참조 불안정

| 항목 | 내용 |
|------|------|
| 영향도 | 낮음 |
| 위치 | `src/app/workspace/view/page.tsx:201`, `src/app/workspace/edit/page.tsx:277` |
| 현재 동작 | `onClose={() => setShareOpen(false)}`로 인라인 화살표 함수가 `ShareModal` prop으로 전달된다. 매 렌더마다 새 함수 참조가 생성된다. |
| 비용 | `ShareModal`이 `React.memo`로 감싸여 있지 않으므로 현재는 실질 영향 없음. 향후 `ShareModal`을 메모이징할 때 장애물이 된다. |
| 제안 | `const handleShareClose = useCallback(() => setShareOpen(false), [])` 로 안정화. 낮은 우선순위, backlog P2 기록 권고. |

---

### C-2. `ShareModal`의 `handleShare` / `handleCopyLink`에 `useCallback` 미적용

| 항목 | 내용 |
|------|------|
| 영향도 | 낮음 |
| 위치 | `src/components/workspace/ShareModal.tsx:35-74` |
| 현재 동작 | `handleShare`와 `handleCopyLink`가 일반 async 함수로 정의되어 있어 `ShareModal` 리렌더마다 새 참조가 생성된다. |
| 비용 | `ShareModal` 내부에서만 사용되며 자식 컴포넌트에 prop으로 전달하지 않으므로 현재는 실질 영향 없음. |
| 제안 | `handleShare`는 `target` 파라미터를 받으므로 `useCallback`으로 감싸는 것보다 현재 패턴이 더 자연스럽다. `handleCopyLink`는 의존성이 없으므로 `useCallback(() => { ... }, [])` 적용 가능하나, 체감 차이 없음. 기록만 남긴다. |

---

### C-3. 링크 복사 버튼의 `disabled` 시각적 피드백 미일치 (기존 MINOR 항목)

| 항목 | 내용 |
|------|------|
| 영향도 | 낮음 |
| 위치 | `src/components/workspace/ShareModal.tsx:120` |
| 현재 동작 | Discord/Slack 버튼(라인 90, 105)에는 `disabled:cursor-not-allowed disabled:opacity-60` CSS가 있으나 링크 복사 버튼(라인 120)에는 없다. `disabled` 속성은 정상 동작함. |
| 비용 | 기능 동작은 정상. 시각적 일관성 결여. `frontend-stage-4-validation.md`에서 이미 MINOR로 기록됨. |
| 제안 | 링크 복사 버튼의 className에 `disabled:cursor-not-allowed disabled:opacity-60` 추가. 1줄 수정이며 즉시 적용 가능. `backlog.md` P2-19에 이미 기록됨. |

---

## 보안 소견

### SEC-1. `x-forwarded-proto` / `host` 헤더 미검증으로 appUrl 오염 가능

| 항목 | 내용 |
|------|------|
| 위치 | `src/app/api/share/notify/route.ts:96-99` |
| 현재 동작 | `const proto = request.headers.get('x-forwarded-proto') || 'https'`, `const host = request.headers.get('host') || 'localhost:3000'`를 그대로 보간해 `appUrl`을 구성한다. |
| 위협 | 인증된 사용자(ngrok Basic Auth + 앱 세션 인증 통과)가 `curl -H "Host: evil.com" ...` 또는 `curl -H "X-Forwarded-Proto: javascript" ...`로 요청하면 Discord/Slack 메시지에 오염된 URL이 삽입된다. Webhook URL 자체는 노출되지 않으므로 보안 불변식 6은 위반하지 않는다. 그러나 수신자에게 잘못된 링크가 게시되는 소셜 엔지니어링 위협이 된다. |
| 판정 | **보안 불변식 직접 위반 아님** (불변식 6, 8 미위반). 단, 인증된 내부 위협자 시나리오에서 피싱 URL 삽입이 가능하므로 중간 수준 위협으로 분류. |
| 제안 | 아래 방어 코드를 `route.ts:95-99` 구간에 추가: |

```typescript
// proto를 https/http로만 제한 (javascript: 등 위험 스키마 차단)
const rawProto = request.headers.get('x-forwarded-proto') ?? '';
const proto = rawProto === 'http' ? 'http' : 'https'; // https 기본값으로 안전하게 강제
const host = request.headers.get('host') || 'localhost:3000';
// host 헤더는 D4-2에서 동적 구성으로 결정되어 whitelist 불가
// 단, 구성된 URL의 프로토콜 검증으로 최소 방어를 적용한다
const appUrl = `${proto}://${host}/workspace/view?path=${encodeURIComponent(subpath)}`;
```

이 변경은 1줄이며 D4-2(host 헤더 기반 동적 URL 구성) 결정을 뒤집지 않는다. `proto` 값만 `https`/`http`로 제한하는 것이므로 ADR 변경 불필요. **backlog P1 추가 권고**.

---

### SEC-2. `response.text()` 호출에서 스트림 소비 패턴 -- 안전

| 항목 | 내용 |
|------|------|
| 위치 | `src/lib/webhook.ts:133` |
| 현재 동작 | `const text = await response.text().catch(() => '')` -- 비2xx 응답의 바디를 최대 200자로 잘라 로깅. `.catch(() => '')` 처리로 바디 읽기 실패 시에도 정상 흐름 유지. |
| 판정 | **안전**. 에러 메시지는 서버 `console.error`에만 기록되고 클라이언트 응답에 포함되지 않는다 (`route.ts:111-117`). `text.slice(0, 200)` 길이 제한으로 과도한 메모리 사용도 방지됨. |

---

### SEC-3. `sendWebhook`의 "절대 throw하지 않는다" 계약 검증 -- 안전

| 항목 | 내용 |
|------|------|
| 위치 | `src/lib/webhook.ts:106-146` |
| 현재 동작 | `fetch` 호출, 비2xx 응답, `AbortSignal.timeout` 초과 모두 try/catch 내에서 `ok=false` 반환으로 처리. `DOMException(TimeoutError)`는 `err instanceof Error`가 `true`이므로 `err.message`가 정상 추출됨 (`'The operation was aborted due to timeout'`). |
| 판정 | **안전**. `route.ts:105-124`의 외부 try/catch가 예상치 못한 throw를 500으로 변환하는 최후 방어선 역할을 하므로 이중 방어 구조가 올바르다. |

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

 Test Files  8 passed (8)
      Tests  139 passed (139)
   Start at  02:29:31
   Duration  6.47s (transform 1.51s, setup 0ms, import 6.26s, tests 3.44s, environment 1ms)
```

### `npm run build`
```
> web-md-viewer@0.1.0 build
> next build

▲ Next.js 16.2.11 (Turbopack)

경고 2건 (기존 알려진 사항):
  1. "middleware" file convention deprecated -> "proxy" 전환 필요 (backlog P2-6, Stage 1부터 존재)
  2. NFT tracing 경고: upload/route.ts의 fs 동적 참조 감지 (동작 영향 없음, Stage 1부터 존재)

빌드 성공. 17개 라우트 생성.
  - /api/share/notify 포함 (Dynamic, nodejs runtime)
```

Stage 4 신규 빌드 경고: **없음**. 기존 경고 2건만 유지됨.

---

## 요약

| 구분 | 건수 | 심각도 분포 |
|------|------|-------------|
| 오류 (수정 필요) | 3건 | 중간 1, 낮음 2 |
| 성능 개선 (권장) | 5건 | 낮음 5 |
| 보안 소견 | 3건 | 중간 1(SEC-1), 안전 확인 2 |

**오류 없음 (높음 수준)**. `npm run build`, `typecheck`, `lint`, `test` 전부 통과. Stage 4 구현 품질은 전반적으로 양호하다.

---

## 권장 조치 우선순위

1. **SEC-1 (proto 헤더 검증 1줄 수정)**: proto를 `https`/`http`로 제한하는 것으로 `javascript:` 스키마 삽입을 막는다. 1줄 수정이며 D4-2 ADR을 뒤집지 않는다. **P1 추가 권고**.
2. **route.ts:85-93 EPERM/EACCES 구분**: 서버 권한 문제를 400이 아닌 500으로 올바르게 표현. 낮은 우선순위이지만 운영 시 원인 파악에 도움. **P2 기록 권고**.
3. **isExternalUrl/resolveImageSrc 중복 코드 정리**: Stage 4 범위가 아닌 Stage 2에서 도입된 패턴. **P2 기록 권고**.
4. 나머지 항목은 현재 규모에서 체감 영향이 없으므로 backlog P2에 기록만 남긴다.

---

## backlog.md 반영 제안

### 즉시 반영 (P1)

```
| 20 | appUrl proto 헤더 검증 추가 | `src/app/api/share/notify/route.ts:96` — x-forwarded-proto 헤더를 그대로 사용해 javascript: 등 위험 스키마 삽입 가능. proto를 'https'/'http'로만 허용하는 1줄 수정으로 방어. 출처: docs/valid/optimize-stage-4-report.md SEC-1 |
```

### 후속 기록 (P2)

```
| 21 | stat EPERM/EACCES를 500으로 구분 | `src/app/api/share/notify/route.ts:91-93` — 권한 오류(EPERM/EACCES)도 'File not found.' 400으로 반환. ENOENT만 400, 나머지는 internalError()로 구분 권고. 출처: docs/valid/optimize-stage-4-report.md |
| 22 | isExternalUrl/resolveImageSrc 중복 코드 공용 모듈화 | `view/page.tsx:27-43`, `edit/page.tsx:33-43` — 동일 함수 2곳 복제. src/lib/markdown-utils.ts로 추출 권고. 출처: docs/valid/optimize-stage-4-report.md |
| 23 | Slack 페이로드 toLocaleString 타임존 명시 | `src/lib/webhook.ts:73` — toLocaleString('ko-KR')에 timeZone 옵션 누락. 출처: docs/valid/optimize-stage-4-report.md S-2 |
| 24 | ShareModal onClose useCallback 안정화 | `view/page.tsx:201`, `edit/page.tsx:277` — 인라인 화살표 함수를 useCallback으로 안정화. 출처: docs/valid/optimize-stage-4-report.md C-1 |
```
