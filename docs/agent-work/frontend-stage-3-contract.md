# Frontend Stage 3 계약 -- 검색 / 정렬 / 태그 UI

- 작성: `tech-lead` / 2026-07-24
- 상태: **확정**
- 타입 기준: [src/types/api.ts](../../src/types/api.ts)
- 결정 참조: [stage-3-tasks.md](../plan/stage-3-tasks.md) D3-4 ~ D3-6

---

## 1. SearchBar 컴포넌트

**파일**: `src/components/workspace/SearchBar.tsx`

### Props

```typescript
interface SearchBarProps {
  /** 검색 결과를 부모에 전달. 결과가 있으면 부모가 GridView 대신 SearchResults를 렌더. */
  onResults: (results: SearchResult[], query: string, indexing: boolean) => void;
  /** 검색 해제(검색어 비워짐). 부모가 GridView로 복귀. */
  onClear: () => void;
}
```

### 동작

1. `<input type="text" placeholder="검색... (Cmd+K)">`
2. `Cmd+K` (Mac) / `Ctrl+K` (기타)로 input에 포커스.
   - `useEffect`에서 전역 `keydown` 리스너 등록.
   - `event.preventDefault()`로 브라우저 기본 동작 차단.
3. `Escape` 키로 검색 해제:
   - 입력 값 초기화 + `onClear()` 호출.
4. 디바운스 300ms:
   - 입력값이 2자 이상이면 `apiFetch<SearchResponse>('/api/search?q=...')` 호출.
   - 2자 미만이면 요청하지 않고 `onClear()` 호출.
5. 로딩 중 돋보기 아이콘을 스피너로 교체.
6. 에러 시 토스트(fetcher가 자동 처리).

### UI 레이아웃

```
[Search icon] [__검색 입력 필드__] [X 클리어 버튼]
```

- 돋보기 아이콘: lucide `Search` (또는 로딩 시 `Loader2`).
- 클리어 버튼: 검색어가 있을 때만 표시. 클릭 시 검색 해제.
- 헤더 내 정렬 드롭다운 왼쪽에 배치.

### API 호출

```typescript
const data = await apiFetch<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`);
onResults(data.results, data.query, data.indexing ?? false);
```

---

## 2. SearchResults 컴포넌트

**파일**: `src/components/workspace/SearchResults.tsx`

### Props

```typescript
interface SearchResultsProps {
  query: string;
  results: SearchResult[];
  indexing: boolean;
}
```

### 동작

1. `results`를 카드 목록으로 렌더.
2. 각 카드 구성:
   - **제목**: `result.title`
   - **하이라이트 snippet**: `result.snippet` 내 `[[hl]]...[[/hl]]` 구간을 `<mark>` 태그로 변환.
   - **태그 칩**: `result.tags` (있으면)
   - **수정일**: `result.mtime`을 사람이 읽는 형태로 포맷 (예: "2시간 전", "2026-07-24")
   - **커버 이미지**: `result.coverThumbUrl` (있으면, 좌측 소형 이미지)
3. 카드 클릭 -> `router.push('/workspace/view?path=<subpath>')`.
4. 결과 0건이면 "검색 결과가 없습니다" 안내.
5. `indexing === true`이면 상단에 "색인 구축 중입니다. 일부 결과가 누락될 수 있습니다." 안내.

### snippet 하이라이트 파싱

**중요**: `dangerouslySetInnerHTML` 사용 금지.

```typescript
import { SNIPPET_MARK } from '@/types/api';

function parseSnippet(snippet: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = snippet;
  let key = 0;

  while (remaining.length > 0) {
    const openIdx = remaining.indexOf(SNIPPET_MARK.open);
    if (openIdx === -1) {
      parts.push(remaining);
      break;
    }

    // 마커 앞 텍스트
    if (openIdx > 0) {
      parts.push(remaining.slice(0, openIdx));
    }

    // 마커 뒤 닫는 마커까지
    const afterOpen = remaining.slice(openIdx + SNIPPET_MARK.open.length);
    const closeIdx = afterOpen.indexOf(SNIPPET_MARK.close);
    if (closeIdx === -1) {
      parts.push(remaining);
      break;
    }

    const highlighted = afterOpen.slice(0, closeIdx);
    parts.push(<mark key={key++} className="bg-yellow-200 dark:bg-yellow-700/50">{highlighted}</mark>);
    remaining = afterOpen.slice(closeIdx + SNIPPET_MARK.close.length);
  }

  return parts;
}
```

### UI 레이아웃

```
(검색 결과 N건)
(indexing 안내 -- 색인 구축 중이면 표시)

[카드 1]
  [썸네일?] [제목]
            [하이라이트된 snippet]
            [태그 칩들] [수정일]

[카드 2]
  ...
```

---

## 3. TagBar 컴포넌트

**파일**: `src/components/workspace/TagBar.tsx`

### Props

```typescript
interface TagBarProps {
  tags: TagCount[];
  /** 현재 활성 태그. null이면 "전체" 선택 상태. */
  activeTag: string | null;
  onTagSelect: (tag: string | null) => void;
}
```

### 동작

1. 수평 스크롤 가능한 칩 목록 (`overflow-x-auto flex gap-2`).
2. 맨 앞에 "전체" 칩 (필터 해제용). 클릭 시 `onTagSelect(null)`.
3. 각 태그 칩: `태그명 (N)` 형태. 클릭 시 `onTagSelect(tag)`.
4. 활성 태그:
   - Light: `bg-zinc-900 text-white`
   - Dark: `bg-zinc-100 text-zinc-900`
5. 비활성 태그:
   - Light: `bg-zinc-100 text-zinc-700 hover:bg-zinc-200`
   - Dark: `bg-zinc-800 text-zinc-300 hover:bg-zinc-700`
6. `tags`가 빈 배열이면 TagBar 자체를 렌더하지 않는다 (`return null`).

### UI 레이아웃

```
[전체] [react (5)] [여행 (3)] [개발 (2)] ...
 ^^^활성^^^
```

---

## 4. `/workspace` 페이지 확장

**파일**: `src/app/workspace/page.tsx` (수정)

### 상태 추가

```typescript
// 검색 상태
const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
const [searchQuery, setSearchQuery] = useState('');
const [searchIndexing, setSearchIndexing] = useState(false);

// 태그 상태
const [tags, setTags] = useState<TagCount[]>([]);
const [activeTag, setActiveTag] = useState<string | null>(null);
```

### 태그 로딩

```typescript
// 마운트 시 + refreshKey 변경 시 태그 목록 조회
useEffect(() => {
  (async () => {
    try {
      const data = await apiFetch<TagsResponse>('/api/tags');
      setTags(data.tags);
    } catch {
      // 태그 로딩 실패는 치명적이지 않음 -- 바를 숨기면 된다
    }
  })();
}, [refreshKey]);
```

### 태그 필터

```typescript
function handleTagSelect(tag: string | null) {
  setActiveTag(tag);
  // tag가 null이면 전체 -- GET /api/files?path=...
  // tag가 있으면 -- GET /api/files?path=...&tag=태그
  // loadFiles 함수를 확장해 tag 파라미터 전달
}
```

`loadFiles` 함수 시그니처 변경:

```typescript
async function loadFiles(path: string, sortKey: SortKey, tag?: string): Promise<FilesResponse> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  params.set('sort', sortKey);
  if (tag) params.set('tag', tag);
  return apiFetch<FilesResponse>(`/api/files?${params.toString()}`);
}
```

### 검색 콜백

```typescript
function handleSearchResults(results: SearchResult[], query: string, indexing: boolean) {
  setSearchResults(results);
  setSearchQuery(query);
  setSearchIndexing(indexing);
}

function handleSearchClear() {
  setSearchResults(null);
  setSearchQuery('');
  setSearchIndexing(false);
}
```

### 렌더 구조

```tsx
<header>
  <h1>MD Workspace</h1>
  <SearchBar onResults={handleSearchResults} onClear={handleSearchClear} />
  <select ... /> {/* 정렬 -- 검색 모드에서도 표시하되 비활성화 */}
  <button>업로드</button>
  <button>로그아웃</button>
</header>

<main>
  <Breadcrumb ... />

  {/* 검색 모드가 아닐 때만 TagBar 표시 */}
  {!searchResults && tags.length > 0 && (
    <TagBar tags={tags} activeTag={activeTag} onTagSelect={handleTagSelect} />
  )}

  {/* 검색 모드 */}
  {searchResults ? (
    <SearchResults query={searchQuery} results={searchResults} indexing={searchIndexing} />
  ) : (
    /* 기존 GridView */
    loading ? <Spinner /> : error ? <ErrorBox /> : <GridView ... />
  )}
</main>
```

### 정렬 드롭다운 확장

```typescript
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'mtime', label: '수정일' },
  { value: 'name', label: '이름 A-Z' },
  { value: 'size', label: '파일 크기' },
  { value: 'ctime', label: '생성일' },  // <-- 추가
];
```

---

## 5. API 호출 요약

| API | 사용 시점 | 컴포넌트 |
|-----|-----------|----------|
| `GET /api/search?q=...` | SearchBar 디바운스 후 | SearchBar |
| `GET /api/tags` | 페이지 마운트 / refreshKey 변경 | workspace page |
| `GET /api/files?tag=...` | TagBar 태그 클릭 | workspace page (기존 loadFiles 확장) |

---

## 6. 스타일 가이드라인

- 기존 Stage 2 UI와 일관된 디자인 언어 유지.
- Tailwind 클래스만 사용 (인라인 스타일 금지).
- Dark mode 대응 (`dark:` prefix).
- lucide-react 아이콘 사용 (`Search`, `X`, `Tag`, `Loader2`).
- 반응형: 모바일에서 SearchBar가 전폭, TagBar가 수평 스크롤.

---

## 7. 프론트엔드 보안 체크리스트

| # | 항목 | 확인 사항 |
|---|------|-----------|
| 1 | XSS 방지 | snippet 하이라이트에 `dangerouslySetInnerHTML` 사용 금지 |
| 2 | API 경유 | 모든 호출이 `apiFetch` 경유 (401 자동 리다이렉트) |
| 3 | 인코딩 | 검색어/태그를 URL에 넣을 때 `encodeURIComponent` 사용 |
| 4 | 타입 안전 | `SearchResponse`, `TagsResponse` 등 공유 타입 import |
