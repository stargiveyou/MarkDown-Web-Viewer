# 개발이 진행된 목록 (Completed)

> 검증(`docs/valid/`)을 **통과한 항목만** 이 문서로 이동한다.
> 개별 완료 기록의 원문은 [docs/complete-work/](../complete-work/)에 있다.
> 검증 FAIL 항목은 여기 기록하지 않고 [backlog.md](backlog.md)로 되돌린다.

---

## 요약

| 단계 | 상태 | 완료일 | 검증 리포트 |
|------|------|--------|-------------|
| Stage 0 스캐폴딩 | ✅ 완료 | 2026-07-23 | 빌드/타입체크/테스트 통과 |
| Stage 1 인증 + 업로드 | ✅ 완료 | 2026-07-24 | [qa-stage-1-validation.md](../valid/qa-stage-1-validation.md) |
| Stage 2 GridView + 뷰어 + 편집 | ✅ 완료 | 2026-07-24 | [qa-stage-2-validation.md](../valid/qa-stage-2-validation.md) |
| Stage 3 검색 · 정렬 · 태그 | ✅ 완료 | 2026-07-25 | [qa-stage-3-validation.md](../valid/qa-stage-3-validation.md) |
| Stage 4 소셜 공유 | ✅ 완료 | 2026-07-25 | [qa-stage-4-validation.md](../valid/qa-stage-4-validation.md) |
| Stage 5 업로드 알림 | ✅ 완료 | 2026-07-25 | [qa-stage-5-validation.md](../valid/qa-stage-5-validation.md) |
| Stage 6 AI 파일 탐색 패널 (부가) | 🔵 검증중 — **main 병합됨, 맥미니 게이트 미통과** | — | [frontend](../valid/frontend-ai-panel-validation.md) / [backend](../valid/backend-ai-panel-validation.md) (정적 검토), [게이트 목록](stage-6-macmini-gate.md) |

---

## 완료 이력

### 2026-07-22 — 프로젝트 셋업
- 기획 문서 3종 확정 반영 → [CLAUDE.md](../../CLAUDE.md) 생성
- 팀 서브에이전트 8종 정의 (`.claude/agents/`)
  - 개발(opus): `tech-lead`, `frontend-dev`, `backend-dev`, `security-auth`
  - 검증·최적화(fable): `frontend-validator`, `backend-validator`, `qa-integration`, `optimizer`
- 작업 폴더 규약 수립: `src/` · `docs/agent-work/` · `docs/valid/` · `docs/complete-work/` · `docs/plan/`

### 2026-07-23 — Stage 0: 스캐폴딩
- 담당: `tech-lead`
- 산출물: Next.js 16 + React 19 + Tailwind v4 골격, [src/types/api.ts](../../src/types/api.ts)(공유 계약), `src/lib/*` 스텁 5종, Vitest 환경
- 런타임: **Node v19.1.0 → v22.23.1 업그레이드** (`~/.local/node-v22.23.1-darwin-x64`, sudo 불필요 방식)
- 검증: build ✅ / typecheck ✅ / test 2 passed ✅ / lint 0 errors(12 warnings = 스텁 미구현 표식)
- 실증: **FTS5 trigram 한글 부분일치 확인** — ADR-007 가정 검증 완료
- 완료 기록: [stage-0-tech-lead-complete.md](../complete-work/stage-0-tech-lead-complete.md)

### 2026-07-23 — Stage 1 Wave 1-A: 보안 · 인증 기반
- 담당: `security-auth`
- 산출물: [src/middleware.ts](../../src/middleware.ts)(전 경로 세션 보호),
  [src/lib/path-safety.ts](../../src/lib/path-safety.ts)(보안 불변식 2 단일 유틸),
  [src/lib/session.ts](../../src/lib/session.ts)(scrypt + HMAC 서명 쿠키),
  [src/lib/env.ts](../../src/lib/env.ts), [src/lib/rate-limit.ts](../../src/lib/rate-limit.ts),
  [src/lib/password-hash.ts](../../src/lib/password-hash.ts), `src/scripts/hash-password.mts`,
  `.env.local`(gitignore 대상)
- 검증: [security-stage-1-validation.md](../valid/security-stage-1-validation.md) — **PASS (FAIL 0건)**
  - typecheck ✅ / test **80 passed** ✅ / lint 0 errors 0 warnings ✅ / build ✅
  - traversal 유닛 테스트 53건: `../` · 절대경로 · 인코딩 · **실제 심볼릭 링크** 4종 전부
  - 실서버 curl 15종 인증 시나리오 통과, 클라이언트 번들 시크릿 유출 0건
- 부수 효과: 스텁 미구현 lint 경고 12건 해소
- 완료 기록: [stage-1-security-complete.md](../complete-work/stage-1-security-complete.md)
- 설계 결정: [security-stage-1-decisions.md](../agent-work/security-stage-1-decisions.md)

### 2026-07-23 — Stage 1 Wave 1-B: 프론트엔드 클라이언트
- 담당: `frontend-dev`
- 산출물: [src/lib/fetcher.ts](../../src/lib/fetcher.ts)(401 리다이렉트·429 토스트),
  [src/app/login/page.tsx](../../src/app/login/page.tsx),
  [src/components/upload/](../../src/components/upload/)(드롭존·모달),
  [src/components/ui/](../../src/components/ui/)(토스트·모달),
  [src/app/workspace/page.tsx](../../src/app/workspace/page.tsx)
- 검증: [frontend-stage-1-validation.md](../valid/frontend-stage-1-validation.md) — 원래 FAIL 2건(F1 targetPath, F2 문서 드리프트), 수정 후 해소
- 완료 기록: [stage-1-frontend-complete.md](../complete-work/stage-1-frontend-complete.md)

### 2026-07-23 — Stage 1 Wave 2: 백엔드 라우트
- 담당: `backend-dev`
- 산출물: [src/app/api/auth/login/route.ts](../../src/app/api/auth/login/route.ts),
  [src/app/api/auth/logout/route.ts](../../src/app/api/auth/logout/route.ts),
  [src/app/api/upload/route.ts](../../src/app/api/upload/route.ts)
- 검증: [backend-stage-1-validation.md](../valid/backend-stage-1-validation.md) — **PASS (FAIL 0건)**
  - 실서버 curl 32종 E2E 전부 통과, 보안 불변식 8개 전항 PASS
- 완료 기록: [stage-1-backend-complete.md](../complete-work/stage-1-backend-complete.md)
- 설계 결정: [backend-stage-1-decisions.md](../agent-work/backend-stage-1-decisions.md)

### 2026-07-24 — Stage 1 Wave 4: QA 통합 검증 + 최적화
- 담당: `qa-integration`, `optimizer`
- 검증: [qa-stage-1-validation.md](../valid/qa-stage-1-validation.md) — **PASS (FAIL 0건, UNVERIFIED 2건 비차단)**
  - typecheck ✅ / test **106 passed** ✅ / lint 0 errors 0 warnings ✅ / build ✅
  - 보안 불변식 8개 전항 PASS, API 계약 8개 항목 PASS, E2E 22종 PASS
  - 프론트 FAIL 2건(F1, F2) 해소 확인
- 최적화 리포트: [optimize-stage-1-report.md](../valid/optimize-stage-1-report.md)
  - 오류 2건(XHR withCredentials, Toaster ref 타이밍), 성능 개선 제안 4건 → backlog P2로 추적

### 2026-07-24 — Stage 2 Wave 1: 백엔드 라우트 (GridView/뷰어/편집용)
- 담당: `backend-dev`
- 산출물: [src/app/api/files/route.ts](../../src/app/api/files/route.ts)(폴더 목록),
  [src/app/api/file-content/route.ts](../../src/app/api/file-content/route.ts)(파일 읽기·저장),
  [src/app/api/thumbnail/route.ts](../../src/app/api/thumbnail/route.ts)(sharp 썸네일)
- 검증: [backend-stage-2-validation.md](../valid/backend-stage-2-validation.md) — **PASS (FAIL 0건)**
  - typecheck ✅ / test **106 passed** ✅ / lint 0 errors ✅ / build ✅
  - 계약 준수: FilesResponse, FileContentResponse, SaveConflictResponse 정확 일치
  - 보안: 경로 2단 검증(resolveUnderRoot + assertRealPathUnderRoot) + atomic write + 409 충돌 + 정보 비노출
  - 기술: gray-matter 마크다운 파싱, sharp webp 리사이즈, 디스크 캐시(mtime 기반), 미들웨어 인증
- 완료 기록: [stage-2-backend-complete.md](../complete-work/stage-2-backend-complete.md)

### 2026-07-24 — Stage 2 Wave 1: 프론트엔드 UI (GridView/뷰어/편집기)
- 담당: `frontend-dev`
- 산출물: [src/components/workspace/GridView.tsx](../../src/components/workspace/GridView.tsx),
  [src/components/workspace/Breadcrumb.tsx](../../src/components/workspace/Breadcrumb.tsx),
  [src/components/workspace/ConflictWarning.tsx](../../src/components/workspace/ConflictWarning.tsx),
  [src/app/workspace/view/page.tsx](../../src/app/workspace/view/page.tsx)(마크다운 뷰어),
  [src/app/workspace/edit/page.tsx](../../src/app/workspace/edit/page.tsx)(Monaco 에디터),
  [src/app/workspace/page.tsx](../../src/app/workspace/page.tsx)(확장: GridView + 정렬)
- 검증: [frontend-stage-2-validation.md](../valid/frontend-stage-2-validation.md) — **PASS (FAIL 0건, 67항목)**
- 완료 기록: [stage-2-frontend-complete.md](../complete-work/stage-2-frontend-complete.md)

### 2026-07-24 — Stage 2 Wave 2-3: 검증 + QA + 최적화
- 담당: `backend-validator`, `frontend-validator`, `optimizer`, `qa-integration`
- 검증:
  - [backend-stage-2-validation.md](../valid/backend-stage-2-validation.md) — **PASS (FAIL 0건)**
  - [frontend-stage-2-validation.md](../valid/frontend-stage-2-validation.md) — **PASS (FAIL 0건, 67항목)**
  - [optimize-stage-2-report.md](../valid/optimize-stage-2-report.md) — **PASS (고위험 0건, 선택 개선 2건)**
  - [qa-stage-2-validation.md](../valid/qa-stage-2-validation.md) — **PASS (49/49 E2E 전체 통과)**
- 최종 판정: **Stage 2 완료 승인**

### 2026-07-24~25 — Stage 3 Wave 0: tech-lead 계획 수립
- 담당: `tech-lead`
- 산출물: [stage-3-tasks.md](stage-3-tasks.md)(Wave 분해 + 결정 D3-1~D3-6),
  [backend-stage-3-contract.md](../agent-work/backend-stage-3-contract.md),
  [frontend-stage-3-contract.md](../agent-work/frontend-stage-3-contract.md),
  `SortKey`에 `'ctime'` 추가 (`src/types/api.ts`)

### 2026-07-25 — Stage 3 Wave 1: 백엔드 (FTS5 검색 · 태그 · ctime)
- 담당: `backend-dev`
- 산출물: [src/lib/search-index.ts](../../src/lib/search-index.ts)(FTS5 trigram 색인 관리),
  [src/app/api/search/route.ts](../../src/app/api/search/route.ts),
  [src/app/api/tags/route.ts](../../src/app/api/tags/route.ts),
  [src/lib/search-index.test.ts](../../src/lib/search-index.test.ts)(13 유닛 테스트),
  [src/scripts/rebuild-index.mts](../../src/scripts/rebuild-index.mts)
- 검증: [backend-stage-3-validation.md](../valid/backend-stage-3-validation.md) — **PASS (FAIL 0건)**
- 완료 기록: [stage-3-backend-complete.md](../complete-work/stage-3-backend-complete.md)

### 2026-07-25 — Stage 3 Wave 1: 프론트엔드 (검색 UI · 태그 필터)
- 담당: `frontend-dev`
- 산출물: [src/components/workspace/SearchBar.tsx](../../src/components/workspace/SearchBar.tsx),
  [src/components/workspace/SearchResults.tsx](../../src/components/workspace/SearchResults.tsx),
  [src/components/workspace/TagBar.tsx](../../src/components/workspace/TagBar.tsx),
  [src/app/workspace/page.tsx](../../src/app/workspace/page.tsx)(확장: 검색+태그+ctime)
- 검증: [frontend-stage-3-validation.md](../valid/frontend-stage-3-validation.md) — FAIL 1건, 수정 후 해소
- 완료 기록: [stage-3-frontend-complete.md](../complete-work/stage-3-frontend-complete.md)

### 2026-07-25 — Stage 3 Wave 2-3: 검증 + QA + 최적화
- 담당: `backend-validator`, `frontend-validator`, `optimizer`, `qa-integration`
- 검증:
  - [backend-stage-3-validation.md](../valid/backend-stage-3-validation.md) — **PASS (FAIL 0건)**
  - [frontend-stage-3-validation.md](../valid/frontend-stage-3-validation.md) — FAIL 1건 (SearchBar onClear), **수정 후 PASS**
  - [optimize-stage-3-report.md](../valid/optimize-stage-3-report.md) — 오류 4건(성능), 개선 8건, 보안 확인 2건
  - [qa-stage-3-validation.md](../valid/qa-stage-3-validation.md) — **PASS (FAIL 0건, UNVERIFIED 6건 비차단)**
- 최종 판정: **Stage 3 완료 승인**

### 2026-07-25 — Stage 4 Wave 0: tech-lead 계획 수립
- 담당: `tech-lead`
- 산출물: [stage-4-tasks.md](stage-4-tasks.md)(Wave 분해 + 결정 D4-1~D4-7),
  [backend-stage-4-contract.md](../agent-work/backend-stage-4-contract.md),
  [frontend-stage-4-contract.md](../agent-work/frontend-stage-4-contract.md),
  `ShareNotifyRequest`/`ShareNotifyResponse` 타입 추가 (`src/types/api.ts`)

### 2026-07-25 — Stage 4 Wave 1: 백엔드 (Discord/Slack Webhook)
- 담당: `backend-dev`
- 산출물: [src/lib/webhook.ts](../../src/lib/webhook.ts)(Discord Embed + Slack Block Kit),
  [src/app/api/share/notify/route.ts](../../src/app/api/share/notify/route.ts),
  [src/lib/webhook.test.ts](../../src/lib/webhook.test.ts)(20 유닛 테스트)
- 검증: [backend-stage-4-validation.md](../valid/backend-stage-4-validation.md) — **PASS (FAIL 0건)**
- 완료 기록: [stage-4-backend-complete.md](../complete-work/stage-4-backend-complete.md)

### 2026-07-25 — Stage 4 Wave 1: 프론트엔드 (ShareModal + 공유 버튼)
- 담당: `frontend-dev`
- 산출물: [src/components/workspace/ShareModal.tsx](../../src/components/workspace/ShareModal.tsx)(Discord/Slack/Copy Link),
  [src/app/workspace/view/page.tsx](../../src/app/workspace/view/page.tsx)(공유 버튼 추가),
  [src/app/workspace/edit/page.tsx](../../src/app/workspace/edit/page.tsx)(공유 버튼 추가)
- 검증: [frontend-stage-4-validation.md](../valid/frontend-stage-4-validation.md) — **PASS (FAIL 0건, MINOR 1건)**
- 완료 기록: [stage-4-frontend-complete.md](../complete-work/stage-4-frontend-complete.md)

### 2026-07-25 — Stage 4 Wave 2-3: 검증 + QA + 최적화
- 담당: `backend-validator`, `frontend-validator`, `optimizer`, `qa-integration`
- 검증:
  - [backend-stage-4-validation.md](../valid/backend-stage-4-validation.md) — **PASS (FAIL 0건)**
  - [frontend-stage-4-validation.md](../valid/frontend-stage-4-validation.md) — **PASS (FAIL 0건, MINOR 1건)**
  - [optimize-stage-4-report.md](../valid/optimize-stage-4-report.md) — 오류 3건(중간 1, 낮음 2), 성능 개선 5건, 보안 소견 3건
  - [qa-stage-4-validation.md](../valid/qa-stage-4-validation.md) — **PASS (FAIL 0건, UNVERIFIED 1건 비차단)**
- 최종 판정: **Stage 4 완료 승인**

### 2026-07-25 — Stage 5 Wave 0: tech-lead 계획 수립
- 담당: `tech-lead`
- 산출물: [stage-5-tasks.md](stage-5-tasks.md)(Wave 분해 + 결정 D5-1~D5-7)
- 핵심 결정: 기존 webhook.ts 재사용, best-effort 알림, proto 화이트리스트(P1-20 해소)

### 2026-07-25 — Stage 5 Wave 1: 백엔드 (업로드 Webhook 통합)
- 담당: `backend-dev`
- 산출물: [src/app/api/upload/route.ts](../../src/app/api/upload/route.ts)(Webhook 알림 추가),
  [src/app/api/share/notify/route.ts](../../src/app/api/share/notify/route.ts)(sanitizeProto 적용),
  [src/app/api/upload/upload-notification.test.ts](../../src/app/api/upload/upload-notification.test.ts)(21 테스트)
- 검증: [backend-stage-5-validation.md](../valid/backend-stage-5-validation.md) — **PASS (FAIL 0건)**
- 완료 기록: [stage-5-backend-complete.md](../complete-work/stage-5-backend-complete.md)

### 2026-07-25 — Stage 5 Wave 1: 프론트엔드 (알림 상태 표시)
- 담당: `frontend-dev`
- 산출물: [src/components/upload/UploadDropzone.tsx](../../src/components/upload/UploadDropzone.tsx)(알림 토스트 반영)
- 검증: [frontend-stage-5-validation.md](../valid/frontend-stage-5-validation.md) — **PASS (FAIL 0건)**
- 완료 기록: [stage-5-frontend-complete.md](../complete-work/stage-5-frontend-complete.md)

### 2026-07-25 — Stage 5 Wave 2-3: 검증 + QA + 최적화
- 담당: `backend-validator`, `frontend-validator`, `optimizer`, `qa-integration`
- 검증:
  - [backend-stage-5-validation.md](../valid/backend-stage-5-validation.md) — **PASS (FAIL 0건)**
  - [frontend-stage-5-validation.md](../valid/frontend-stage-5-validation.md) — **PASS (FAIL 0건)**
  - [optimize-stage-5-report.md](../valid/optimize-stage-5-report.md) — 오류 3건(중간 2, 낮음 1), 성능 개선 1건
  - [qa-stage-5-validation.md](../valid/qa-stage-5-validation.md) — **PASS (FAIL 0건, UNVERIFIED 0건)**
- 최종 판정: **Stage 5 완료 승인. 전체 5단계 로드맵 완료.**

### 2026-10-01 — 폴더 ZIP 다운로드 (웹 UI 노출 + 라우트 버그 수정)
- 담당: 직접 작업 (서브에이전트 미사용)
- 배경: `GET /api/download`는 이미 폴더 ZIP 스트리밍을 구현하고 있었으나,
  워크스페이스가 렌더하는 `BentoGrid`에 다운로드 버튼이 없어 **UI에서 도달할 수 없었다**.
  (버튼이 있는 `GridView`는 현재 워크스페이스에서 쓰이지 않는다.)
- 산출물:
  - [src/components/workspace/FolderDownloadButton.tsx](../../src/components/workspace/FolderDownloadButton.tsx) (신규)
    — 압축 중 상태 표시 + 401/429 토스트 처리, `card`/`toolbar` 2종 variant
  - [src/components/workspace/BentoGrid.tsx](../../src/components/workspace/BentoGrid.tsx)
    — `FeaturedFolderCard`·`FolderCard` 액션 영역에 ZIP 다운로드 버튼 추가
  - [src/app/workspace/page.tsx](../../src/app/workspace/page.tsx)
    — 헤더에 "현재 폴더 ZIP 다운로드" 버튼 (루트에서는 숨겨 전체 저장소 압축을 막는다)
  - [src/app/api/download/route.ts](../../src/app/api/download/route.ts) — 버그 3건 수정
  - [src/app/api/download/folder-zip.test.ts](../../src/app/api/download/folder-zip.test.ts) (신규, 15 테스트)
- 수정한 라우트 버그:
  1. **심볼릭 링크 하나가 폴더 전체 다운로드를 깨뜨렸다.** `collectFiles`가 타입 확인보다 먼저
     `assertRealPathUnderRoot`를 호출해, 루트 밖을 가리키는 링크가 있으면 400으로 실패했다.
     링크는 `withFileTypes`(lstat) 기준으로 어차피 ZIP에 담기지 않으므로 건너뛰도록 바꿨다.
     (회귀 테스트로 수정 전 실패를 확인했다 — 5개 테스트가 깨진다.)
  2. **ZIP 엔트리 이름에 `\` 구분자가 샐 수 있었다.** `path.relative`는 Windows에서 `\`를 준다.
     APPNOTE 4.4.17에 따라 항상 `/`로 정규화한다.
  3. **backpressure 부재.** ZIP 전체가 메모리에 쌓일 수 있어 `pull`/`pause`/`resume`을 연결했다.
     `archive.finalize()`의 unhandled rejection도 막았다.
- 검증: `npx tsc --noEmit` 통과, 변경 파일 `eslint` 0건, 신규 테스트 14 통과 / 1 skip,
  `npm run build` 성공.
  - skip 1건은 Windows에서 **파일** symlink 생성에 관리자 권한이 필요한 탓이다.
    디렉터리 링크(junction)로 동일 코드 경로를 양쪽 플랫폼에서 검증한다.
  - 기존 `path-safety.test.ts`·`search-index.test.ts`는 Windows에서 실패한다
    (`env.ts`가 MARKDOWN_ROOT에 POSIX 절대경로를 요구 + symlink EPERM).
    **이번 변경과 무관하며** clean checkout에서 동일하게 실패함을 확인했다. 맥미니에서 재확인 필요.
- 미확인: `.env.local`이 맥미니에만 있어 이 작업 환경에서 앱을 띄운 실클릭 검증은 하지 못했다.

### 2026-09-11 — Stage 6 AI 패널 main 병합 (⚠️ 게이트 미통과 상태)
- `8408ac5`에서 `fix/ai-panel-claude-cli-fallback`이 main에 병합됐다.
  [stage-6-macmini-gate.md](stage-6-macmini-gate.md)는 "머지 차단"을 명시했으나 G/S/F 항목이 전부 미체크인 채 병합됐다.
- 완화: `AI_PANEL_ENABLED` 기본 off라 CLI 경로는 꺼진 채 배포된다. **S-1·S-2(경로 봉쇄) 실측 전에는 운영에서 켜지 않는다.**
- Stage 6은 이 문서의 "완료"가 아니다 — 완료 기록(D-2)과 게이트 통과 후 이동한다. 잔여는 [backlog.md](backlog.md) P0·P1-28 참조.

### 2026-10-04 — `wip/untracked-helpers` 병합 + 실행 게이트 G-1~G-5 1차 실측
- 담당: 직접 작업 (서브에이전트 미사용)
- 병합: `origin/wip/untracked-helpers`(`9e20250` 헬퍼 추출 보존 + `f9eadd7` route-helpers 테스트 수정)
  - 신규 파일: `src/lib/{atomic-write,format-utils,http-utils,markdown-utils,route-helpers}.ts` (+ 테스트 4종),
    `src/app/workspace/use-workspace-data.ts`, `src/components/workspace/DeleteConfirmModal.tsx`
  - **아직 어디서도 import되지 않는다** — 기존 라우트·페이지의 중복 코드를 이 헬퍼로 교체하는 작업은 [backlog.md](backlog.md) P2-38로 남긴다.
  - `f9eadd7`: `route-helpers.test.ts`가 존재하지 않는 `resetRootCacheForTest`를 import해 suite 전체가 실패하던 문제 수정(Jenkins 배포 FAILURE 원인). 캐시 도입은 P2-10에서 별도로 다룬다.
- 실측 (Linux, Node 22.22.0, `npm ci` 후 — 맥미니 아님):
  - `npm run typecheck` ✅ 오류 0
  - `npm run lint` ✅ 오류 0 · 경고 0 (P1-30 `set-state-in-effect` 미발생)
  - `npx vitest run src/lib/claude-cli.test.ts src/lib/format-elapsed.test.ts` ✅ 32 passed
  - `npm test` ✅ **21 files / 313 passed**, skip 0 (Linux에서는 symlink 테스트까지 전부 실행됨)
  - `npm run build` ✅ 성공
- 의미: [stage-6-macmini-gate.md](stage-6-macmini-gate.md) §1 G-1~G-5는 **코드 수준에서 통과**함이 확인됐다.
  맥미니(Node 22.23.1, 실제 `.env.local`)에서의 재확인과 §2 S·§3 F 항목은 여전히 미수행이다.

### 2026-10-05 — PWA(홈 화면 앱) + 업로드 완료 푸시 알림
- 담당: 직접 작업 (서브에이전트 미사용) · 근거: [review-pwa-ios-push.md](../agent-work/review-pwa-ios-push.md)
- 산출물:
  - PWA: [src/app/manifest.ts](../../src/app/manifest.ts)(`/manifest.webmanifest`, standalone), `public/icons/*`(192/512/maskable/apple-touch),
    [src/app/layout.tsx](../../src/app/layout.tsx)(`appleWebApp`, theme-color)
  - 서비스 워커: [public/sw.js](../../public/sw.js) — **push 수신·클릭 처리만**, fetch 가로채기·캐시 없음. 클릭 URL은 같은 origin 내부 경로만 허용
  - 서버: [src/lib/push.ts](../../src/lib/push.ts)(구독 저장 `.mdws/push.db`, `web-push` 발송, 404/410 구독 자동 삭제),
    [`/api/push/subscribe`](../../src/app/api/push/subscribe/route.ts)(GET/POST/DELETE), [`/api/push/test`](../../src/app/api/push/test/route.ts)
  - 업로드 연동: [src/app/api/upload/route.ts](../../src/app/api/upload/route.ts) — webhook 알림과 별도로 `notifyUploadPush()`를 띄우고 **응답을 기다리게 하지 않는다**
  - UI: [src/components/workspace/PushToggle.tsx](../../src/components/workspace/PushToggle.tsx) — 헤더 종 버튼. 서버 미설정·미지원 브라우저면 숨김, iOS Safari 탭이면 "홈 화면에 추가" 안내
  - env: `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (셋 다 있거나 셋 다 없어야 함, 키 길이 검증) · `npm run generate-vapid-keys`
  - 의존성: `web-push` 3.6.7 (+ `@types/web-push`) — `npm audit` 신규 취약점 0건
- 보안 판단:
  - 미들웨어 매처에서 `/manifest.webmanifest`, `/sw.js`를 **정확한 경로로만** 제외 (불변식 1 예외 — 정적·시크릿 없음). `/sw.jsx`, `/manifest.json` 등은 계속 리다이렉트
  - endpoint는 서버가 POST하는 URL이므로 **알려진 푸시 서비스 호스트 허용 목록**으로 SSRF 차단 (apple / fcm / mozilla / windows)
  - p256dh는 길이뿐 아니라 **P-256 곡선 위의 점인지** 검증
  - 로그에는 endpoint 전체가 아니라 호스트만 남긴다 (endpoint = 그 기기로 보낼 권한)
  - rate limit: 구독 20회/분, 테스트 알림 3회/분 · VAPID 개인키는 응답에 없음(테스트로 확인)
- 검증 (Linux, Node 22.22.0):
  - typecheck 0 · lint 0/0 · `npm test` 전체 통과 (신규: `push.test.ts`, `push-client.test.ts`, `env-vapid.test.ts`, `push-routes.test.ts`) · build 성공
  - 실서버 curl: 비로그인 `/manifest.webmanifest`·`/sw.js`·아이콘 200, `/api/push/*` 401, `/workspace`·`/sw.jsx`·`/manifest.json` 307
  - 로그인 후: 공개키 조회, 허용 밖 endpoint 400, 정상 구독 200, 업로드 응답 0.05초(푸시는 비동기로 발송·실패 로그에 호스트만)
  - Chromium(Playwright): 서비스 워커 등록·활성, CDP로 push 주입 → 알림 표시(제목·본문·tag·URL 일치), 외부 URL 페이로드는 `/workspace`로 치환
  - 모바일 390px 헤더 가로 넘침 0 (버튼 추가로 생긴 14px 넘침을 여백 조정으로 해소)
- 미확인 (실기기 필요): iPhone 홈 화면 설치 → 권한 허용 → 실제 Apple 푸시 수신 → 알림 탭 이동, ngrok Basic Auth 하에서의 동작.
  Chromium 테스트 환경은 Push 구독 자체를 지원하지 않아(시크릿 모드 제한) 실제 구독 왕복은 검증하지 못했다.

### 2026-10-05 — 문서 링크 그래프 (Obsidian 그래프 개념) — 브랜치 `feat/obsidian-graph`
- 담당: 직접 작업 (서브에이전트 미사용) · 필수 로드맵 밖 부가 기능
- **1단계 — 위키링크·백링크** (`16c9d1e`)
  - 색인 시 `[[문서명]]`·상대 `.md` 링크를 `doc_links`에 **해석 전** 값으로 저장 → 대상 문서가 나중에 올라와도 원본 재색인 없이 연결
  - 해석: [src/lib/wikilinks.ts](../../src/lib/wikilinks.ts) (서버·클라이언트 공용 순수 모듈). 파일명 기준·대소문자 무시·NFC,
    동명이면 원본과 공유하는 상위 폴더가 깊은 것 → 짧은 경로 → 사전순
  - 링크 테이블 도입 전 색인은 기동 시 1회 전부 재색인(`index_meta.links_version`)
  - API: `GET /api/links`, `GET /api/graph` — 색인만 읽음(ADR-007), `path`는 경로 안전 유틸 경유(불변식 2)
  - 뷰어: `[[…]]` 클릭 이동, 없는 문서는 점선 표시, 본문 아래 백링크 패널(문맥 줄 포함)
- **2단계 — 그래프 화면**
  - [GraphCanvas](../../src/components/workspace/GraphCanvas.tsx) (`react-force-graph-2d`, canvas, `ssr:false`) — 호버 시 이웃 강조, 유령·태그 노드 구분, 소규모 그래프 과확대 방지
  - 뷰어 하단 **로컬 그래프**(깊이 1~3, 태그 토글, 접기), 전체 그래프 페이지 `/workspace/graph`(고립 문서 포함, 노드 상한 1500), 사이드바 진입
  - 의존성: `react-force-graph-2d` 1.29 — `npm audit` 신규 취약점 0건
- 검증 (Linux, Node 22.22.0): lint 0 · typecheck 0 · test **30 files / 411 passed** (신규 6파일) · build 성공
  - 실서버: 비로그인 `/api/links` 401, 백링크·ghost·코드 블록 제외·위키링크 클릭 이동, 전체/로컬/태그 그래프, 사이드바 진입, 모바일 390px 넘침 0 (Chromium)
- 남은 것: [backlog.md](backlog.md) P2-41~43

