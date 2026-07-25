# 프론트엔드 검증 -- Stage 3

- 검증 일시: 2026-07-25
- 검증 대상 파일:
  - `src/components/workspace/SearchBar.tsx`
  - `src/components/workspace/SearchResults.tsx`
  - `src/components/workspace/TagBar.tsx`
  - `src/app/workspace/page.tsx`
  - (참조) `src/types/api.ts`, `src/lib/fetcher.ts`, `src/components/workspace/GridView.tsx`, `src/app/workspace/view/page.tsx`, `src/app/workspace/edit/page.tsx`, `src/components/workspace/ConflictWarning.tsx`, `src/components/upload/UploadDropzone.tsx`, `src/components/upload/upload-errors.ts`
- 종합 판정: **FAIL** (FAIL 항목 1건)

---

## 항목별 결과

| # | 항목 | 판정 | 근거(파일:라인) |
|---|------|------|------------------|
| 1 | 빌드 성공: `npm run build` 에러 없음 | PASS | `npm run build` 성공. 16개 라우트 정상 생성. `npm run typecheck` 0 errors, `npm run lint` 0 errors, `npm test` 119 passed |
| 2 | SearchBar가 헤더에 검색 입력 필드로 렌더 | PASS | `src/app/workspace/page.tsx:210` -- `<SearchBar onResults={handleSearchResults} onClear={handleSearchClear} />` 헤더 내 배치 확인. `SearchBar.tsx:132-141` -- `<input type="text" placeholder="검색... (Cmd+K)">` |
| 3 | `Cmd+K`로 검색 필드 포커스 | PASS | `SearchBar.tsx:36-45` -- `useEffect`에서 전역 `keydown` 리스너 등록, `e.metaKey || e.ctrlKey && e.key === 'k'` 조건, `e.preventDefault()` 호출, `inputRef.current?.focus()` 실행 |
| 4 | 디바운스 300ms 동작 | PASS | `SearchBar.tsx:81-83` -- `setTimeout(() => { doSearch(query); }, 300)` |
| 5 | 검색 결과가 카드 목록으로 렌더 (SearchResults 컴포넌트) | PASS | `SearchResults.tsx:127-185` -- `results.map()` 으로 `<button>` 카드 목록 생성. 제목, snippet, 태그 칩, 수정일, 커버 썸네일 모두 포함 |
| 6 | snippet 하이라이트: `[[hl]]` 마커가 `<mark>` 엘리먼트로 변환 | PASS | `SearchResults.tsx:29-65` -- `parseSnippet()` 함수가 `SNIPPET_MARK.open`/`close`로 파싱하여 `<mark>` React 엘리먼트 조립 |
| 7 | `dangerouslySetInnerHTML` 미사용 | PASS | `SearchResults.tsx` 전체에서 `dangerouslySetInnerHTML` 실사용 없음 (주석/문서에서만 언급). grep 확인 완료 |
| 8 | 결과 카드 클릭 시 `/workspace/view?path=...`로 이동 | PASS | `SearchResults.tsx:94-96` -- `router.push(\`/workspace/view?path=${encodeURIComponent(subpath)}\`)` |
| 9 | TagBar가 태그 칩 + 개수로 렌더, 수평 스크롤 | PASS | `TagBar.tsx:24-51` -- `overflow-x-auto flex gap-2`, 각 칩 `{tag} ({count})` 형태 |
| 10 | 태그 클릭 시 GridView 필터 (`GET /api/files?tag=...`) | PASS | `page.tsx:150-152` -- `handleTagSelect` -> `setActiveTag(tag)`. `page.tsx:82-106` -- `useEffect`에서 `activeTag` 의존성으로 `loadFiles(currentPath, sort, activeTag ?? undefined)` 재호출. `page.tsx:43-53` -- `loadFiles`가 `params.set('tag', tag)` 포함 |
| 11 | "전체" 칩이 필터 해제 | PASS | `TagBar.tsx:30-36` -- "전체" 버튼 클릭 시 `onTagSelect(null)`. `page.tsx:88` -- `activeTag ?? undefined`로 null이면 tag 파라미터 미전송 |
| 12 | ctime 정렬 옵션이 드롭다운에 "생성일"로 표시 | PASS | `page.tsx:35-40` -- `SORT_OPTIONS`에 `{ value: 'ctime', label: '생성일' }` 포함. `page.tsx:213-225` -- `<select>` 드롭다운에서 렌더 |
| 13 | 검색 모드에서 TagBar 숨김 | PASS | `page.tsx:253` -- `{!isSearchMode && tags.length > 0 && ( <TagBar ... /> )}` |
| 14 | `Escape`로 검색 해제 + GridView 복귀 | PASS | `SearchBar.tsx:105-113` -- `e.key === 'Escape'` 시 `setQuery('')`, `onClear()`, `inputRef.current?.blur()`. `page.tsx:143-147` -- `handleSearchClear`가 `searchResults`를 `null`로 설정하여 GridView 복귀 |
| 15 | `indexing` 배너 표시 | PASS | `SearchResults.tsx:107-114` -- `indexing && (<div> ... 색인 구축 중입니다. 일부 결과가 누락될 수 있습니다. ... </div>)` |
| 16 | 모든 API 호출이 `apiFetch` 경유 (raw fetch 미사용) | PASS | `SearchBar.tsx:15,53` -- `apiFetch` import 및 사용. `page.tsx:24,52,112,159` -- `apiFetch` import 및 사용. `SearchResults.tsx`, `TagBar.tsx`에서는 API 호출 없음 (props만 수신). 전체 `src/components/workspace/` 및 `src/app/workspace/` 경로에서 raw `fetch(` 호출 grep 결과 0건 |
| 17 | 계약 준수: 엔드포인트 경로/파라미터/응답 형태 일치 | PASS | `GET /api/search?q=` (SearchBar.tsx:53-54), `GET /api/tags` (page.tsx:112), `GET /api/files?path=&sort=&tag=` (page.tsx:43-53) -- 모두 Canonical API Contract와 일치 |
| 18 | 타입 공유 모듈에서 import (로컬 중복 정의 없음) | PASS | `SearchBar.tsx:16` -- `from '@/types/api'`. `SearchResults.tsx:15-16` -- `from '@/types/api'`. `TagBar.tsx:12` -- `from '@/types/api'`. `page.tsx:26-33` -- `from '@/types/api'`. API 타입 로컬 중복 정의 없음 |
| 19 | 401 -> `/login` 리다이렉트 동작 | PASS | `fetcher.ts:83-89,93-96` -- `redirectToLogin()` 구현 확인. 모든 API 호출이 `apiFetch` 경유하므로 자동 적용 |
| 20 | 429 -> rate limited 토스트 | PASS | `fetcher.ts:97-99` -- `code === 429 && toastOn429` 시 `emitToast` 호출 |
| 21 | 그리드 카드 이미지: `/api/thumbnail` 사용 | PASS | `GridView.tsx:13` -- "썸네일 URL은 서버가 coverThumbUrl에 이미 /api/thumbnail?... 형태로 제공한다". 서버가 생성한 `coverThumbUrl`을 그대로 사용하므로 원본 이미지 직접 로드 없음 |
| 22 | 편집 안전성: `PUT /api/file-content`에 `baseMtime` 전송 | PASS | `edit/page.tsx:113-117` -- `SaveFileRequest { path, content, baseMtime: baseMtimeRef.current }` |
| 23 | 409 응답 시 비파괴적 경고 + 다시 불러오기 선택지 | PASS | `edit/page.tsx:130-132` -- 409 시 `setConflict(true)` + 에러 토스트. `ConflictWarning.tsx:37-79` -- "이 파일이 다른 곳에서 수정되었습니다" 경고 + "내용 복사" + "새로고침" 버튼. 자동 덮어쓰기 없음 |
| 24 | 업로드 에러 노출: 413/415/429 구분 메시지 | PASS | `upload-errors.ts:15-17` -- 413/415/429 각각 구분된 한국어 메시지. `UploadDropzone.tsx:7-8,121-122,263` -- 파일별 에러 표시 및 429 시 큐 중단 |
| 25 | 업로드 성공 시 폴더 새로고침 | PASS | `page.tsx:124-126` -- `handleUploaded`가 `setRefreshKey(k+1)` 호출하여 파일 목록 및 태그 재조회 트리거 |
| 26 | 공유: Copy Link는 인증된 앱 URL 복사 (토큰 기반 공개 링크 아님) | PASS | Stage 4(소셜 공유) 미착수. 현재 workspace/view 파일에 공유 관련 코드 없음. share/notify 관련 클라이언트 코드 미존재. ADR-004 위반 없음 |
| 27 | Webhook URL이 클라이언트 코드에 등장하지 않음 | PASS | `src/components/` 전체 grep -- `webhook`, `WEBHOOK`, `discord`, `DISCORD`, `slack`, `SLACK` 0건 |
| 28 | 스코프 드리프트: Node `fs`, FTP, 카카오 SDK 없음 | PASS | `src/components/` 및 `src/app/workspace/` 전체 grep -- `require('fs')`, `from 'fs'`, `basic-ftp`, `kakao`, `카카오` 0건 |
| 29 | 로딩 스켈레톤 / 빈 상태 / 에러 상태 | PASS | `page.tsx:269-300` -- 로딩 스피너, 에러 박스(다시 시도 버튼), 빈 폴더 안내(GridView). `SearchResults.tsx:107-124` -- indexing 안내, 결과 0건 안내. `SearchBar.tsx:126-130` -- 로딩 중 스피너 |
| 30 | 키보드 접근성: 포커스 상태, Esc 닫기, Enter 제출 | PASS | `SearchBar.tsx:140` -- `focus-visible` 클래스. `SearchBar.tsx:147` -- 클리어 버튼 `focus-visible`. `TagBar.tsx:57` -- 칩 `focus-visible`. `SearchResults.tsx:134` -- 카드 `focus-visible`. Modal Esc 닫기: `Modal.tsx:58`. SearchBar Esc: `SearchBar.tsx:106` |
| 31 | 반응형: 모바일 2열 / md 4열 | PASS | `GridView.tsx:47` -- `grid-cols-2 md:grid-cols-4` |
| 32 | 검색어 2자 미만으로 줄어들 때 `onClear()` 호출 (계약 요구사항) | **FAIL** | `SearchBar.tsx:91-101` -- `handleChange`에서 `value.length < 2`이지만 `value.length > 0`인 경우(1자) `onClear()`가 호출되지 않음. 계약 문서 `frontend-stage-3-contract.md:35`는 "2자 미만이면 요청하지 않고 `onClear()` 호출"을 요구함 |

---

## FAIL 상세

### FAIL #32: 검색어가 2자 이상에서 1자로 줄어들 때 검색 결과가 유지됨

**무엇이 잘못됐는지**

`SearchBar.tsx`의 `handleChange` 함수(라인 91-101)에서, 검색어가 2자 미만(`value.length < 2`)이 되었을 때 `onClear()`를 호출하는 조건이 `value.length === 0`인 경우에만 한정되어 있다. 1자인 경우에는 `onClear()`가 호출되지 않는다.

```typescript
// SearchBar.tsx:91-101
function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
  const value = e.target.value;
  setQuery(value);

  // 2자 미만으로 줄어들면 검색 해제 + 로딩 리셋
  if (value.length < 2) {
    setLoading(false);
    if (value.length === 0) {  // <-- 1자일 때 onClear가 호출되지 않음
      onClear();
    }
  }
}
```

계약 문서 `frontend-stage-3-contract.md:35`의 요구사항:

> "입력값이 2자 이상이면 `apiFetch<SearchResponse>('/api/search?q=...')` 호출. 2자 미만이면 요청하지 않고 `onClear()` 호출."

**구체적 재현 절차**

1. 검색 바에 "ab" 입력 (2자 -> 디바운스 후 검색 실행 -> 결과 표시)
2. Backspace 1번 -> "a" (1자)
3. 기대: 검색 결과가 사라지고 GridView 복귀
4. 실제: 검색 결과가 화면에 남아 있음 (검색 모드 유지)

**기대 동작**

`value.length < 2` 조건에서 `onClear()`가 호출되어야 한다. 즉 `if (value.length === 0)` 조건을 제거하거나 `if (value.length < 2)` 블록 안에서 무조건 `onClear()`를 호출해야 한다.

**수정 방안**

```typescript
if (value.length < 2) {
  setLoading(false);
  onClear();  // 0자든 1자든 검색 해제
}
```

**관련 계약/불변식**

- `docs/agent-work/frontend-stage-3-contract.md` 섹션 1, 항목 4 (디바운스 300ms 동작 명세)
- 기능적 영향: 사용자가 검색어를 1자까지 지웠을 때 여전히 이전 검색 결과가 표시되어 혼란을 줄 수 있음

---

## 검증 요약

- Stage 3 프론트엔드 구현은 전체적으로 높은 품질이다.
- SearchBar, SearchResults, TagBar 3개 신규 컴포넌트 모두 계약 문서의 설계를 충실히 따랐다.
- 모든 API 호출이 `apiFetch` 래퍼를 경유하며, 타입은 공유 모듈에서 import한다.
- `dangerouslySetInnerHTML` 미사용, snippet 하이라이트를 React 엘리먼트로 안전하게 조립한다.
- 빌드/타입체크/린트/테스트 모두 통과한다.
- 유일한 FAIL은 SearchBar의 검색어 길이 분기 로직에서 계약과의 미세한 불일치이다(1자 입력 시 `onClear` 미호출).
