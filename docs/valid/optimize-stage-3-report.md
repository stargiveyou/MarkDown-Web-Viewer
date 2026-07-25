# 최적화/에러 리포트 -- Stage 3

- 검증 일시: 2026-07-25
- 검증 담당: optimizer (fable)
- 대상: Stage 3 신규/변경 파일 (검색/정렬/태그)
- 기존 FAIL 항목(SearchBar `onClear` 1자 미호출)은 이미 `docs/valid/frontend-stage-3-validation.md` FAIL #32 및 `docs/plan/backlog.md` P0 #1에 등록되어 있으므로 중복 보고하지 않음

---

## 오류 (수정 필요)

| 심각도 | 위치(파일:라인) | 문제 | 재현/영향 | 제안 |
|--------|----------------|------|-----------|------|
| 높음 | `src/lib/search-index.ts:192-198` | `indexFile()` 내 트랜잭션에서 매 호출마다 `d.prepare()` 3회 실행. better-sqlite3의 `prepare()`는 SQLite의 `sqlite3_prepare_v2()`를 호출하는 비교적 비싼 연산이며, 동일 SQL 문자열을 반복 파싱한다. **오류가 아니라 성능 문제**이지만, `incrementalBuild()` 중 수백~수천 파일을 순차 처리할 때 빌드 시간에 직접 영향을 준다. | 100개 파일 증분 빌드 시 `prepare()` 300회 + `removeFromIndex` 추가 호출. 파일이 1,000개면 3,000회. | 모듈 수준에서 `ensureDb()` 직후 prepared statement를 캐싱. 아래 성능 E-1 참조. |
| 중간 | `src/lib/search-index.ts:258` | `search()` 내 N+1 쿼리: FTS5 결과 N건에 대해 `docs_meta` SELECT를 1건씩 반복. 50건 검색 결과에 51개 쿼리가 발생한다. | limit=50 기본값 기준 51개 쿼리 실행. better-sqlite3는 동기이고 같은 프로세스 내 DB이므로 네트워크 오버헤드는 없지만, prepared statement 실행 + row 파싱이 50회 반복된다. | JOIN으로 단일 쿼리 통합. 아래 성능 S-1 참조. |
| 중간 | `src/lib/search-index.ts:70-104` | `ensureDb()` 내부에서 `initIndex()`를 호출하고, `initIndex()` -> `incrementalBuild()` -> `ensureDb()`로 재진입하는 순환 경로가 존재한다. 현재는 `:71`의 `if (db) return db` 가드 덕분에 무한 루프는 발생하지 않지만, `ensureDb()` 호출 시점에 `db` 변수가 이미 할당(`db = new Database(...)`, `:77`)되어 있어 **우연히** 동작한다. 이 암묵적 의존은 리팩터링 시 버그 원인이 될 수 있다. | `ensureDb()` -> `initIndex()` -> `incrementalBuild()` -> `ensureDb()` 경로에서, `:77`에서 `db`가 할당된 후 `:101`에서 `initIndex()`가 호출되므로 재진입 시 `:71`에서 바로 반환된다. 그러나 만약 `db` 할당 전에 `initIndex()`가 호출되면 재귀 무한 루프에 빠진다. | `initIndex()`를 `ensureDb()` 내부에서 분리하고, 첫 `search()`/`getAllTags()` 호출 시점에 한 번만 실행하도록 명시적 플래그를 사용. |
| 낮음 | `src/lib/search-index.ts:75` | `nodeFs.mkdirSync(dir, { recursive: true })` -- 요청 경로에서 `ensureDb()`가 호출될 때 매번 동기 `mkdirSync`가 실행된다. `db` 싱글턴 가드(`:71`) 덕분에 첫 호출 이후에는 도달하지 않지만, 서버 기동 직후 첫 검색/태그 요청 시 이벤트 루프를 블로킹한다. | 서버 콜드 스타트 시 1회만 실행. `.mdws` 디렉터리가 이미 존재하면 `mkdirSync`는 빠르게 반환하므로 실질적 블로킹은 미미하다. | 첫 호출 1회이므로 실질 영향 없음. 기록만 남긴다. |

---

## 성능 개선 (권장)

### S-1. search() N+1 쿼리 -> JOIN 통합

| 항목 | 내용 |
|------|------|
| 영향도 | 중간 |
| 위치 | `src/lib/search-index.ts:243-270` |
| 현재 동작 | FTS5 SELECT 1회 + `docs_meta` SELECT N회 (N = 결과 수, 최대 50) |
| 비용 | limit=50 기준 51개 SQLite 쿼리 실행. better-sqlite3 동기 호출이라 이벤트 루프 점유가 51배. |
| 제안 | FTS5 테이블과 `docs_meta`를 JOIN하여 단일 쿼리로 통합: |

```sql
SELECT
  f.subpath,
  f.title,
  snippet(docs_fts, 2, '[[hl]]', '[[/hl]]', '...', 40) AS snippet,
  f.rank AS score,
  f.tags,
  m.mtime
FROM docs_fts f
LEFT JOIN docs_meta m ON m.subpath = f.subpath
WHERE docs_fts MATCH ?
ORDER BY f.rank
LIMIT ?
```

이렇게 하면 N+1이 단일 쿼리 1회로 줄어든다.

---

### S-2. Prepared Statement 캐싱

| 항목 | 내용 |
|------|------|
| 영향도 | 중간 |
| 위치 | `src/lib/search-index.ts:192-198, 209-210, 243-254, 258, 288, 344` |
| 현재 동작 | `d.prepare(SQL)` 호출이 함수 호출마다 반복. `indexFile()`은 3회, `removeFromIndex()`는 2회, `search()`는 2회, `getAllTags()`는 1회. 매번 SQLite 파서가 SQL을 파싱하고 쿼리 계획을 생성한다. |
| 비용 | 증분 빌드 시 파일 1,000개 -> `prepare()` 3,000회. 검색 호출마다 2회(JOIN 통합 후 1회). |
| 제안 | `ensureDb()` 반환 후 lazy-init되는 모듈 수준 객체에 prepared statement를 캐싱한다: |

```typescript
let stmts: {
  deleteDoc: Database.Statement;
  insertDoc: Database.Statement;
  insertMeta: Database.Statement;
  deleteMeta: Database.Statement;
  search: Database.Statement;
  allTags: Database.Statement;
  allMeta: Database.Statement;
} | null = null;

function getStmts() {
  if (stmts) return stmts;
  const d = ensureDb();
  stmts = {
    deleteDoc: d.prepare('DELETE FROM docs_fts WHERE subpath = ?'),
    insertDoc: d.prepare('INSERT INTO docs_fts (subpath, title, body, tags) VALUES (?, ?, ?, ?)'),
    insertMeta: d.prepare('INSERT OR REPLACE INTO docs_meta (subpath, mtime) VALUES (?, ?)'),
    deleteMeta: d.prepare('DELETE FROM docs_meta WHERE subpath = ?'),
    search: d.prepare(`SELECT ... FROM docs_fts ... LIMIT ?`),
    allTags: d.prepare("SELECT tags FROM docs_fts WHERE tags != ''"),
    allMeta: d.prepare('SELECT subpath, mtime FROM docs_meta'),
  };
  return stmts;
}
```

better-sqlite3 공식 문서에서도 prepared statement 재사용을 권장한다.

---

### S-3. getAllTags() 전체 스캔 -> 태그 집계 테이블

| 항목 | 내용 |
|------|------|
| 영향도 | 낮음 (현재 규모에서) -> 중간 (파일 수 증가 시) |
| 위치 | `src/lib/search-index.ts:284-301` |
| 현재 동작 | `SELECT tags FROM docs_fts WHERE tags != ''`로 전체 행을 가져온 뒤 JS에서 split/집계. 문서 1,000개 기준 1,000행의 tags 컬럼을 모두 전송+파싱. |
| 비용 | FTS5 테이블 전체 스캔. 문서 수에 선형 비례. `/api/tags` 호출마다 실행되며, `page.tsx:109-118`에서 `refreshKey` 변경 시마다 재호출. |
| 제안 | 별도 `docs_tags` 테이블(`tag TEXT, doc_subpath TEXT, PRIMARY KEY(tag, doc_subpath)`)을 만들고 `indexFile()`/`removeFromIndex()` 시 함께 갱신. 태그 집계는 `SELECT tag, COUNT(*) FROM docs_tags GROUP BY tag ORDER BY COUNT(*) DESC`로 대체. **ADR 변경 불필요** -- 내부 구현 최적화이므로 tech-lead에게 안건만 올린다. |

---

### S-4. /api/search, /api/tags 응답에 Cache-Control 헤더 누락

| 항목 | 내용 |
|------|------|
| 영향도 | 낮음 |
| 위치 | `src/app/api/search/route.ts:41`, `src/app/api/tags/route.ts:25` |
| 현재 동작 | `NextResponse.json()`만 반환. 브라우저가 매번 서버에 요청. `/api/thumbnail`은 `Cache-Control: public, max-age=86400, immutable`을 설정하고 있다(`:95, :125`). |
| 비용 | 같은 검색어를 연속 입력(백스페이스 후 재입력)할 때 불필요한 네트워크 왕복. |
| 제안 | 검색 결과는 변경 빈도가 낮으므로 `Cache-Control: private, max-age=5`(5초) 정도 설정. 태그는 `max-age=30` 정도. 단, 인증 세션 기반이므로 `public` 대신 `private`를 사용해야 한다(보안 불변식 유지). |

---

### S-5. scanMarkdownFiles() 순차 `fs.stat()` N회

| 항목 | 내용 |
|------|------|
| 영향도 | 낮음 (증분 빌드 시에만, 요청 경로 아님) |
| 위치 | `src/lib/search-index.ts:139-142` |
| 현재 동작 | `walk()` 내 각 `.md` 파일에 대해 `await fs.stat(fullPath)`를 순차 실행. 디렉터리 하나에 파일 100개 있으면 100번 순차 syscall. |
| 비용 | 요청 경로가 아니라 백그라운드 증분 빌드이므로 사용자 체감 영향 없음. 서버 기동 시 빌드 완료 시간에만 영향. |
| 제안 | `readdir({ withFileTypes: true })`가 반환하는 `Dirent`에는 `isFile()` 정보만 있고 `mtimeMs`가 없어 `stat()` 호출이 불가피. 병렬 배치(`Promise.all` 청크)로 변경하면 빌드 시간을 줄일 수 있으나, 백그라운드 작업이므로 우선순위 낮음. |

---

### C-1. workspace/page.tsx -- handleTagSelect, handleBreadcrumbNavigate 등 미메모이징

| 항목 | 내용 |
|------|------|
| 영향도 | 낮음 |
| 위치 | `src/app/workspace/page.tsx:150, 173, 184, 189` |
| 현재 동작 | `handleTagSelect`, `handleBreadcrumbNavigate`, `handleFolderClick`, `handleFileClick`은 일반 함수 선언으로 매 렌더마다 새 참조 생성. `handleSearchResults`와 `handleSearchClear`는 `useCallback`으로 감쌌는데 이것들은 안 감쌈. |
| 비용 | `TagBar`, `Breadcrumb`, `GridView`에 새 함수 참조가 전달되어 `React.memo`를 감싸도 리렌더를 막을 수 없다. 현재 이 컴포넌트들이 `React.memo`를 사용하지 않으므로 참조 안정성이 실질적 영향은 없다. 단, 향후 메모이징 최적화 시 장애물이 된다. |
| 제안 | 일관성을 위해 `useCallback`으로 감싸두되, 현재 단계에서는 체감 차이 없으므로 후순위. |

---

### C-2. SearchResults.parseSnippet() 매 렌더마다 재실행

| 항목 | 내용 |
|------|------|
| 영향도 | 낮음 |
| 위치 | `src/components/workspace/SearchResults.tsx:159` |
| 현재 동작 | `results.map()` 내에서 `parseSnippet(result.snippet)`이 매 렌더마다 호출되어 문자열 파싱 + ReactNode 배열 생성 반복. |
| 비용 | 50건 결과 기준 50회 문자열 파싱. 파싱 자체가 가벼우므로(indexOf 반복) 실측 영향 미미. |
| 제안 | `useMemo`로 `results`가 바뀔 때만 재계산하도록 할 수 있으나, 현재 규모에서 이점 미미. 기록만 남긴다. |

---

### C-3. incrementalBuild()에서 indexFile()이 파일마다 fs.readFile + fs.stat 2회 호출

| 항목 | 내용 |
|------|------|
| 영향도 | 낮음 (백그라운드 빌드, 요청 경로 아님) |
| 위치 | `src/lib/search-index.ts:167, 184` (indexFile 내) + `:140-142` (scanMarkdownFiles 내) |
| 현재 동작 | `scanMarkdownFiles()`에서 이미 `stat()`을 호출하여 `mtimeMs`를 수집한다. 이후 `indexFile()` 내에서 다시 `readFile()` + `stat()`를 호출한다. 파일당 `stat()` 2회. |
| 비용 | 1,000개 파일 빌드 시 `stat()` 2,000회 (1,000회 중복). |
| 제안 | `incrementalBuild()`에서 `indexFile(subpath)` 대신 내부 헬퍼를 만들어 `scanMarkdownFiles()`에서 읽은 mtime을 전달하면 stat 1회 절감. 단, `indexFile()`은 upload/file-content 훅에서도 독립 호출되므로 공용 인터페이스는 유지해야 한다. |

---

## 보안 확인 (추가 소견)

### SEC-1. SNIPPET_MARK 값의 SQL 문자열 보간 -- 안전

| 항목 | 내용 |
|------|------|
| 위치 | `src/lib/search-index.ts:247` |
| 현재 동작 | `snippet(docs_fts, 2, '${SNIPPET_MARK.open}', '${SNIPPET_MARK.close}', '...', 40)` -- 템플릿 리터럴로 SQL 문자열에 직접 보간. |
| 판정 | **안전**. `SNIPPET_MARK`는 `src/types/api.ts:197`에서 `{ open: '[[hl]]', close: '[[/hl]]' } as const`로 정의된 컴파일 타임 상수이며 사용자 입력이 아니다. SQL injection 경로 없음. |

### SEC-2. FTS5 검색어 이스케이프 -- 안전

| 항목 | 내용 |
|------|------|
| 위치 | `src/lib/search-index.ts:241` |
| 현재 동작 | `const escaped = '"' + query.replace(/"/g, '""') + '"'` 후 `?` 파라미터 바인딩. |
| 판정 | **안전**. FTS5 MATCH 연산자는 SQL 인젝션이 아니라 FTS5 쿼리 구문 문제인데, 쌍따옴표로 감싸서 리터럴 검색을 강제하고 `""` 이스케이프로 내부 따옴표를 처리한다. 바인딩 파라미터(`?`)를 사용하므로 SQL injection 불가. |

---

## 빌드/린트 출력

### `npm run typecheck`
```
> web-md-viewer@0.1.0 typecheck
> tsc --noEmit
(오류 0건)
```

### `npm run lint`
```
> web-md-viewer@0.1.0 lint
> eslint
(오류 0건)
```

### `npm test`
```
> web-md-viewer@0.1.0 test
> vitest run

 RUN  v4.1.10 /Users/husky/Desktop/Project/Claude/Web-MD-Viewer

 Test Files  7 passed (7)
      Tests  119 passed (119)
   Start at  01:05:00
   Duration  2.86s (transform 1.17s, setup 0ms, import 1.72s, tests 2.04s, environment 1ms)
```

### `npm run build`
```
> web-md-viewer@0.1.0 build
> next build

Next.js 16.2.11 (Turbopack)

경고 1건 (기존 알려진 사항):
  - "middleware" file convention deprecated -> "proxy" 전환 필요 (backlog P2-6)
  - NFT tracing 경고: upload/route.ts의 fs 동적 참조 감지 (동작 영향 없음)

빌드 성공. 16개 라우트 생성.
```

---

## 요약

| 구분 | 건수 | 심각도 분포 |
|------|------|-------------|
| 오류 (수정 필요) | 4건 | 높음 1, 중간 2, 낮음 1 |
| 성능 개선 (권장) | 8건 | 중간 3, 낮음 5 |
| 보안 소견 | 2건 | 안전 확인 2 |

### 권장 조치 우선순위

1. **S-1 + S-2** (검색 JOIN 통합 + prepared statement 캐싱): 가장 측정 가능한 개선. `search()` 호출당 쿼리 수가 N+1 -> 1로 줄고, `indexFile()` 호출당 prepare 비용이 3 -> 0으로 줄어든다. 증분 빌드 시간과 검색 응답 시간 양쪽에 영향.
2. **ensureDb()/initIndex() 순환 의존 정리**: 코드 가독성 및 리팩터링 안전성. 기능 오류는 아니지만 향후 유지보수 리스크.
3. 나머지 항목은 현재 규모에서 체감 영향이 미미하므로 backlog P2에 기록 권장.

### backlog.md 반영 제안

오류 테이블의 "높음" 항목(S-2 prepared statement 미캐싱)은 **P2로 backlog에 추가** 제안한다. 기능적 오류가 아니라 성능 최적화이므로 P0/P1은 아니지만, 파일 수가 수백 이상일 때 증분 빌드 시간에 직접 영향을 주므로 Stage 3 완료 전 또는 직후 처리 권장.

```
### P2-15. search-index prepared statement 캐싱 + N+1 JOIN 통합
- 출처: docs/valid/optimize-stage-3-report.md S-1, S-2
- 위치: src/lib/search-index.ts:192-198, 243-270
- 내용: indexFile() 호출마다 prepare() 3회 반복, search() N+1 쿼리 -- JOIN + statement 캐싱으로 개선
- 담당: backend-dev
```
