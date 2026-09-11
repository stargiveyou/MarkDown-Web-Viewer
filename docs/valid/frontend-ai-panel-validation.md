# 프론트엔드 검증 — AI 패널 (브랜치 `fix/ai-panel-claude-cli-fallback`)

- 검증 일시: 2026-09-11
- 검증 방식: **정적 검토만** (코드 읽기 + grep). 이 PC(Windows)에 Node·`node_modules`가 없어 `typecheck` / `lint` / `test` / `build` / 브라우저 확인은 **미수행**
- 대상 커밋: `ba6052a` (폴백 UX + 401 + AbortController), `09e4657` (왕복 시간 표시) — HEAD `09e4657`, 기준 `2fe6c9b`
- 대상 파일:
  - `src/components/workspace/BottomAiPanel.tsx` (주 대상)
  - `src/types/api.ts` (`AiChatResponse.fallbackCode` / `fallbackHint` 추가)
- 참조 파일: `src/lib/fetcher.ts`, `src/app/api/ai/chat/route.ts`, `src/lib/claude-cli.ts`, `src/middleware.ts`, `src/app/workspace/page.tsx`
- 종합 판정: **FAIL** (FAIL 1건, WARN 10건, UNVERIFIED 2건)

> 판정 기준: FAIL = 검증 체크리스트/보안 불변식/`fetcher.ts` 규약 위반. WARN = 동작은 하지만 수정 권고. UNVERIFIED = 실행 없이는 확정 불가.
> "확인된 사실"은 `파일:라인`으로 지목했고, 추정은 문장에 **(추정)** 을 붙였다.

---

## 항목별 결과

### A. 요청받은 중점 점검 항목 (1~10)

| # | 항목 | 판정 | 근거(파일:라인) |
|---|------|------|------------------|
| 1 | 타이머 누수 — `setInterval` cleanup | PASS | `BottomAiPanel.tsx:88-97` — effect가 `clearInterval`을 반환. `finally`(`:172`)의 `setStartedAt(null)`로 deps가 바뀌며 cleanup 실행. 언마운트 시 cleanup 실행. 연속 요청은 `:102`의 `isLoading` 가드로 겹치지 않으며, 겹치더라도 `startedAt` 변경 → 이전 interval cleanup 후 새로 생성. StrictMode 이중 실행도 interval을 effect 내부에서 만들므로 안전. **단** 요청 중 페이지 이동 시 fetch 자체는 중단되지 않음(→ WARN-6). 패널을 접어도(`isOpen=false`) 틱은 계속 돌아 초당 10회 헤더만 리렌더(→ WARN-7) |
| 2 | `startedAt` 상태 전이 — 모든 경로에서 `finally` 도달 | PASS | 성공(`:142-152`), 예외(`:153-169`), 401 early `return`(`:130-134`) 모두 `try` 내부이므로 `finally`(`:170-174`)가 `clearTimeout` → `setStartedAt(null)` → `setIsLoading(false)`를 실행. 401 경로는 `window.location.href` 대입 후 `return`이므로 이후 state 갱신은 페이지 이탈 전 무해한 no-op |
| 3-a | 경과 시간 기준점·종점 | PASS | 시작: `:116` — `setMessages/setQuery/setIsLoading`은 배칭되어 렌더 전이므로 "전송 클릭" 시점과 동일. 종점: `:150` / `:167` — `res.json()` 파싱 완료 후 `setMessages` 호출 시점. 실제 커밋까지 수 ms 차이가 있으나 사용자 체감 "입력 → 표시"와 실질적으로 일치. `performance.now()`(단조 증가) 선택은 적절 (`:87` 주석과 일치). 다만 `:54` 주석 "패널에 렌더될 때까지"는 엄밀히는 "state 반영 시점까지" — 문구만 과장 |
| 3-b | `formatElapsed()` 1분 경계·반올림 | WARN | `BottomAiPanel.tsx:34-40` — 분기(`< 60`)를 반올림 **전** 원값으로 판단해 `59.95~59.99초` → `"60.0초"`, `119.95~119.99초` → `"1분 60.0초"`로 표시됨(→ WARN-1) |
| 4 | 100ms 틱 리렌더 비용 | WARN | `:75` state가 컴포넌트 최상위에 있어 틱마다 `BottomAiPanel` 전체(`messages.map` `:212-262` 포함)가 리렌더. 메시지 노드가 단순해 현재는 체감 비용 낮음 **(추정)** 이나, 30~120초 대기 × 10회/초 = 300~1,200회 전체 리렌더. 분리 방안은 WARN-7 참조 |
| 5-a | 401 → `/login` 리다이렉트 **동작** | PASS | `:130-134` — 401이면 `/login`으로 이동. 미들웨어(`src/middleware.ts:106-108`)가 `/api/*`에 401 JSON을 주므로 경로 자체는 유효 |
| 5-b | 401 처리 **일관성** (프로젝트 패턴) | FAIL | 프로젝트의 모든 클라이언트 API 호출은 `apiFetch`(`src/lib/fetcher.ts:117`)를 경유하고 401은 `redirectToLogin()`(`fetcher.ts:83-89`)이 처리한다. `BottomAiPanel.tsx:123`은 **코드베이스에서 유일한 raw `fetch`** (grep: `src/components`·`src/app/**/page.tsx` 중 raw fetch는 이 1건). `fetcher.ts:4-5` 헤더가 "raw fetch를 직접 쓰면 … frontend-validator가 FAIL로 잡는다"고 명시. 하드 네비게이션(`window.location`) 자체는 `fetcher.ts:88`의 `window.location.assign`과 같은 방식이므로 **Next router를 쓸 필요는 없음**. 문제는 래퍼 우회 + `?next=` 복귀 경로 누락(→ FAIL-1) |
| 6 | 에러 표면화 — `HTTP ${status}` 뭉뚱그림 | WARN | `:137` — 서버가 준 `ApiError.message`를 읽지 않고 버림. 예: 1글자 질문 → 서버 400 `"질문은 2자 이상 입력해 주세요."`(`route.ts:41-42`)가 `"(HTTP 400)"`으로 표시. 500/502 구분 요구(CLAUDE.md "API 계약")도 숫자만 노출. `apiFetch`는 `pickMessage`(`fetcher.ts:61-67`) + `DEFAULT_MESSAGES`(`:38-47`)로 이미 해결하고 있음(→ FAIL-1 수정 시 함께 해소, WARN-5) |
| 7-a | 실시간 카운터의 스크린리더 과다 낭독 | PASS | `:269-271` 카운터에 `aria-live` 없음 → 100ms마다 낭독되지 않음 |
| 7-b | 로딩 상태가 보조기기에 전달되는가 | WARN | `:265-272` 로딩 줄에 `role="status"`/`aria-live` 없음 → "생성 중" 자체가 낭독되지 않음. 메시지 영역(`:211`)에 `role="log"` 없음 → 새 답변 도착도 낭독되지 않음(→ WARN-8) |
| 7-c | 폴백 경고가 색상에만 의존하지 않는가 | PASS | `:226-230` — 배지에 텍스트 `"Claude CLI 응답 없음"` + `AlertTriangle` 아이콘 존재 |
| 7-d | 배지 텍스트의 정확성 | WARN | `:166` — 클라이언트 측 오류(400·500·네트워크 단절·AbortError)에도 `isFallback: true`를 박아 `"Claude CLI 응답 없음"` 배지가 붙음. 400 검증 실패나 오프라인 상황은 CLI와 무관해 사용자를 오도(→ WARN-4) |
| 8 | 반응형 — 로딩 줄·말풍선 정렬 | WARN | `:265` 컨테이너에 `flex-wrap` 없고, `:269` 카운터에 `shrink-0 whitespace-nowrap` 없음 → 좁은 폭에서 `"1분 5.2초"`가 `"1분"`/`"5.2초"`로 줄바꿈 가능 **(추정, 미실행)**. 말풍선(`:218` `max-w-[85%]`)과 시간 행(`:255-260`)은 같은 `flex-col items-start` 래퍼(`:215`) 안에 있어 좌측 정렬 일치 — 문제 없음(→ WARN-9) |
| 9 | 다크 톤 일관성 — 앰버 팔레트 | WARN(경미) | 앰버 계열(`:222` `amber-950/40` 배경 + `amber-100` 본문, `:227` `amber-400` 배지)은 대비 충분 **(계산 추정 ≥ 7:1)**. 문제는 **시간 표기**: `:256`, `:269`의 `text-slate-500`(#64748b)이 `bg-slate-900/95` 위에서 약 **3.7:1** — 11px 텍스트에 WCAG AA(4.5:1) 미달 **(색상값 기반 계산)**. 앰버 말풍선 안의 파일 칩 구역(`:236-237`)은 `slate-700`/`slate-400`을 그대로 써 팔레트가 섞임(→ WARN-10) |
| 10-a | 타입 정합 — `elapsedMs` 위치 | PASS | `elapsedMs`는 클라이언트 측 측정값이므로 `MessageItem`(`:57`)에만 있고 서버 계약 `AiChatResponse`에 없는 것이 **옳다**. `AiChatResponse`는 공유 모듈에서 import(`:21`), 로컬 중복 정의 없음 |
| 10-b | 미사용 import / 타입 오류 | PASS (정적) | lucide 8개 import(`:11-20`) 전부 사용(`AlertTriangle:228`, `Bot:266`, `ChevronDown/Up:203`, `Clock:257`, `FileText:246`, `Send:293`, `Sparkles:191`). `err instanceof DOMException && err.name === 'AbortError'`(`:155`)는 브라우저 fetch abort의 정확한 판별식. `React.FormEvent`(`:99`) 무-import 사용은 `CreateFolderModal.tsx:35`와 동일 패턴. `fallbackCode`/`fallbackHint`(`api.ts:391-394`)는 클라이언트에서 미사용 — 타입 오류는 아니지만 활용 여지(WARN-4 참조). **tsc 실행은 미수행** |
| 10-c | `useEffect` 내부 동기 `setState` lint | UNVERIFIED | `:91` `setPendingElapsedMs(0)`는 코드베이스에서 유일한 "effect 본문 직접 setState". 설치된 `eslint-plugin-react-hooks`는 **7.1.1**(`package-lock.json:5353-5354`)이며, 이 계열의 `recommended`에는 `react-hooks/set-state-in-effect` 규칙이 포함된다 **(기억 기반 추정 — `node_modules` 부재로 확정 불가)**. 활성 상태라면 `npm run lint`가 이 줄에서 실패한다(→ WARN-2 수정으로 함께 해소) |

### B. 프론트엔드 공통 체크리스트 (변경 범위 내)

| # | 항목 | 판정 | 근거(파일:라인) |
|---|------|------|------------------|
| 11 | 전역 fetch 래퍼 경유 | FAIL | `BottomAiPanel.tsx:123` raw `fetch` (FAIL-1) |
| 12 | 429 → rate limited 토스트 | FAIL(FAIL-1에 포함) | 래퍼 우회로 429 토스트 없음. 현재 `/api/ai/chat`에 서버 rate limit은 없으나(`route.ts` 전체) ngrok 엣지가 429를 낼 수 있음 **(추정)** |
| 13 | 공유 타입 모듈 import | PASS | `:21` |
| 14 | Webhook URL / 시크릿 클라이언트 노출 | PASS | 파일 내 `WEBHOOK`, `SECRET` 없음 |
| 15 | 스코프 드리프트 (fs / FTP / 카카오) | PASS | 파일 내 해당 흔적 없음 |
| 16 | 로딩 / 빈 상태 / 에러 상태 | PASS | 로딩 `:264-273`, 에러는 메시지로 삽입 `:160-169`, 빈 상태는 환영 메시지 `:64-70`로 대체 |
| 17 | 키보드 접근성 | WARN(기존) | 헤더 토글이 `div onClick`(`:185-188`) — `button`/`tabIndex`/`onKeyDown` 없음. 입력창(`:279-286`) `aria-label` 없음, `disabled={isLoading}`로 응답 대기 중 포커스가 빠져나가 응답 후 다시 클릭해야 함. **모두 `0ec655a`(main)에서 유입된 기존 문제**로 이번 diff가 만든 것은 아님 |
| 18 | 서버 타임아웃 < 클라이언트 타임아웃 | PASS | 서버 기본 120s(`claude-cli.ts:58`) < 클라이언트 150s(`:28`). 단 `.env.local.example:98-100`에 "150초 이상으로 올리면 클라이언트가 먼저 끊긴다"는 안내가 없음(INFO) |

---

## FAIL 상세

### FAIL-1. 전역 fetch 래퍼(`apiFetch`) 우회 — 401을 수동으로 재구현하고 `next` 복귀 경로·429·서버 메시지를 잃음

- **위치**: `src/components/workspace/BottomAiPanel.tsx:123-138`
- **무엇이 잘못됐는가**
  - 프로젝트 규약(`src/lib/fetcher.ts:2-9`): "**모든** API 호출은 이 래퍼를 경유한다. raw `fetch`를 직접 쓰면 401 리다이렉트와 429 처리가 누락되므로 frontend-validator가 FAIL로 잡는다."
  - `BottomAiPanel.tsx:123`은 `src/components`·`src/app/**/page.tsx`를 통틀어 **유일한 raw `fetch`**. 나머지 컴포넌트(`CreateFolderModal.tsx:47`, `ShareModal.tsx:44`, `MoveModal`, `UploadHistoryModal`, 각 page)는 전부 `apiFetch` + `toApiRequestError` + `if (err.code !== 401)` 패턴.
  - 이 브랜치(`ba6052a`)는 바로 이 호출 지점을 수정하면서(`signal` 추가, 401 분기 추가) 래퍼로 갈아타는 대신 **401 처리를 병렬 구현**했다. 결과:
    1. `:132` `window.location.href = '/login'` — `fetcher.ts:87-88`과 달리 `?next=/workspace?path=...`를 싣지 않아 로그인 후 원래 폴더로 돌아오지 못한다.
    2. 429 토스트 없음(`fetcher.ts:97-99`의 `emitToast` 미경유).
    3. `:137` — 서버 `ApiError.message`를 버리고 `HTTP ${status}`만 표시. 1글자 질문 시 `route.ts:41-42`의 안내 문구가 사라진다.
    4. `res.json()`이 비-JSON(ngrok 에러 HTML 등)이면 `SyntaxError` 원문("Unexpected token <…")이 `:157-158`을 거쳐 사용자에게 그대로 노출된다. `apiFetch`는 `parseJson`(`fetcher.ts:69-77`)으로 막고 있다.
- **재현 절차**
  1. 로그인 후 `/workspace?path=some/folder`에서 AI 패널을 연다.
  2. 다른 탭에서 로그아웃(세션 쿠키 제거).
  3. AI 패널에 질문 전송 → `/login`으로 이동하지만 URL에 `next`가 없어 로그인 후 `/workspace` 루트로 떨어진다. (같은 상황에서 검색창·폴더 생성은 원래 폴더로 복귀한다.)
  4. 별도로: 질문에 `"a"` 한 글자 입력 후 전송 → `"오류가 발생했습니다: AI 질의 응답 요청에 실패했습니다. (HTTP 400)"` 표시. 서버 메시지 `"질문은 2자 이상 입력해 주세요."`는 보이지 않는다.
- **기대 동작**: 다른 컴포넌트와 동일하게 `apiFetch<AiChatResponse>('/api/ai/chat', { method: 'POST', body: JSON.stringify({ query }), signal })` 호출, `catch`에서 `toApiRequestError(err)` 후 `err.code === 401`이면 조용히 return, 그 외에는 `err.message`를 메시지로 삽입.
- **관련 불변식**: 보안 불변식 1(401 → `/login`)의 **클라이언트 측 단일 구현 원칙**(`fetcher.ts:7`), 프론트 검증 체크리스트 "인증 — 래퍼를 우회하는 raw fetch 호출".
- **수정 시 주의**: `apiFetch`는 `fetch` 예외를 전부 502로 접는다(`fetcher.ts:126-129`) → `AbortError`가 "서버에 연결할 수 없습니다"로 바뀌어 `:155-156`의 타임아웃 전용 메시지가 사라진다. `fetcher.ts:126`의 `catch`에서 `err instanceof DOMException && err.name === 'AbortError'`면 **그대로 rethrow**하도록 1~2줄 보강이 필요하다(계약 무관, 공유 모듈 변경이므로 `tech-lead` 확인 권고). 또는 `apiFetch`에 `timeoutMs` 옵션을 추가해 래퍼가 `AbortController`를 소유하게 하는 방법도 있다.
- **비고**: raw `fetch`는 `0ec655a`(이미 main)에서 도입됐고 당시 검증 리포트가 없었다(`docs` 내 `ai/chat`·`BottomAiPanel` 언급 0건). 즉 main에도 존재하는 문제이지만, 이 브랜치가 해당 지점을 손대며 위반을 **고착**시켰으므로 이 브랜치에서 바로잡는 것이 맞다.

---

## WARN 상세

### WARN-1. `formatElapsed()` 분 경계 반올림 오류
- `BottomAiPanel.tsx:34-40`
- `59.96초` → `totalSeconds < 60` 참 → `"60.0초"` (기대: `"1분 0.0초"`). `119.96초` → `"1분 60.0초"`.
- 수정 방향: 먼저 0.1초 단위로 반올림한 뒤 분기.
  ```ts
  const tenths = Math.round(ms / 100);          // 0.1초 단위 정수
  const totalSeconds = tenths / 10;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}초`;
  ```
  (`59.96` → `tenths=600` → `60.0` → 분 분기로 감.)

### WARN-2. 다음 요청 첫 프레임에 이전 요청의 경과 시간이 잠깐 보임
- `:91`에서 리셋하지만 `useEffect`는 **paint 이후**에 실행된다. 흐름: `finally`(`:172-173`) 이후 `pendingElapsedMs`는 마지막 틱 값(예: 33,700ms)으로 남음 → 다음 전송에서 `setIsLoading(true)`+`setStartedAt(x)` 배칭 렌더 → 로딩 줄이 `"33.7초"`로 한 프레임 그려짐 → effect가 `0`으로 리셋.
- 수정 방향: `:117` `setStartedAt(requestStartedAt)` 직전에 `setPendingElapsedMs(0)`를 두고 `:91`을 삭제한다. 이렇게 하면 10-c의 `set-state-in-effect` 우려도 함께 사라진다.

### WARN-3. (10-c) `react-hooks/set-state-in-effect` 규칙 — UNVERIFIED
- `:91`. `eslint-plugin-react-hooks 7.1.1`. 맥미니에서 `npm run lint` 실행으로 확정할 것. WARN-2 수정으로 예방 가능.

### WARN-4. 클라이언트 오류에 "Claude CLI 응답 없음" 배지가 붙음
- `:166` `isFallback: true` → `:226-230` 배지. 400(입력 검증), 네트워크 단절, 150초 클라이언트 abort, 500(검색 색인 실패) 모두 CLI와 무관하거나 무관할 수 있다.
- 수정 방향: `MessageItem`에 `kind?: 'fallback' | 'error'`를 두고 배지 문구를 분리(`fallback` → "Claude CLI 응답 없음 · 검색 결과로 대체", `error` → "요청 실패"). 서버가 이미 주는 `fallbackCode`(`api.ts:391`)를 받아 `TIMEOUT` → "응답 시간 초과", `CLI_NOT_FOUND` → "CLI 미탐지"처럼 배지 라벨을 세분화하면 타입 추가의 의미도 살아난다(현재 `fallbackCode`/`fallbackHint`는 클라이언트에서 읽지 않는다).

### WARN-5. 상태코드별 사용자 행동 안내 부재
- `:137`. 이 라우트가 실제로 낼 수 있는 코드는 400·401·500(`route.ts:37, 42, 93`) + 엣지(ngrok) 4xx/5xx. 413/415는 이 라우트와 무관.
- FAIL-1 수정으로 `DEFAULT_MESSAGES`(`fetcher.ts:38-47`)와 서버 메시지가 자동 적용되어 해소된다. 500("서버에서 문제가…")과 502("서버에 연결할 수 없습니다")가 CLAUDE.md 요구대로 구분된다.

### WARN-6. 언마운트 시 진행 중 요청을 중단하지 않음
- `:119-120`의 `AbortController`는 타임아웃 전용. 대기 중 사이드바·달력 버튼으로 `/workspace/view`·`/workspace/calendar`로 이동하면 `BottomAiPanel`이 언마운트되지만 fetch는 최대 150초 살아 있고, 완료 시 `setMessages` 등이 언마운트된 컴포넌트에 호출된다. React 19는 이를 조용히 무시하므로 **콘솔 경고는 없다**(누수도 아님, 응답 후 GC). 다만 불필요한 대기·클로저 보유.
- 수정 방향: `const abortRef = useRef<AbortController | null>(null)` + `useEffect(() => () => abortRef.current?.abort(), [])`.

### WARN-7. 100ms 틱이 패널 전체를 리렌더
- `:75` state 위치. 제안: 틱 state를 leaf 컴포넌트로 격리.
  ```tsx
  function ElapsedTicker({ startedAt }: { startedAt: number }) {
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
      const id = setInterval(() => setElapsed(performance.now() - startedAt), ELAPSED_TICK_MS);
      return () => clearInterval(id);
    }, [startedAt]);
    return <span className="…">{formatElapsed(elapsed)}</span>;
  }
  ```
  부모는 `startedAt`만 내려주므로 `messages.map`이 틱마다 재실행되지 않는다. 추가로 `isOpen`이 false일 때는 `<ElapsedTicker>`가 렌더되지 않으므로 접힌 상태의 틱 리렌더도 자연히 사라진다(현재는 `:88-97`이 `isOpen`과 무관하게 돈다).

### WARN-8. 접근성 — 로딩/메시지 영역 live region 부재
- `:265-272` 로딩 줄: `role="status" aria-live="polite"`를 문구 `<span>`(`:267`)을 감싸는 요소에 부여하고, 카운터 `<span>`(`:269`)에는 `aria-hidden="true"`를 붙여 100ms 낭독을 막는다(현재는 live region이 아예 없어 낭독 과다는 없지만 "생성 중"도 전달되지 않는다).
- `:211` 메시지 컨테이너: `role="log" aria-live="polite"` 권고.
- 기존 문제(0ec655a 유입, 이번 diff 범위 밖): 헤더 토글 `div onClick`(`:185`), 입력창 라벨 부재(`:279`), 로딩 중 `disabled`로 인한 포커스 이탈(`:285`).

### WARN-9. 반응형 — 카운터 줄바꿈
- `:265` 컨테이너에 `flex-wrap`, `:269` 카운터에 `shrink-0 whitespace-nowrap` 추가 권고. **(실행 미확인 — 아래 맥미니 확인 항목 참조)**

### WARN-10. 대비 — `text-slate-500` 11px
- `:256`, `:269`. `#64748b` on `#0f172a` ≈ 3.7:1 (계산값). `text-slate-400`(≈ 7:1)으로 상향 권고. 앰버 말풍선 내부 칩 구역(`:236-237`)의 `slate` 보더/라벨은 `amber-700/40`·`amber-200/70` 등으로 맞추면 톤이 정리된다(경미).

---

## 실행 검증 미수행 — 맥미니에서 확인할 항목

이 PC에는 Node가 없어 아래는 **눈으로/명령으로 직접 확인**해야 한다.

| # | 확인 방법 | 기대 결과 | 관련 |
|---|-----------|-----------|------|
| M-1 | `npm run lint` | `BottomAiPanel.tsx:91`에서 `react-hooks/set-state-in-effect` 오류가 나는지 | 10-c / WARN-3 |
| M-2 | `npm run typecheck` | 오류 0 | 10-b |
| M-3 | `npm test` | `claude-cli.test.ts` 포함 전체 통과 (백엔드 범위지만 같은 브랜치) | — |
| M-4 | 패널 열고 질문 전송 → 응답 도착 직후 **같은 입력창에 즉시 두 번째 질문** 전송 | 로딩 줄이 `0.0초`부터 시작하는지, 이전 값(예 `33.7초`)이 한 프레임이라도 보이는지 | WARN-2 |
| M-5 | 질문 전송 후 대기 중 패널 접기(`접기`) → 5초 후 다시 펼치기 | 카운터가 누적된 값(≈5초+)으로 이어지는지, React DevTools Profiler에서 접힌 동안 초당 10회 커밋이 발생하는지 | 1 / WARN-7 |
| M-6 | 질문 전송 후 대기 중 달력 버튼으로 `/workspace/calendar` 이동 → 브라우저 Network 탭 | `/api/ai/chat` 요청이 취소되지 않고 계속 pending인지(현재 코드 기대: pending 유지). 콘솔에 state 업데이트 경고가 없는지(React 19 기대: 없음) | WARN-6 |
| M-7 | `AI_CLI_TIMEOUT_MS=5000`으로 서버 재시작 후 질문 | 앰버 말풍선 + `"Claude CLI 응답 없음"` 배지 + 답변 본문에 `"사유: … 5초 안에 오지 않았습니다"` 포함, 시간 표기 `응답까지 5.x초` | 폴백 UX |
| M-8 | DevTools Network → Offline 상태에서 질문 | 앰버 말풍선에 `"오류가 발생했습니다: Failed to fetch"`(현재 코드) — 배지 문구가 "Claude CLI 응답 없음"으로 나오는 오도 확인 | WARN-4 |
| M-9 | 다른 탭에서 로그아웃 후 질문 전송 | `/login`으로 이동. URL에 `?next=`가 **없음**(현재 코드) — 로그인 후 루트로 떨어짐 확인 | FAIL-1 |
| M-10 | 입력창에 `a` 한 글자 입력 후 전송 | `"(HTTP 400)"` 표시 — 서버 문구 미노출 확인 | FAIL-1 / WARN-5 |
| M-11 | DevTools로 뷰포트 360px 설정, 질문 전송 | 로딩 줄에서 `1분 5.2초`가 두 줄로 쪼개지는지(60초 이상 대기 필요 — `AI_CLI_TIMEOUT_MS`를 70000으로 두고 CLI가 없는 환경에서 재현 가능) | WARN-9 |
| M-12 | macOS VoiceOver 켜고 질문 전송 | 로딩 시작·답변 도착이 낭독되는지(현재 코드 기대: 둘 다 낭독 안 됨), 카운터가 반복 낭독되지 않는지(기대: 낭독 안 됨) | WARN-8 |
| M-13 | 정상 응답 1회 (실측 30초대) | `응답까지 3x.x초` 표기가 DevTools Network의 요청 Time과 ±0.1초 내 일치하는지 | 3-a |
| M-14 | `ELAPSED_TICK_MS` 동안 `formatElapsed` 경계값 수동 호출: 브라우저 콘솔에서 `formatElapsed`를 export하지 않으므로 코드 복사 후 `f(59960)`, `f(60000)`, `f(119960)` | `"60.0초"`, `"1분 0.0초"`, `"1분 60.0초"` — 앞·뒤 두 값의 오류 재현 | WARN-1 |

---

## 머지 가능 여부

**현재 상태로는 머지 불가 (FAIL 1건).**

- 차단 사유는 FAIL-1 하나이며, 수정 범위는 작다: `BottomAiPanel.tsx:122-138`을 `apiFetch` + `toApiRequestError` 패턴으로 교체(약 15줄) + `fetcher.ts:126` `catch`에서 `AbortError` rethrow(2줄). 이 수정으로 WARN-5도 함께 해소된다.
- FAIL-1 수정 시 **같이 처리 권고**(모두 같은 파일, 각 1~5줄): WARN-1(반올림), WARN-2(리셋 위치 이동 — WARN-3 예방), WARN-4(배지 분리), WARN-9(`shrink-0`), WARN-10(`slate-400`).
- WARN-6, WARN-7, WARN-8은 후속 커밋으로 미뤄도 무방하다. 단 WARN-8 중 기존 유입분(토글 키보드 접근성)은 백로그 등재 권고.
- 재검증 시 M-1 ~ M-3(lint/typecheck/test)와 M-9, M-10은 반드시 실행할 것.

### `docs/plan/backlog.md` 되돌림 제안 (FAIL)

```
### [P0] AI 패널 raw fetch → apiFetch 전환 (401 next 복귀·429·서버 메시지 누락)
- 출처: docs/valid/frontend-ai-panel-validation.md — FAIL-1
- 위반: 보안 불변식 1(클라이언트 측 단일 구현, src/lib/fetcher.ts:2-9), 프론트 체크리스트 "래퍼 우회 raw fetch"
- 재현: 로그아웃 상태에서 AI 패널 질문 전송 → /login 이동 시 ?next= 없음. "a" 1글자 전송 → "(HTTP 400)"만 표시
- 담당: frontend-dev (fetcher.ts AbortError rethrow는 tech-lead 확인)
- 상태: 미착수
```

### 백로그 추가 제안 (WARN, P2)

| 항목 | 위치 | 출처 |
|------|------|------|
| AI 패널 헤더 토글 `div onClick` 키보드 접근 불가, 입력창 라벨 부재, 로딩 중 `disabled`로 포커스 이탈 | `BottomAiPanel.tsx:185-188, 279-286` | 본 리포트 WARN-8 (0ec655a 유입) |
| AI 패널 틱 state를 `ElapsedTicker` leaf로 분리 + 언마운트 시 abort | `BottomAiPanel.tsx:75, 119` | 본 리포트 WARN-6/7 |
| `/api/ai/chat` rate limit 부재 — CLI spawn은 고비용이므로 `/api/upload`와 같은 `rate-limit.ts` 적용 검토 | `src/app/api/ai/chat/route.ts` | 본 리포트 B-12 (백엔드 범위, backend-validator 참조용) |
| `.env.local.example` `AI_CLI_TIMEOUT_MS` 주석에 "클라이언트 상한 150초(`REQUEST_TIMEOUT_MS`)를 넘기면 브라우저가 먼저 끊는다" 안내 | `.env.local.example:98-100` | 본 리포트 B-18 |
