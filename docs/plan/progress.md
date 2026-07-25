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
