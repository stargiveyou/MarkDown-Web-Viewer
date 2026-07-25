# Backend Stage 3 계약 -- 검색 / 정렬 / 태그 (FTS5)

- 작성: `tech-lead` / 2026-07-24
- 상태: **확정**
- 타입 기준: [src/types/api.ts](../../src/types/api.ts)
- 결정 참조: [stage-3-tasks.md](../plan/stage-3-tasks.md) D3-1 ~ D3-6

---

## 1. 신규 모듈: `src/lib/search-index.ts`

FTS5 색인 관리의 **단일 구현**. 모든 검색/태그 관련 로직이 이 모듈을 경유한다.

### 1.1 SQLite DB 위치

```
MARKDOWN_ROOT/.mdws/search.db
```

- `MARKDOWN_ROOT`에서 파생. 별도 환경변수 없음.
- `.mdws/` 디렉터리가 없으면 자동 생성(`mkdir -p` 동등).
- `.mdws/`는 숨김이므로 `/api/files`의 GridView에 노출되지 않음.

### 1.2 스키마

```sql
-- FTS5 가상 테이블 (trigram 토크나이저)
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  subpath,
  title,
  body,
  tags,
  tokenize='trigram'
);

-- mtime 추적용 일반 테이블 (증분 빌드)
CREATE TABLE IF NOT EXISTS docs_meta (
  subpath TEXT PRIMARY KEY,
  mtime   INTEGER NOT NULL
);
```

### 1.3 공개 API

```typescript
/** 색인 초기화. 서버 기동 시 1회 호출. 비동기 백그라운드에서 증분 빌드 수행. */
export function initIndex(): void;

/** 색인 구축 완료 여부. */
export function isIndexing(): boolean;

/**
 * 파일 1건을 색인에 upsert.
 * - `gray-matter`로 frontmatter 파싱
 * - FTS5 테이블에 INSERT OR REPLACE
 * - docs_meta에 mtime 갱신
 *
 * @param subpath MARKDOWN_ROOT 기준 상대 경로 (POSIX)
 */
export async function indexFile(subpath: string): Promise<void>;

/**
 * FTS5 MATCH 검색.
 *
 * @param query 사용자 입력 검색어 (2자 이상)
 * @param limit 최대 결과 수 (기본값 50)
 * @returns SearchResult[] (BM25 관련도 순)
 */
export function search(query: string, limit?: number): SearchResult[];

/**
 * 전체 태그 집계.
 * docs_fts의 tags 컬럼에서 공백 분할 -> 태그별 문서 수 집계.
 *
 * @returns TagCount[] (count 내림차순)
 */
export function getAllTags(): TagCount[];
```

### 1.4 증분 빌드 로직

`initIndex()` 호출 시:

1. 테이블이 없으면 생성.
2. 디스크의 `MARKDOWN_ROOT`를 재귀 스캔해 모든 `.md` 파일의 `subpath`와 `mtime`을 수집.
3. `docs_meta` 테이블과 비교:
   - **신규**: `docs_meta`에 없는 `subpath` -> `indexFile()` 호출.
   - **변경**: `mtime`이 다른 `subpath` -> `indexFile()` 호출.
   - **삭제**: `docs_meta`에 있지만 디스크에 없는 `subpath` -> DELETE.
4. 완료 후 `isIndexing()` = false로 전환.

비동기 백그라운드에서 실행하되, **Promise를 모듈 수준에서 추적**해 완료 여부를 판단한다.

### 1.5 indexFile 상세

```typescript
async function indexFile(subpath: string): Promise<void> {
  const absolutePath = resolveUnderRoot(subpath);
  await assertRealPathUnderRoot(absolutePath);

  const raw = await fs.readFile(absolutePath, 'utf8');
  const parsed = matter(raw);

  const title = (typeof parsed.data.title === 'string' && parsed.data.title.trim())
    || path.basename(subpath, path.extname(subpath));

  const body = parsed.content;

  const tags = Array.isArray(parsed.data.tags)
    ? parsed.data.tags.filter((t: unknown): t is string => typeof t === 'string')
        .map((t) => t.trim()).filter(Boolean).join(' ')
    : '';

  const stat = await fs.stat(absolutePath);
  const mtime = Math.round(stat.mtimeMs);

  // 트랜잭션으로 원자성 보장
  db.transaction(() => {
    // FTS5는 UPDATE가 없으므로 DELETE + INSERT
    db.prepare('DELETE FROM docs_fts WHERE subpath = ?').run(subpath);
    db.prepare('INSERT INTO docs_fts (subpath, title, body, tags) VALUES (?, ?, ?, ?)')
      .run(subpath, title, body, tags);
    db.prepare('INSERT OR REPLACE INTO docs_meta (subpath, mtime) VALUES (?, ?)')
      .run(subpath, mtime);
  })();
}
```

### 1.6 search 상세

```typescript
function search(query: string, limit = 50): SearchResult[] {
  // FTS5 특수문자 이스케이프: 쌍따옴표로 감싸서 리터럴 검색
  const escaped = `"${query.replace(/"/g, '""')}"`;

  const rows = db.prepare(`
    SELECT
      subpath,
      title,
      snippet(docs_fts, 2, '${SNIPPET_MARK.open}', '${SNIPPET_MARK.close}', '...', 40) AS snippet,
      rank AS score,
      tags
    FROM docs_fts
    WHERE docs_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(escaped, limit);

  // 각 행에 mtime, coverThumbUrl 보강
  return rows.map((row) => {
    const meta = db.prepare('SELECT mtime FROM docs_meta WHERE subpath = ?').get(row.subpath);
    return {
      subpath: row.subpath,
      title: row.title,
      snippet: row.snippet,
      score: row.score,
      mtime: meta?.mtime ?? 0,
      tags: row.tags ? row.tags.split(' ').filter(Boolean) : undefined,
      // coverThumbUrl은 검색 결과에서 선택 사항 -- 성능 고려 시 생략 가능
    };
  });
}
```

**snippet() 인자 설명**:
- `2` = body 컬럼 인덱스 (0=subpath, 1=title, 2=body, 3=tags)
- `SNIPPET_MARK.open/close` = 하이라이트 마커
- `'...'` = 생략 표시
- `40` = snippet 토큰 수

### 1.7 getAllTags 상세

```typescript
function getAllTags(): TagCount[] {
  const rows = db.prepare('SELECT tags FROM docs_fts WHERE tags != ""').all();

  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.tags.split(' ').filter(Boolean)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}
```

---

## 2. `GET /api/search?q=`

### 경로
```
GET /api/search?q=<검색어>
```

### 인증 요구사항
- 세션 인증 필수 (middleware에서 처리).

### 경로 검증
- `q` 파라미터 필수 + 비어 있지 않음 + 2자 이상.
- 검색 결과의 `subpath`는 MARKDOWN_ROOT 기준 상대 경로만 포함(절대 경로 금지).

### 에러 코드

| 코드 | 조건 |
|------|------|
| 400 | `q` 미지정, 비어 있음, 2자 미만 |
| 401 | 미인증 (middleware) |
| 500 | 내부 오류 (SQLite 등) |

### 응답

```typescript
// 타입은 src/types/api.ts에 정의됨
interface SearchResponse {
  query: string;
  results: SearchResult[];
  indexing?: boolean;  // 색인 구축 중이면 true
}

interface SearchResult {
  subpath: string;
  title: string;
  snippet: string;    // [[hl]]...[[/hl]] 마커 포함
  score: number;      // BM25 (낮을수록 관련도 높음)
  mtime: number;
  tags?: string[];
  coverThumbUrl?: string;
}
```

### 구현 의사코드

```typescript
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q || q.trim().length < 2) {
    return apiError(400, 'Search query must be at least 2 characters.');
  }

  try {
    const results = search(q.trim());
    const response: SearchResponse = {
      query: q.trim(),
      results,
      ...(isIndexing() ? { indexing: true } : {}),
    };
    return NextResponse.json(response);
  } catch (error) {
    return internalError('search', error);
  }
}
```

---

## 3. `GET /api/tags`

### 경로
```
GET /api/tags
```

### 인증 요구사항
- 세션 인증 필수 (middleware에서 처리).

### 경로 검증
- 없음 (파라미터 없는 라우트).

### 에러 코드

| 코드 | 조건 |
|------|------|
| 401 | 미인증 (middleware) |
| 500 | 내부 오류 |

### 응답

```typescript
interface TagsResponse {
  tags: TagCount[];  // count 내림차순 정렬
}

interface TagCount {
  tag: string;
  count: number;
}
```

### 구현 의사코드

```typescript
export async function GET(): Promise<NextResponse> {
  try {
    const tags = getAllTags();
    const response: TagsResponse = { tags };
    return NextResponse.json(response);
  } catch (error) {
    return internalError('tags', error);
  }
}
```

---

## 4. `GET /api/files` 변경사항

### 추가 정렬 키: `ctime`

`SortKey`에 `'ctime'`이 추가됨.

```typescript
// src/types/api.ts
export type SortKey = 'mtime' | 'name' | 'size' | 'ctime';
```

변경 지점:

1. `VALID_SORT_KEYS`에 `'ctime'` 추가.
2. switch문에 `case 'ctime'`: `b.ctime - a.ctime` (내림차순, 최신 생성 우선).
3. `FileEntry`에 ctime 필드를 추가하지 않는다 -- 정렬에만 사용하고 클라이언트에 보내는 값은 `mtime` 그대로.
4. macOS에서 `stat.birthtimeMs`가 생성일을 정확히 반환한다.

### 정렬 로직

```typescript
case 'ctime':
  // birthtimeMs를 사용 (macOS는 실제 생성일, Linux는 메타데이터 변경일)
  return (bStat.birthtimeMs ?? b.mtime) - (aStat.birthtimeMs ?? a.mtime);
```

> 주의: `stat` 결과의 `birthtimeMs`를 정렬 비교에 써야 하므로, entries를 구성할 때 `stat` 결과를 함께 보관하거나, `mtime` 외에 `ctime`도 임시로 저장한 뒤 정렬 후 제거해야 한다. 구현 방식은 backend-dev에 위임하되, **응답에 ctime 값을 포함하지 않는다**(계약상 `FileEntry`에 ctime 필드 없음).

---

## 5. 기존 라우트 FTS5 갱신 훅

### `POST /api/upload` (`src/app/api/upload/route.ts`)

기존 TODO 주석(243행) 위치에:

```typescript
// 색인 증분 갱신 (실패해도 업로드 성공에 영향 없음)
try {
  await indexFile(toSubpath(destination));
} catch (indexError) {
  console.error('[upload] index update failed:', indexError);
}
```

### `PUT /api/file-content` (`src/app/api/file-content/route.ts`)

기존 TODO 주석(164행) 위치에:

```typescript
// 색인 증분 갱신 (실패해도 저장 성공에 영향 없음)
try {
  const userSubpath = toSubpath(absolutePath);
  // .md 파일만 색인 대상
  if (userSubpath.endsWith('.md') || userSubpath.endsWith('.markdown')) {
    await indexFile(userSubpath);
  }
} catch (indexError) {
  console.error('[file-content:PUT] index update failed:', indexError);
}
```

> 중요: 색인 갱신 실패가 업로드/저장의 HTTP 응답을 바꾸지 않는다. try/catch로 감싸고 서버 로깅만 한다.

---

## 6. `src/scripts/rebuild-index.mts`

수동 색인 전체 재구축 스크립트.

```bash
npx tsx src/scripts/rebuild-index.mts
```

- 기존 `search.db`를 삭제하고 새로 구축한다.
- `package.json`에 `"rebuild-index": "tsx src/scripts/rebuild-index.mts"` 추가.
- 환경변수(`MARKDOWN_ROOT` 등)는 `.env.local`에서 읽는다.

---

## 7. 유닛 테스트: `src/lib/search-index.test.ts`

### 필수 테스트 케이스

| # | 테스트 | 설명 |
|---|--------|------|
| 1 | 한글 trigram 부분 일치 | "제주도"로 검색 시 "제주도에서 먹은 흑돼지" 매치 |
| 2 | 영문 검색 | "react" 검색 |
| 3 | snippet 하이라이트 마커 | 결과 snippet에 `[[hl]]`/`[[/hl]]` 포함 |
| 4 | BM25 정렬 | 검색어가 더 많이 등장하는 문서가 상위 |
| 5 | 증분 빌드 -- 변경 감지 | mtime이 바뀐 파일만 재색인 |
| 6 | 증분 빌드 -- 삭제 감지 | 디스크에 없는 파일이 색인에서 제거 |
| 7 | 태그 집계 | 여러 파일의 tags를 정확히 집계 |
| 8 | 빈 검색어 | 에러 발생 확인 |
| 9 | 특수문자 검색 | 쌍따옴표 등이 포함된 검색어 |
| 10 | frontmatter 없는 파일 | title이 파일명으로 대체, tags 빈 배열 |

테스트 환경:
- 임시 디렉터리를 `MARKDOWN_ROOT`로 설정 (`resetServerEnvCacheForTest()` 활용).
- 테스트 마크다운 파일을 임시 디렉터리에 생성.
- 테스트 종료 시 임시 디렉터리 정리.

---

## 8. 보안 체크리스트

| # | 불변식 | 적용 대상 | 확인 사항 |
|---|--------|-----------|-----------|
| 1 | 세션 보호 | /api/search, /api/tags | middleware에서 자동 적용 |
| 2 | 경로 검증 | search-index.ts의 indexFile | `resolveUnderRoot` + `assertRealPathUnderRoot` |
| 6 | 시크릿 비노출 | search-index.ts | DB 경로를 응답에 포함하지 않음 |
| 7 | Rate limit | 검색은 rate limit 불필요(읽기 전용 + 인증됨) | -- |
| 8 | 내부 정보 비노출 | 모든 응답 | 절대 경로/스택트레이스 포함 금지 |
