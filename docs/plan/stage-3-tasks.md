# Stage 3 작업 분해 -- 검색 / 정렬 / 태그 (FTS5)

- 작성: `tech-lead` / 2026-07-24
- 계약 기준: [backend-stage-3-contract.md](../agent-work/backend-stage-3-contract.md) / [frontend-stage-3-contract.md](../agent-work/frontend-stage-3-contract.md)
- 타입 기준: [src/types/api.ts](../../src/types/api.ts) (Stage 0에서 정의 완료 -- 신규 타입 추가 불필요)
- 목표: FTS5 기반 전문 검색, 태그 집계/필터, 검색 UI, 색인 증분 갱신

---

## 선행 결정 (tech-lead 확정)

### D3-1. SQLite DB 파일 위치

**결정: `MARKDOWN_ROOT/.mdws/search.db`에 저장한다.**

- `MARKDOWN_ROOT` 하위에 메타데이터 디렉터리 `.mdws/`를 만든다.
- 이유: DB가 콘텐츠와 같은 파일시스템에 있어야 한다(백업 단위 일치, 경로 상대화 일관성).
- `.mdws/`는 숨김 디렉터리이므로 `/api/files`의 `!name.startsWith('.')` 필터에 의해 GridView에 노출되지 않는다.
- 별도 환경변수를 추가하지 않는다 -- `MARKDOWN_ROOT`에서 파생한다.
- 기존 `.thumbcache/`와 같은 패턴이다.

### D3-2. 색인 구축 전략

**결정: 서버 기동 시 증분 빌드 + 라우트 이벤트 즉시 갱신.**

- **초기 구축**: 서버 기동 시(모듈 초기화 시점) 디스크의 모든 `.md` 파일을 스캔하되,
  DB에 이미 존재하고 mtime이 동일한 파일은 건너뛴다(증분). 이를 통해 재시작 시 전량 재색인을 피한다.
- **이벤트 기반 갱신**: `/api/upload`, `PUT /api/file-content` 처리 완료 후 해당 파일 1건을 즉시 색인에 반영한다(Stage 2에 TODO 주석이 이미 있다).
- **chokidar 파일 감시**: 이번 단계에서는 도입하지 않는다(backlog P2-2). 앱 외부(파인더/터미널) 변경은 다음 서버 재시작 시 증분 빌드에서 포착된다.
- **색인 진행 중 표시**: 초기 구축이 완료되기 전에 `/api/search` 호출이 오면 `indexing: true`를 응답에 포함한다.

### D3-3. FTS5 테이블 스키마

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  subpath,
  title,
  body,
  tags,
  tokenize='trigram'
);

-- mtime 추적용 일반 테이블 (증분 빌드에 필요)
CREATE TABLE IF NOT EXISTS docs_meta (
  subpath TEXT PRIMARY KEY,
  mtime   INTEGER NOT NULL
);
```

- `subpath`는 `MARKDOWN_ROOT` 기준 상대 경로(POSIX 구분자). 검색 대상이면서 기본 키 역할.
- `title`은 frontmatter title. 없으면 파일명(확장자 제외).
- `body`는 frontmatter를 제거한 마크다운 본문 전체.
- `tags`는 frontmatter tags를 공백으로 join한 문자열(trigram 검색 시 공백이 구분자 역할).
- `docs_meta`에 `mtime`을 저장해 증분 빌드 시 변경 여부를 판단한다.

### D3-4. 검색 UI 배치

**결정: 워크스페이스 헤더에 검색 입력 필드를 추가한다.**

- 검색 결과는 별도 페이지가 아닌, 현재 GridView 영역을 대체하는 인라인 결과 목록으로 표시한다.
- 검색어가 비어 있으면 기존 GridView로 복귀한다.
- 키보드 단축키 `Cmd+K` / `Ctrl+K`로 검색 필드에 포커스.
- 디바운스 300ms.

### D3-5. 태그 UI 배치

**결정: 워크스페이스 페이지의 GridView 상단에 태그 칩 바를 추가한다.**

- `GET /api/tags`로 전체 태그 목록(이름 + 개수)을 가져온다.
- 태그 칩 클릭 시 `/api/files?tag=...`로 필터링한다(기존 Stage 2의 tag 필터 활용).
- 활성 태그는 시각적으로 구분한다(배경색 반전 등).
- "전체" 칩으로 필터 해제.

### D3-6. 정렬 드롭다운 확장

**결정: 기존 정렬(mtime/name/size)에 `ctime`(생성일)을 추가한다.**

- PLAN.md 4.5에 "다중 정렬 드롭다운(수정일/이름/크기/생성일순)"이 명시되어 있다.
- `SortKey` 타입에 `'ctime'`을 추가한다.
- 이는 `src/types/api.ts` 변경을 수반한다(유일한 타입 변경).

---

## 범위에 포함되는 엔드포인트

| 메서드 | 경로 | 담당 | 신규/변경 |
|--------|------|------|-----------|
| GET | `/api/search?q=` | backend-dev | **신규** |
| GET | `/api/tags` | backend-dev | **신규** |
| GET | `/api/files?path=&sort=&tag=` | backend-dev | **변경** (ctime 정렬 추가) |
| PUT | `/api/file-content` | backend-dev | **변경** (FTS5 갱신 훅 추가) |
| POST | `/api/upload` | backend-dev | **변경** (FTS5 갱신 훅 추가) |

타입은 `src/types/api.ts`에 이미 정의되어 있다:
`SearchResult`, `SearchResponse`, `SNIPPET_MARK`, `TagCount`, `TagsResponse`.

**변경 사항**: `SortKey`에 `'ctime'`을 추가한다.

**신규 라이브러리 모듈**: `src/lib/search-index.ts` -- FTS5 색인 관리 단일 모듈.

---

## 실행 순서 (Wave)

```
Wave 0 ── tech-lead  : 타입 변경(SortKey += 'ctime'), 계약 문서 확정
              ↓
Wave 1 ──┬── backend-dev   : search-index.ts + /api/search + /api/tags
         │                    + /api/files(ctime) + upload/file-content FTS5 훅
         └── frontend-dev  : 검색 바 + 결과 목록 + 태그 칩 바 + ctime 정렬 옵션
              ↓                                  (계약만 보고 병렬)
Wave 2 ──┬── backend-validator    (fable)
         └── frontend-validator   (fable)         동시 실행
              ↓
Wave 3 ───── qa-integration → optimizer           (fable)
```

**임계 경로**: Wave 0(타입 변경 1줄) 완료 후 Wave 1 착수. 프론트/백엔드는 완전 병렬.

**의존성 확인**: Stage 1-2 산출물(`path-safety`, `session`, `api-response`, `env`, `rate-limit`, `fetcher`, `file-utils`, `gray-matter`)이 모두 완성되어 있으므로 즉시 착수 가능. `better-sqlite3@^13.0.1`은 Stage 0에서 설치 완료.

---

## Wave 0 -- tech-lead (opus)

| # | 작업 | 산출물 |
|---|------|--------|
| 1 | `SortKey` 타입에 `'ctime'` 추가 | `src/types/api.ts` |
| 2 | 계약 문서 확정 | `docs/agent-work/backend-stage-3-contract.md`, `frontend-stage-3-contract.md` |
| 3 | 이 작업 계획 문서 | `docs/plan/stage-3-tasks.md` (본 문서) |

---

## Wave 1-A -- backend-dev (opus)

Stage 1-2의 `path-safety`, `api-response`, `env`, `file-utils` 유틸을 그대로 사용한다.

### 보안 불변식 준수 사항

- `export const runtime = 'nodejs'` -- 모든 라우트
- 모든 `path` 파라미터: `resolveUnderRoot` -> `assertRealPathUnderRoot` (불변식 2)
- `verifySession`은 middleware가 처리 -- 라우트에서 중복 호출 불필요
- 에러 응답은 `apiError()` / `internalError()` 경유 (불변식 8)
- `/api/search`에서 `subpath`를 반환할 때 `toSubpath()` 경유 (불변식 8)
- SQLite DB 경로가 `MARKDOWN_ROOT` 하위임을 보장

| # | 작업 | 산출물 | 보안 불변식 |
|---|------|--------|-------------|
| 1 | `search-index.ts` -- FTS5 색인 관리 모듈 | `src/lib/search-index.ts` | 2, 8 |
| 2 | `GET /api/search?q=` -- FTS5 검색 라우트 | `src/app/api/search/route.ts` | 2, 8 |
| 3 | `GET /api/tags` -- 태그 집계 라우트 | `src/app/api/tags/route.ts` | 8 |
| 4 | `GET /api/files` -- ctime 정렬 추가 | `src/app/api/files/route.ts` 수정 | 기존 유지 |
| 5 | upload/file-content에 FTS5 갱신 훅 삽입 | 기존 라우트 수정 | 기존 유지 |
| 6 | 색인 초기 빌드 스크립트 (수동 실행용) | `src/scripts/rebuild-index.mts` | -- |
| 7 | search-index 유닛 테스트 | `src/lib/search-index.test.ts` | -- |

### 상세 요구사항

**1. `src/lib/search-index.ts`**
- `better-sqlite3`로 `MARKDOWN_ROOT/.mdws/search.db`를 연다.
- 모듈 수준에서 DB 인스턴스를 싱글턴으로 유지한다(프로세스 수명 = DB 수명).
- `initIndex()`: 테이블 생성 + 증분 빌드. 서버 기동 시 1회 호출.
  - 디스크의 `.md` 파일을 재귀 스캔하고 `docs_meta.mtime`과 비교해 변경분만 색인.
  - 디스크에 없는 파일은 색인에서 삭제(삭제 감지).
  - 초기 빌드 완료 전까지 `isIndexing()` = true.
- `indexFile(subpath)`: 파일 1건을 색인에 upsert. upload/file-content PUT에서 호출.
- `removeFromIndex(subpath)`: 파일 삭제 시(향후). 현재는 내부 메서드.
- `search(query, limit?)`: FTS5 MATCH + snippet() + BM25 정렬. `SearchResult[]` 반환.
- `getAllTags()`: `docs_fts`에서 tags 컬럼을 파싱해 태그별 개수를 집계. `TagCount[]` 반환.
- 모든 경로는 `toSubpath()` 형태의 상대 경로로 저장한다. 절대 경로 저장 금지.

**2. `GET /api/search?q=`**
- `q`가 없거나 빈 문자열이면 400.
- `q`의 최소 길이 = 2자 (trigram은 3자 단위이므로 2자 미만은 의미 없음, 단 한글 1자는 3바이트이므로 2자 제한).
- 최대 결과 수 = 50.
- `search-index.ts`의 `search()` 호출.
- 응답: `SearchResponse` = `{ query, results, indexing? }`.
- `snippet()`에 `SNIPPET_MARK.open`/`close`를 마커로 전달.
- 결과의 `subpath`는 클라이언트가 `/workspace/view?path=...`로 이동하는 데 사용.

**3. `GET /api/tags`**
- `search-index.ts`의 `getAllTags()` 호출.
- 응답: `TagsResponse` = `{ tags: TagCount[] }`.
- 태그는 개수 내림차순 정렬.
- 색인이 미완성이면 빈 배열을 반환한다(에러가 아님).

**4. `GET /api/files` -- ctime 정렬 추가**
- `SortKey`에 `'ctime'`이 추가되었으므로 `VALID_SORT_KEYS`와 switch문에 `'ctime'` 케이스 추가.
- `stat.birthtimeMs` 사용 (macOS는 생성일을 지원한다).
- 내림차순(최신 생성 우선).

**5. upload/file-content FTS5 갱신 훅**
- 기존 TODO 주석 위치에 `indexFile(toSubpath(absolutePath))` 호출 추가.
- `import { indexFile } from '@/lib/search-index'`
- 색인 갱신 실패가 업로드/저장 자체를 실패시키지 않는다 -- try/catch로 감싸고 서버 로깅만 한다.
- 이유: 색인은 부차적이다. 다음 초기 빌드에서 복구된다.

**6. `src/scripts/rebuild-index.mts`**
- CLI에서 수동 색인 전체 재구축: `npx tsx src/scripts/rebuild-index.mts`
- 기존 DB를 삭제하고 새로 구축한다.
- `package.json`의 `scripts`에 `"rebuild-index"` 추가.

---

## Wave 1-B -- frontend-dev (opus)

`fetcher.ts`의 `apiFetch`를 모든 API 호출에 사용한다.

| # | 작업 | 산출물 | 호출 API |
|---|------|--------|----------|
| 1 | 검색 바 컴포넌트 | `src/components/workspace/SearchBar.tsx` | GET /api/search |
| 2 | 검색 결과 목록 컴포넌트 | `src/components/workspace/SearchResults.tsx` | (props) |
| 3 | 태그 칩 바 컴포넌트 | `src/components/workspace/TagBar.tsx` | GET /api/tags |
| 4 | `/workspace` 페이지 확장 | `src/app/workspace/page.tsx` 수정 | GET /api/tags |
| 5 | ctime 정렬 옵션 추가 | `src/app/workspace/page.tsx` 수정 | (타입만) |

### 상세 요구사항

**1. SearchBar**
- `<input>` + 돋보기 아이콘(lucide `Search`).
- `Cmd+K` / `Ctrl+K`로 포커스.
- `Escape`로 검색 해제(검색어 초기화 + GridView 복귀).
- 디바운스 300ms.
- 검색 중 로딩 인디케이터(스피너).
- `indexing === true`이면 "색인 구축 중..." 안내.
- 최소 2자 이상 입력 시 검색 실행.
- 검색어가 비면 `onClear` 콜백으로 부모에 통지.

**2. SearchResults**
- `SearchResult[]`를 카드 목록으로 표시.
- 각 카드: 제목(title) + 하이라이트된 snippet + tags + mtime.
- snippet 내 `[[hl]]...[[/hl]]` 구간을 `<mark>` 태그로 변환.
  - **주의**: `dangerouslySetInnerHTML` 사용 금지. 문자열을 파싱해 React 엘리먼트로 조립한다.
- 카드 클릭 시 `/workspace/view?path=<subpath>`로 이동.
- 결과 0건이면 "검색 결과가 없습니다" 안내.
- 커버 썸네일이 있으면 왼쪽에 소형 이미지.

**3. TagBar**
- 수평 스크롤 가능한 칩 목록.
- 칩: 태그명 + 개수 뱃지.
- "전체" 칩(항상 맨 앞, 필터 해제용).
- 활성 태그: 배경 반전(dark: white on black, light: black on white).
- 클릭 시 `onTagSelect(tag | null)` 콜백.
- 태그가 없으면 바 자체를 숨긴다.

**4. `/workspace` 페이지 확장**
- 헤더에 SearchBar 배치(정렬 드롭다운 왼쪽).
- SearchBar에 검색어가 있으면 GridView 대신 SearchResults를 렌더.
- Breadcrumb 아래, GridView 위에 TagBar 배치.
- TagBar에서 태그 선택 시 `GET /api/files?tag=...` 호출(기존 tag 필터 활용).
- 검색 모드에서는 TagBar를 숨긴다(검색 결과에 이미 태그가 포함됨).

**5. ctime 정렬 옵션**
- `SORT_OPTIONS`에 `{ value: 'ctime', label: '생성일' }` 추가.

---

## Wave 2 -- 검증 (fable)

`backend-validator`와 `frontend-validator`가 동시에 실행한다.

### backend-validator 체크리스트

| # | 검증 항목 | 통과 조건 |
|---|-----------|-----------|
| 1 | `npm run typecheck` | 오류 0 |
| 2 | `npm test` | 전체 통과, 실패 0 |
| 3 | `npm run lint` | 오류 0 |
| 4 | `npm run build` | 성공 |
| 5 | `/api/search?q=테스트` 동작 | 200 + `SearchResponse` 형태 |
| 6 | `/api/search` snippet 하이라이트 | `[[hl]]` 마커가 결과에 포함 |
| 7 | `/api/search` BM25 정렬 | 관련도 높은 문서가 상위 |
| 8 | `/api/tags` 동작 | 200 + `TagsResponse` 형태, 개수 정확 |
| 9 | `/api/files?sort=ctime` 동작 | 생성일 내림차순 정렬 확인 |
| 10 | upload 후 색인 갱신 | 업로드 직후 `/api/search`에서 해당 파일 검색 가능 |
| 11 | file-content PUT 후 색인 갱신 | 편집 저장 후 변경된 내용이 검색에 반영 |
| 12 | 보안 불변식 2 | `/api/search` 응답에 절대 경로 없음 |
| 13 | 보안 불변식 8 | 에러 응답에 내부 정보 없음 |
| 14 | `runtime = 'nodejs'` | search, tags 라우트에 선언 |
| 15 | 미인증 요청 | search, tags 라우트 401 |
| 16 | search-index 유닛 테스트 | trigram 검색, 한글 부분일치, 증분 빌드, 삭제 감지 |
| 17 | SQLite DB가 `.mdws/` 하위 | 다른 위치에 DB 파일 없음 |
| 18 | 색인 갱신 실패 시 업로드/저장 성공 | try/catch 확인 |

### frontend-validator 체크리스트

| # | 검증 항목 | 통과 조건 |
|---|-----------|-----------|
| 1 | 빌드 성공 | `npm run build` 에러 없음 |
| 2 | 검색 바 렌더 | 헤더에 검색 입력 필드 표시 |
| 3 | `Cmd+K` 포커스 | 키보드 단축키로 검색 필드 포커스 |
| 4 | 디바운스 동작 | 300ms 디바운스 확인 |
| 5 | 검색 결과 렌더 | SearchResult 카드 올바르게 표시 |
| 6 | snippet 하이라이트 | `[[hl]]` 구간이 `<mark>`로 변환 |
| 7 | `dangerouslySetInnerHTML` 미사용 | 검색 결과에서 raw HTML 삽입 없음 |
| 8 | 결과 클릭 -> 뷰어 이동 | `/workspace/view?path=...`로 정확히 이동 |
| 9 | 태그 칩 바 렌더 | 태그 + 개수 표시, 스크롤 가능 |
| 10 | 태그 클릭 필터 | 클릭 시 GridView가 해당 태그 파일만 표시 |
| 11 | "전체" 칩 동작 | 필터 해제 + 전체 목록 복귀 |
| 12 | ctime 정렬 옵션 | 드롭다운에 "생성일" 표시 + 동작 |
| 13 | 검색 모드에서 TagBar 숨김 | 검색 활성 시 태그 바 미표시 |
| 14 | `Escape`로 검색 해제 | 검색어 초기화 + GridView 복귀 |
| 15 | `indexing` 안내 표시 | 색인 미완성 시 안내 메시지 |
| 16 | 모든 API 호출이 `apiFetch` 경유 | raw fetch 사용 없음 |

---

## Wave 3 -- qa-integration + optimizer (fable)

- qa-integration: 전체 흐름 E2E
  - 로그인 -> 업로드 -> 검색으로 방금 올린 파일 확인
  - 편집 저장 -> 검색으로 변경 내용 반영 확인
  - 태그 필터 -> GridView 필터링
  - 정렬 드롭다운 전체 옵션(mtime/name/size/ctime)
- optimizer: SQLite 쿼리 성능, 검색 디바운스 효율, 불필요한 리렌더 점검

---

## 단계 완료 조건

1. `/api/search?q=한글`로 FTS5 trigram 한글 부분일치 검색 동작
2. snippet()으로 매치 구간 하이라이트 + BM25 관련도 정렬
3. `/api/tags`로 frontmatter 태그 + 개수 집계
4. 업로드/편집 저장 후 색인 즉시 갱신(증분)
5. 검색 바(Cmd+K) + 디바운스 + 인라인 결과 목록 동작
6. 태그 칩 바 + 클릭 필터 동작
7. ctime(생성일) 정렬 추가
8. 색인 구축 중 `indexing: true` 안내
9. SQLite DB가 `MARKDOWN_ROOT/.mdws/search.db`에 위치
10. `npm run build` / `typecheck` / `test` / `lint` 통과
11. 검증 리포트 FAIL 0건
