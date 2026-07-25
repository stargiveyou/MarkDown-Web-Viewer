# 프론트엔드 검증 — Stage 4 (소셜 공유 UI)

- 검증 일시: 2026-07-25
- 대상 커밋: 4b4ff9feab66fbb29c7673836336fcc77b73d976 (미병합 — 워킹트리 상태)
- 대상 파일:
  - `src/components/workspace/ShareModal.tsx` (신규)
  - `src/app/workspace/view/page.tsx` (수정)
  - `src/app/workspace/edit/page.tsx` (수정)
  - `src/lib/fetcher.ts` (참조)
  - `src/components/ui/Modal.tsx` (참조)
  - `src/types/api.ts` (참조)
- 계약 문서: `docs/agent-work/frontend-stage-4-contract.md`
- 종합 판정: **PASS (FAIL 0건, MINOR 1건)**

---

## 항목별 결과

| # | 항목 | 판정 | 근거 (파일:라인) |
|---|------|------|------------------|
| 1 | ShareModal이 기존 Modal 컴포넌트를 재사용하는가 | PASS | `ShareModal.tsx:14` — `import { Modal } from '@/components/ui/Modal'`; `ShareModal.tsx:77` — `<Modal open={open} title="공유하기" onClose={onClose}>` |
| 2 | Discord / Slack / 링크 복사 세 가지 액션 버튼이 있는가 | PASS | `ShareModal.tsx:86-124` — Discord(`onClick={() => handleShare('discord')}`), Slack(`onClick={() => handleShare('slack')}`), 링크 복사(`onClick={handleCopyLink}`) |
| 3 | Discord/Slack 버튼이 `POST /api/share/notify`를 `apiFetch` 경유로 호출하는가 | PASS | `ShareModal.tsx:39-41` — `await apiFetch<ShareNotifyResponse>('/api/share/notify', { method: 'POST', body: JSON.stringify({ target, filePath }) })` |
| 4 | Copy Link가 `navigator.clipboard.writeText(window.location.href)` 사용 (ADR-004) | PASS | `ShareModal.tsx:66` — `await navigator.clipboard.writeText(window.location.href)` |
| 5 | 401 자동 리다이렉트 (`apiFetch` 경유) | PASS | `fetcher.ts:83-89, 93-94` — `redirectToLogin()`가 401 수신 시 호출됨. ShareModal이 `apiFetch`를 경유하므로 자동 처리됨 |
| 6 | 429 rate limited 토스트 (fetcher 자동 처리) | PASS | `fetcher.ts:97-99` — `emitToast`로 429 토스트. `ShareModal.tsx:54` — `err.code !== 429` 분기로 중복 토스트 방지 |
| 7 | 502 재시도 토스트 표시 | PASS | `ShareModal.tsx:49-53` — `err.code === 502` 시 `"전송에 실패했습니다. 잠시 후 재시도해 주세요."` 토스트 |
| 8 | 400 에러 시 서버 메시지를 토스트로 표시 | PASS | `ShareModal.tsx:54-56` — `err.code !== 401 && err.code !== 429` 조건으로 그 외 에러(400 포함)는 `err.message` 토스트 |
| 9 | 전송 중 해당 버튼에 스피너 표시 | PASS | `ShareModal.tsx:92-95, 107-110` — `sending === 'discord'` / `sending === 'slack'` 조건으로 `Loader2` 스피너 교체 |
| 10 | 전송 중 모든 버튼 비활성화 | PASS | `ShareModal.tsx:88, 103, 118` — 세 버튼 모두 `disabled={sending !== null}` |
| 11 | 성공 토스트에 플랫폼명 포함 | PASS | `ShareModal.tsx:44-45` — `"Discord에 공유되었습니다."` / `"Slack에 공유되었습니다."` |
| 12 | 뷰어 헤더의 공유 버튼 배치 (편집 버튼 왼쪽) | PASS | `view/page.tsx:123-141` — `flex gap-2` 컨테이너 안에서 공유 버튼(124-132)이 편집 버튼(133-140) 앞에 위치 |
| 13 | 편집 헤더의 공유 버튼 배치 (저장 버튼 왼쪽) | PASS | `edit/page.tsx:234-262` — `flex gap-2` 컨테이너 안에서 공유 버튼(235-243)이 저장 버튼(244-262) 앞에 위치 |
| 14 | Modal `aria-modal`, `aria-labelledby` 속성 | PASS | `Modal.tsx:97-99` — `role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}` 모두 선언 |
| 15 | Modal 포커스 트랩 | PASS | `Modal.tsx:53-83` — Tab/Shift+Tab 키다운 핸들러로 포커스 순환 구현 |
| 16 | Modal Esc 닫기 | PASS | `Modal.tsx:57-60` — `Escape` 키 시 `onClose()` 호출 |
| 17 | Webhook URL이 클라이언트 코드에 노출되지 않는가 (보안 불변식 6) | PASS | `src/components/` 및 `src/app/workspace/`에서 `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`, Webhook URL 패턴 미발견. `NEXT_PUBLIC_` 접두사 사용 없음 (`env.ts:5` 주석 참조) |
| 18 | 카카오 SDK / FTP / Node fs 클라이언트 코드 노출 없음 (스코프 드리프트) | PASS | 클라이언트 컴포넌트에서 `kakao`, `basic-ftp`, `require('fs')`, `from 'fs'` 미발견 |
| 19 | "공유 링크를 받은 사람도 로그인이 필요합니다." 안내 텍스트 표시 (ADR-004) | PASS | `ShareModal.tsx:128-130` — 모달 하단에 정확한 문구 표시 |
| 20 | 공유 버튼 `type="button"` 선언 | PASS | `ShareModal.tsx:87, 102, 117` — Discord/Slack/링크 복사 버튼 전부 `type="button"`. `view/page.tsx:125`, `edit/page.tsx:236`의 공유 버튼도 `type="button"` |
| 21 | 포커스 가시성 스타일 (focus-visible) | PASS | `ShareModal.tsx:90, 105, 120` — Discord/Slack/링크 복사 버튼에 `focus-visible:outline-2 focus-visible:outline-offset-2` 적용. `view/page.tsx:127`, `edit/page.tsx:238`의 공유 버튼도 동일 |
| 22 | 타입을 공유 모듈에서 import하는가 (로컬 중복 정의 없음) | PASS | `ShareModal.tsx:17` — `import type { ShareNotifyResponse, ShareTarget } from '@/types/api'` |
| 23 | 그리드 카드 이미지가 `/api/thumbnail` 사용 (원본 직접 로드 금지) | PASS | `GridView.tsx:117, 121, 171, 174` — `entry.coverThumbUrl` 사용 (서버가 `/api/thumbnail?...` 형태로 제공). `view/page.tsx:43`, `edit/page.tsx:43` — 상대 경로를 `/api/thumbnail` URL로 변환 |
| 24 | 검색 입력 디바운스 | PASS | `SearchBar.tsx:81-83` — `setTimeout(doSearch, 300)` 디바운스 구현 |
| 25 | `PUT /api/file-content`에 `baseMtime` 전송 | PASS | `edit/page.tsx:115-119` — `SaveFileRequest` 바디에 `baseMtime: baseMtimeRef.current` 포함 |
| 26 | 409 응답 시 비파괴적 경고 + 선택지 제공 | PASS | `edit/page.tsx:132-134` — 409 시 `setConflict(true)` + `ConflictWarning.tsx` 표시. `ConflictWarning.tsx:53-66` — "내용 복사" + "새로고침" 버튼 제공. 덮어쓰기 버튼 없음 |
| 27 | 반응형 레이아웃 (모바일 2열 / md 4열) | PASS | `GridView.tsx:47` — `grid-cols-2 md:grid-cols-4` |
| 28 | 모든 fetch 지점에 로딩/빈 상태/에러 상태 | PASS | `view/page.tsx:147-168` — 로딩 스피너, 에러 배너, 빈 상태. `edit/page.tsx:181-206` — 동일. `GridView.tsx:35-43` — 빈 폴더 상태 |
| 29 | `npm run typecheck` 통과 | PASS | 실행 결과 오류 0건 |
| 30 | `npm run lint` 통과 | PASS | 실행 결과 오류 0건 |
| 31 | `npm run build` 통과 | PASS | Turbopack 빌드 성공, 17개 정적/동적 라우트 생성 완료. 경고 1건(NFT `next.config.ts`) — Stage 이전부터 존재하는 known warning |
| 32 | 링크 복사 버튼의 disabled 시각적 피드백 | MINOR | `ShareModal.tsx:120` — `disabled={sending !== null}` 속성 있으나 `disabled:cursor-not-allowed disabled:opacity-60` CSS 클래스 누락 (Discord/Slack 버튼에는 있음). 기능 동작은 정상이나 시각적 일관성 결여 |

---

## FAIL 상세

FAIL 항목 없음.

---

## MINOR 상세

### [MINOR] 링크 복사 버튼 disabled 시각적 피드백 누락

- 파일: `src/components/workspace/ShareModal.tsx:120`
- 현상: Discord/Slack 버튼(라인 90, 105)은 전송 중 `disabled:cursor-not-allowed disabled:opacity-60` 스타일이 적용되어 시각적으로 비활성 상태를 표시하지만, 링크 복사 버튼은 `disabled={sending !== null}` HTML 속성은 있으나 동일 CSS 클래스가 없음.
- 기대 동작: 세 버튼 모두 `disabled` 상태에서 동일한 시각적 피드백 제공.
- 영향: 기능상 버튼 동작은 정상 차단됨. 시각적 일관성만 결여.
- 관련 계약: `frontend-stage-4-contract.md` §스타일 — 링크 복사 버튼 클래스 명세에 `disabled:` 수식어가 누락되어 있어 계약과 구현 모두 동일하게 누락됨.
- 판정: FAIL 수준 아님 (기능은 정상). 하지만 접근성 일관성 차원에서 `backlog.md` P2 추가 권고.

---

## 검증 근거 요약

### 보안 불변식 준수

- **불변식 1 (세션 보호)**: `apiFetch`가 401 수신 시 `/login?next=...`으로 자동 리다이렉트. `fetcher.ts:83-89`.
- **불변식 5 (409 비파괴)**: `ConflictWarning`이 "내용 복사 + 새로고침" 선택지만 제공하며 덮어쓰기 없음. `ConflictWarning.tsx:6-7`.
- **불변식 6 (Webhook URL 클라이언트 미노출)**: `src/components/`, `src/app/workspace/`에서 `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`, `NEXT_PUBLIC_` 패턴 전무.

### ADR 준수

- **ADR-004 (토큰 기반 공개 링크 금지)**: Copy Link는 `window.location.href` (인증된 앱 URL)를 복사하고 "공유 링크를 받은 사람도 로그인이 필요합니다." 안내 표시. `ShareModal.tsx:66, 128-130`.
- **ADR-004 (카카오 SDK 금지)**: 클라이언트 코드 전체에서 카카오 SDK 흔적 없음.

### 엔드포인트 계약 준수

`POST /api/share/notify` 호출 형태가 계약과 일치:
- 경로: `ShareModal.tsx:39` — `/api/share/notify`
- 메서드: `POST`
- 바디: `{ target, filePath }` — `ShareNotifyRequest` 타입과 일치
- 응답 타입: `ShareNotifyResponse` — `src/types/api.ts:226-229`에서 import

### 정적 게이트 결과

| 게이트 | 결과 | 비고 |
|--------|------|------|
| `npm run typecheck` | PASS | 오류 0건 |
| `npm run lint` | PASS | 오류 0건 |
| `npm run build` | PASS | 17개 라우트 성공 |
