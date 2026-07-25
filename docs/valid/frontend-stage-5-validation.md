# 프론트엔드 검증 -- Stage 5 (업로드 완료 알림)

- 검증 일시: 2026-07-25
- 검증 대상: `src/components/upload/UploadDropzone.tsx` (Stage 5 프론트엔드 변경분)
- 기준 커밋: `4b4ff9f` (Stage 0) + 미커밋 작업 트리
- 대상 파일 범위: `docs/plan/stage-5-tasks.md` Wave 1-B / Wave 2 frontend-validator 체크리스트
- 종합 판정: **PASS** (FAIL 항목 0건)

---

## 항목별 결과

### Stage 5 체크리스트 (stage-5-tasks.md Wave 2)

| # | 항목 | 판정 | 근거(파일:라인) |
|---|------|------|------------------|
| 1 | 빌드 성공 (`npm run build` 에러 없음) | PASS | 빌드 성공. 경고 1건은 기존 NFT 경고(next.config.ts -> upload/route.ts 추적 관련)이며 이번 변경과 무관 |
| 2 | `UploadResponse.notified` 사용 -- `notified` 필드를 읽어 표시 | PASS | `src/components/upload/UploadDropzone.tsx:117` -- `if (res?.notified) notifiedAny = true;` |
| 3 | 알림 성공 시 토스트 -- "(알림 전송됨)" 문구 포함 | PASS | `src/components/upload/UploadDropzone.tsx:136` -- `const notifyMsg = notifiedAny ? ' (알림 전송됨)' : '';` |
| 4 | 알림 미발송 시 토스트 -- 문구 없이 기본 성공 메시지만 | PASS | `src/components/upload/UploadDropzone.tsx:135-137` -- `notifiedAny`가 false이면 `notifyMsg`는 빈 문자열, `baseMsg`만 표시 |
| 5 | 기존 업로드 동작 퇴행 없음 (드래그앤드롭, 파일 선택, 진행률, 에러 표시) | PASS | 드래그앤드롭(`onDragEnter/Over/Leave/Drop` :177-196), 파일 선택(`inputRef` + `onChange` :161-170), 진행률(`progress` + progressbar :243-264), 에러 표시(`toUploadFailure` :120-127) 모두 기존 코드 그대로 유지 |
| 6 | 모든 API 호출이 `apiUpload` 경유 -- raw XHR/fetch 사용 없음 | PASS | `src/components` 디렉터리에서 `fetch(`, `XMLHttpRequest` grep 결과 0건. 업로드는 `apiUpload<UploadResponse>('/api/upload', ...)` 경유 (`UploadDropzone.tsx:113`) |

### 추가 검증 항목

| # | 항목 | 판정 | 근거(파일:라인) |
|---|------|------|------------------|
| 7 | `notifiedAny` 플래그가 다중 파일 업로드 시 올바르게 추적됨 | PASS | `src/components/upload/UploadDropzone.tsx:97` -- `let notifiedAny = false;`로 초기화, `:117`에서 각 응답의 `res?.notified` 확인, 하나라도 true면 `notifiedAny = true` 설정. `for (const item of queued)` 루프(:99) 내에서 누적 |
| 8 | 신규 의존성 미추가 | PASS | `package.json` diff: scripts 2건 추가만 확인. dependencies/devDependencies 변경 없음 |
| 9 | 토스트 메시지 형식이 계획과 일치 | PASS | 계획: `"N개 파일을 업로드했습니다. (알림 전송됨)"`. 구현: `baseMsg + notifyMsg` = `"N개 파일을 업로드했습니다."` + `" (알림 전송됨)"` (`UploadDropzone.tsx:135-137`) |
| 10 | `npm run typecheck` 통과 | PASS | `tsc --noEmit` 오류 0 |
| 11 | `npm run lint` 통과 | PASS | eslint 오류 0 |
| 12 | `npm test` 통과 | PASS | 9 파일 160 테스트 전체 통과, 실패 0 |
| 13 | `UploadResponse` 타입을 공유 모듈에서 import | PASS | `src/components/upload/UploadDropzone.tsx:15` -- `import { UPLOAD_FIELD, type UploadResponse, type UploadedFileInfo } from '@/types/api';`. 로컬 중복 정의 없음 |

### 프론트엔드 공통 불변식 검증 (기존 동작 퇴행 확인)

| # | 항목 | 판정 | 근거(파일:라인) |
|---|------|------|------------------|
| 14 | 전역 fetch 래퍼 경유 -- 모든 API 호출 | PASS | 페이지 컴포넌트(`login/page.tsx:66`, `workspace/page.tsx:52,112,159`, `view/page.tsx:69`, `edit/page.tsx:84,121`)는 `apiFetch` 사용. 업로드는 `apiUpload` 사용. `src/components` 내 raw `fetch(` 호출 0건 |
| 15 | 401 -> `/login` 리다이렉트 | PASS | `src/lib/fetcher.ts:83-89` -- `redirectToLogin()` 구현. `:93-96`에서 401 시 호출. `apiUpload`의 `:187`에서도 `handleStatusSideEffects` 경유 |
| 16 | 429 -> rate limited 토스트 | PASS | `src/lib/fetcher.ts:97-99` -- 429 시 `emitToast`. 업로드는 `:187`에서 `toastOn429: false`로 호출(인라인 표시 + `UploadDropzone.tsx:124-127`에서 별도 처리) |
| 17 | GridView 카드 이미지가 `/api/thumbnail` 사용 | PASS | `src/components/workspace/GridView.tsx:13` 주석 -- "서버가 coverThumbUrl에 이미 /api/thumbnail?... 형태로 제공". `:121`과 `:173`에서 `entry.coverThumbUrl`을 그대로 사용. 원본 이미지 직접 로드 없음 |
| 18 | 검색 입력 디바운스 | PASS | `src/components/workspace/SearchBar.tsx:81-83` -- `setTimeout(() => { doSearch(query); }, 300);` 300ms 디바운스 |
| 19 | `PUT /api/file-content`에 `baseMtime` 전송 | PASS | `src/app/workspace/edit/page.tsx:118` -- `baseMtime: baseMtimeRef.current` |
| 20 | 409 응답 시 비파괴적 경고 + 다시 불러오기/복사 선택지 | PASS | `src/app/workspace/edit/page.tsx:132-134` -- 409 시 `setConflict(true)`. `src/components/workspace/ConflictWarning.tsx:53-66` -- "내용 복사" + "새로고침" 버튼 제공. 조용한 덮어쓰기 없음 |
| 21 | 업로드 에러 413/415/429 구분 메시지 | PASS | `src/components/upload/upload-errors.ts:11-21` -- 413("파일이 너무 큽니다."), 415("허용되지 않는 형식입니다."), 429("요청이 너무 잦습니다.") 각각 별도 메시지 |
| 22 | 성공 시 현재 폴더 새로고침 | PASS | `src/components/upload/UploadDropzone.tsx:138` -- `onUploaded?.(uploaded)`. `src/app/workspace/page.tsx:124-126` -- `handleUploaded`가 `setRefreshKey((k) => k + 1)` 호출 |
| 23 | Copy Link가 인증된 앱 URL 복사 + 로그인 필요 명시 | PASS | `src/components/workspace/ShareModal.tsx:66` -- `navigator.clipboard.writeText(window.location.href)` (앱 URL 복사). `:128-130` -- "공유 링크를 받은 사람도 로그인이 필요합니다." 토큰 기반 공개 링크 생성 없음 (ADR-004 준수) |
| 24 | Webhook URL이 클라이언트 코드에 미등장 | PASS | `src/components`와 `src/app/**/page.tsx`에서 `WEBHOOK_URL`, `DISCORD_WEBHOOK`, `SLACK_WEBHOOK` grep 결과 0건 |
| 25 | 스코프 드리프트 (fs, FTP, 카카오 SDK) | PASS | `src/components`에서 `require('fs')`, `from 'fs'`, `basic-ftp`, `kakao` grep 결과 0건 |
| 26 | 키보드 접근성: 모달 Esc 닫기 | PASS | `src/components/ui/Modal.tsx:58-61` -- Escape 키로 `onClose()` 호출. 포커스 트랩 구현(:64-78). 포커스 복원(:48-49) |
| 27 | 반응형: 모바일 2열 / md 4열 | PASS | `src/components/workspace/GridView.tsx:47` -- `grid-cols-2 md:grid-cols-4` |

---

## FAIL 상세

없음.

---

## 요약

Stage 5 프론트엔드 변경은 `UploadDropzone.tsx`의 3개 라인(97, 117, 135-137)에 국한되며, 계획(stage-5-tasks.md Wave 1-B)에서 지정한 `notifiedAny` 추적 및 토스트 메시지 분기를 정확히 구현하고 있다.

- `UploadResponse.notified` 필드를 공유 타입(`src/types/api.ts:157`)에서 import하여 사용
- 다중 파일 업로드 시 하나라도 `notified: true`이면 "(알림 전송됨)" 표시
- 기존 업로드 흐름(드래그앤드롭, 파일 선택, 진행률, 에러 표시, 401/429 처리, 폴더 새로고침)에 퇴행 없음
- 빌드/타입체크/린트/테스트 전체 통과
- 신규 의존성 0건
- 보안 불변식(인증, Webhook URL 비노출, ADR-004) 전항 유지
