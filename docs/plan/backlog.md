# 앞으로 해야 할 목록 (Backlog)

> 미착수 작업 + **검증 FAIL로 되돌아온 항목**을 관리한다.
> 단계별 전체 계획은 [roadmap.md](roadmap.md), 완료분은 [progress.md](progress.md).
> 우선순위: `P0`(차단) > `P1`(단계 필수) > `P2`(개선).

---

## P0 -- 차단 항목 (검증 FAIL / 보안 불변식 위반)

(없음)

> ~~1. Node 런타임 v19.1.0 → 20.9+ 업그레이드~~ → **2026-07-23 해소**. v22.23.1 설치 완료(`~/.local`, sudo 불필요 방식).
> ~~2. SearchBar 검색어 1자 시 onClear 미호출~~ → **2026-07-25 해소**. `SearchBar.tsx:96-99`에서 `value.length < 2` 조건으로 무조건 `onClear()` 호출.

> 검증 에이전트가 FAIL을 낼 때마다 여기에 추가한다. P0가 하나라도 있으면 해당 단계는 완료 불가.

---

## P1 -- 다음 착수 (Stage 5: 업로드 완료 알림)

Stage 5 완료 (2026-07-25). 전 단계 완료.

### 신규 P1 -- Stage 0에서 발생

| # | 항목 | 내용 |
|---|------|------|
| 11 | next 번들 sharp 0.35+ 승급 추적 | next 16.2.11이 sharp@0.34.5를 번들하며 libvips CVE 4건(high) 보유. 현재 `images.unoptimized: true`로 경로 차단 중. next 업데이트 시 재검토하고 차단 해제 여부 판단 |
| 12 | `npm audit fix --force` **금지** 규칙 | next를 9.3.3으로 다운그레이드하려 함. 실행 시 프로젝트 파괴. 취약점 3건은 전부 transitive이며 상위 수정본 미출시 |
| ~~20~~ | ~~appUrl proto 헤더 검증 추가~~ | ~~2026-07-25 **Stage 5에서 해소**. `upload/route.ts:79-83`과 `share/notify/route.ts:45-49`에 `sanitizeProto()` 적용. `'http'`/`'https'`만 허용, 그 외 `'https'`로 대체. 출처: [optimize-stage-4-report.md](../valid/optimize-stage-4-report.md) SEC-1~~ |

---

## P2 -- 미결정 / 후속 판단 필요

| # | 항목 | 내용 |
|---|------|------|
| ~~1~~ | ~~테스트 러너 선정~~ | ✅ 2026-07-23 **Vitest 4** 확정. `vitest.config.ts`에 `@` 별칭 + `server-only` 치환 설정 완료. 단일 테스트 실행법은 CLAUDE.md "명령어" 참조 |
| 2 | chokidar 파일 감시 | ADR-007의 **선택** 항목. 앱 외부(파인더·터미널) 변경 포착용. Stage 3 이후 판단 |
| 3 | ngrok Traffic Policy 실적용 | 무료 플랜 Basic Auth + 정적 도메인 예약. 배포 시점에 진행 (운영체제/외부 계정 관련 → 사용자 확인 필요) |
| 4 | 상주 프로세스 관리 | `next start` 무한 상주 방식(launchd / pm2 등) 미정. 배포 시점 결정 |
| ~~5~~ | ~~SVG 저장형 XSS 대응~~ | ✅ 2026-07-24 **결정: SVG는 `<img>`로만 렌더** (D2-1). `ALLOWED_EXTENSIONS`에서 제거하지 않고, 업로드/저장은 허용하되 뷰어/에디터에서 `<img>` 태그로만 표시한다. `<img>` 태그는 SVG 내부 스크립트를 실행하지 않으므로 XSS가 성립하지 않는다. sanitize 의존성 불필요. [stage-2-tasks.md](stage-2-tasks.md) D2-1 참조. 출처: [security-stage-1-validation.md](../valid/security-stage-1-validation.md) T-22 |
| 6 | `middleware` → `proxy` 파일 컨벤션 이관 | Next 16이 `middleware` 컨벤션을 deprecated 처리(빌드 경고 1건). 동작에는 영향 없으나 계획 문서의 산출물명 변경을 수반해 `tech-lead` 판단 필요. 출처: [security-stage-1-decisions.md](../agent-work/security-stage-1-decisions.md) D-5 |
| 7 | 개발용 임시 비밀번호 교체 | 인터넷 노출 **전** 필수. `npm run hash-password`. 현재 값은 [stage-1-security-complete.md](../complete-work/stage-1-security-complete.md) §2 참조 |
| 8 | XHR `withCredentials` 미설정 | `src/lib/fetcher.ts:162-163` — `apiUpload`의 XHR에 `withCredentials = true` 미설정. same-origin에서는 문제없으나 ngrok 도메인에서 cross-origin으로 판정될 경우 업로드 401 실패 가능. 출처: [optimize-stage-1-report.md](../valid/optimize-stage-1-report.md) |
| 9 | Toaster useEffect ref 타이밍 | `src/components/ui/Toaster.tsx:56` — StrictMode 이중 실행 시 `timerMap` ref 정리 타이밍 이슈. 프로덕션에서는 발생 안 함. 출처: [optimize-stage-1-report.md](../valid/optimize-stage-1-report.md) |
| 10 | `path-safety.ts` getRoot()/realpath 캐싱 | `src/lib/path-safety.ts:63-65, 184-185` — `getRoot()`의 `path.resolve()`가 요청당 ~8회, `fs.realpath(root)`가 ~4회 반복 호출. 프로세스 수명 동안 불변값이므로 모듈 수준 캐시로 syscall ~50% 절감 가능. 출처: [optimize-stage-1-report.md](../val/optimize-stage-1-report.md) |
| 11 | 업로드 파일 메모리 3중 복사 | `src/app/api/upload/route.ts:231` — `formData()` → `arrayBuffer()` → `Buffer.from()` 체인이 20MB 파일 기준 ~60MB 힙 사용. `Uint8Array` 직접 사용 또는 스트리밍 전환 검토. 출처: [optimize-stage-1-report.md](../valid/optimize-stage-1-report.md) |
| 12 | UploadDropzone useMemo 최적화 | `src/components/upload/UploadDropzone.tsx:152-153` — `items.filter()` 2회 호출이 리렌더마다 실행. `useMemo` 또는 단일 `reduce`로 개선 가능. 출처: [optimize-stage-1-report.md](../valid/optimize-stage-1-report.md) |
| 13 | /api/files 마크다운 전체 읽기 최적화 | `src/app/api/files/route.ts:136` — 커버 이미지 감지를 위해 마크다운 전체를 읽음. 첫 1KB만 읽거나 프론트 lazy loading 전환 검토. 출처: [optimize-stage-2-report.md](../valid/optimize-stage-2-report.md) |
| 14 | 에디터 ref 동기화 useEffect 통합 | `src/app/workspace/edit/page.tsx:64-66` — 3개 분리 useEffect를 1개로 합칠 수 있음. 낮은 우선순위. 출처: [optimize-stage-2-report.md](../valid/optimize-stage-2-report.md) |
| 15 | search-index prepared statement 캐싱 + N+1 JOIN 통합 | `src/lib/search-index.ts:192-198, 243-270` — `indexFile()` 호출마다 `prepare()` 3회 반복, `search()` N+1 쿼리(51개). JOIN + statement 캐싱으로 개선. 출처: [optimize-stage-3-report.md](../valid/optimize-stage-3-report.md) S-1, S-2 |
| 16 | ensureDb()/initIndex() 순환 의존 정리 | `src/lib/search-index.ts:70-104` — `ensureDb()->initIndex()->incrementalBuild()->ensureDb()` 재진입 경로. `db` 변수 할당 순서에 암묵적 의존. 리팩터링 안전성을 위해 명시적 분리 권장. 출처: [optimize-stage-3-report.md](../valid/optimize-stage-3-report.md) |
| 17 | /api/search, /api/tags Cache-Control 헤더 추가 | 검색 `max-age=5`, 태그 `max-age=30` (private) 설정하면 같은 검색어 재입력 시 불필요한 네트워크 왕복 제거. 출처: [optimize-stage-3-report.md](../valid/optimize-stage-3-report.md) S-4 |
| 18 | workspace/page.tsx 콜백 미메모이징 | `handleTagSelect`, `handleBreadcrumbNavigate` 등 useCallback 미적용. 향후 React.memo 최적화 시 장애물. 출처: [optimize-stage-3-report.md](../valid/optimize-stage-3-report.md) C-1 |
| 19 | ShareModal 링크 복사 버튼 disabled 시각적 피드백 누락 | `src/components/workspace/ShareModal.tsx:120` — Discord/Slack 버튼(90, 105)과 달리 링크 복사 버튼에 `disabled:cursor-not-allowed disabled:opacity-60` CSS 클래스 미적용. `disabled` 속성은 있어 기능은 차단되지만 시각적 일관성 결여. 출처: [frontend-stage-4-validation.md](../valid/frontend-stage-4-validation.md) MINOR |
| 21 | stat EPERM/EACCES를 500으로 구분 | `src/app/api/share/notify/route.ts:91-93` — 파일시스템 권한 오류(EPERM/EACCES)도 `'File not found.' 400`으로 반환. ENOENT만 400, 나머지는 `internalError()` (500)으로 구분 권고. 출처: [optimize-stage-4-report.md](../valid/optimize-stage-4-report.md) |
| 22 | isExternalUrl/resolveImageSrc 중복 코드 공용 모듈화 | `src/app/workspace/view/page.tsx:27-43`, `src/app/workspace/edit/page.tsx:33-43` — 동일 함수 두 곳에 복제. `src/lib/markdown-utils.ts`로 추출하면 향후 드리프트 방지. 출처: [optimize-stage-4-report.md](../valid/optimize-stage-4-report.md) |
| 23 | Slack 페이로드 toLocaleString 타임존 명시 | `src/lib/webhook.ts:73` — `toLocaleString('ko-KR')`에 `timeZone: 'Asia/Seoul'` 옵션 누락. Node 22에서는 문제없으나 배포 환경 변경 시 형식이 달라질 수 있음. 출처: [optimize-stage-4-report.md](../valid/optimize-stage-4-report.md) S-2 |
| 24 | ShareModal onClose useCallback 안정화 | `src/app/workspace/view/page.tsx:201`, `src/app/workspace/edit/page.tsx:277` — `onClose={() => setShareOpen(false)}` 인라인 화살표 함수를 `useCallback`으로 안정화. 향후 `ShareModal` 메모이징 시 필요. 출처: [optimize-stage-4-report.md](../valid/optimize-stage-4-report.md) C-1 |
| 25 | upload Webhook 타임아웃 단축 검토 | `src/app/api/upload/route.ts:303` + `src/lib/webhook.ts:94` — Webhook 타임아웃 10초가 업로드 응답 지연으로 전파됨. 업로드 전용 3초 타임아웃 또는 fire-and-forget 검토. tech-lead 판단 필요. 출처: [optimize-stage-5-report.md](../valid/optimize-stage-5-report.md) PERF 중간 |
| 26 | host 헤더 CRLF 최소 방어 | `src/app/api/upload/route.ts:286`, `src/app/api/share/notify/route.ts:107` — host 값에서 개행/캐리지리턴/공백을 제거하는 1줄 방어 추가 권고. D4-2 결정(동적 URL 구성) 범위 내 최소 방어. 출처: [optimize-stage-5-report.md](../valid/optimize-stage-5-report.md) SEC-2 |
| 27 | sanitizeProto 테스트 로컬 복사본 한계 명시 | `src/app/api/upload/upload-notification.test.ts:24-28` — 테스트가 실제 라우트 함수가 아닌 로컬 복사본을 검증. 통합 테스트(337-367행)가 간접 보완하나 한계를 주석으로 명시하거나 모듈 추출 검토. 출처: [optimize-stage-5-report.md](../valid/optimize-stage-5-report.md) |

---

## 되돌아온 항목 기록 형식

```
### [P0] <항목명>
- 출처: docs/valid/<리포트>.md — FAIL #<n>
- 위반: <보안 불변식 번호 또는 ADR>
- 재현: <절차>
- 담당: <agent>
- 상태: 미착수 | 수정중 | 재검증 대기
```
