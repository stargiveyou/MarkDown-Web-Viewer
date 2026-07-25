# Stage 3 프론트엔드 완료 기록

- 담당: `frontend-dev`
- 완료일: 2026-07-24
- 계약 문서: [frontend-stage-3-contract.md](../agent-work/frontend-stage-3-contract.md)

---

## 변경 파일 목록

| 파일 | 상태 | 설명 |
|------|------|------|
| `src/components/workspace/SearchBar.tsx` | **신규** | 검색 입력 필드 (디바운스, Cmd+K, Escape, 스피너) |
| `src/components/workspace/SearchResults.tsx` | **신규** | 검색 결과 카드 목록 (snippet 하이라이트, 클릭 이동) |
| `src/components/workspace/TagBar.tsx` | **신규** | 수평 스크롤 태그 칩 바 |
| `src/app/workspace/page.tsx` | **수정** | 검색/태그/ctime 상태 통합, SearchBar/SearchResults/TagBar 배치 |

---

## 구현 범위

### 1. SearchBar (`src/components/workspace/SearchBar.tsx`)

- `<input>` + 돋보기 아이콘(lucide `Search`), 로딩 시 `Loader2` 스피너
- `Cmd+K` (Mac) / `Ctrl+K` (기타) 전역 단축키로 포커스
- `Escape` 키로 검색 해제: 검색어 초기화 + `onClear()` 호출 + blur
- 300ms 디바운스: 2자 이상이면 `apiFetch<SearchResponse>` 호출
- 2자 미만이면 즉시 검색 해제 (이벤트 핸들러에서 처리, effect 내 setState 회피)
- X 클리어 버튼: 검색어가 있을 때만 표시
- 요청 취소 토큰(reqIdRef)으로 이전 요청 결과 무시
- Props: `onResults(results, query, indexing)`, `onClear()`

### 2. SearchResults (`src/components/workspace/SearchResults.tsx`)

- `SearchResult[]`를 카드 목록으로 렌더
- snippet 하이라이트: `[[hl]]...[[/hl]]` 마커를 파싱하여 `<mark>` React 엘리먼트로 조립 -- `dangerouslySetInnerHTML` 사용하지 않음
- `SNIPPET_MARK` 상수를 `@/types/api`에서 import
- 각 카드: 제목 + 하이라이트된 snippet + 태그 칩 + 상대 시간(formatRelativeTime)
- 커버 썸네일: `result.coverThumbUrl`이 있으면 좌측 80x80 이미지 (`<img>` only -- D2-1)
- 카드 클릭 -> `router.push('/workspace/view?path=<subpath>')` (encodeURIComponent)
- 결과 0건: "검색 결과가 없습니다" 안내
- `indexing === true`: 색인 구축 중 경고 배너
- 결과 건수 표시

### 3. TagBar (`src/components/workspace/TagBar.tsx`)

- 수평 스크롤 칩 목록 (`overflow-x-auto flex gap-2`)
- "전체" 칩: 항상 맨 앞, 클릭 시 `onTagSelect(null)`
- 각 태그 칩: `태그명 (count)` 형태, 클릭 시 `onTagSelect(tag)`
- 활성 태그: `bg-zinc-900 text-white` / dark `bg-zinc-100 text-zinc-900`
- 비활성 태그: `bg-zinc-100 text-zinc-700 hover:bg-zinc-200` / dark `bg-zinc-800 text-zinc-300 hover:bg-zinc-700`
- `tags`가 빈 배열이면 `return null`
- Props: `tags: TagCount[]`, `activeTag: string | null`, `onTagSelect`

### 4. `/workspace` 페이지 확장 (`src/app/workspace/page.tsx`)

- 검색 상태: `searchResults`, `searchQuery`, `searchIndexing`
- 태그 상태: `tags`, `activeTag`
- 마운트 시 + `refreshKey` 변경 시 `GET /api/tags` 호출하여 태그 로드
- `loadFiles` 함수 확장: `tag` 파라미터 지원 (`&tag=...`)
- `activeTag` 변경 시 파일 목록 재조회 (useEffect 의존성에 추가)
- 정렬 드롭다운에 `{ value: 'ctime', label: '생성일' }` 추가
- 헤더에 SearchBar 배치 (정렬 드롭다운 왼쪽)
- 검색 모드: GridView 대신 SearchResults 렌더, TagBar 숨김
- 검색 모드에서 정렬 드롭다운 비활성화 (`disabled`)
- Breadcrumb 아래, GridView 위에 TagBar 배치

---

## 보안 체크리스트

| # | 항목 | 상태 |
|---|------|------|
| 1 | XSS 방지: snippet에 `dangerouslySetInnerHTML` 미사용 | PASS |
| 2 | API 경유: 모든 호출이 `apiFetch` 경유 (401 자동 리다이렉트) | PASS |
| 3 | 인코딩: 검색어/태그/경로를 URL에 넣을 때 `encodeURIComponent` 사용 | PASS |
| 4 | 타입 안전: `SearchResponse`, `TagsResponse`, `SNIPPET_MARK` 등 공유 타입 import | PASS |
| 5 | 이미지: `<img>` 태그만 사용 (D2-1 SVG XSS 방어) | PASS |

---

## 검증 결과

| 검증 | 결과 |
|------|------|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors (프론트엔드 파일) |
| `npm run build` | 성공 |

**참고**: `npm run lint`에서 `src/lib/search-index.ts`(백엔드 파일)에 1건의 `@typescript-eslint/no-require-imports` 에러가 있으나 프론트엔드 범위 밖이다.

---

## 미결 항목

- 없음. 계약 문서의 모든 요구사항을 구현 완료했다.
