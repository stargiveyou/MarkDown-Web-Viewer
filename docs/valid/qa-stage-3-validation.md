# QA 통합 검증 -- Stage 3 (검색 / 정렬 / 태그)

- 검증 일시: 2026-07-25
- 검증자: `qa-integration` (model: opus)
- 대상 범위: Stage 3 전체 -- FTS5 검색, 태그 집계/필터, ctime 정렬, FTS5 갱신 훅, 검색/태그 UI
- 선행 검증 참조:
  - [backend-stage-3-validation.md](backend-stage-3-validation.md) -- PASS (FAIL 0건, 주의사항 1건)
  - [frontend-stage-3-validation.md](frontend-stage-3-validation.md) -- FAIL 1건 (SearchBar onClear 미호출)
- 검증 방법: 정적 게이트(typecheck/lint/test/build) + 실서버 curl E2E + 전 파일 코드 리뷰 + 통합 지점 대조
- **종합 판정: PASS (FAIL 0건, UNVERIFIED 6건 -- 모두 비차단)**

---

## 1. 정적 게이트

| # | 항목 | 결과 | 비고 |
|---|------|------|------|
| A-1 | `npm run typecheck` | **PASS** | 오류 0건 |
| A-2 | `npm run lint` | **PASS** | 오류 0건, 경고 0건 |
| A-3 | `npm test` (Vitest) | **PASS** | 7 파일, **119 테스트** 전부 통과 (2.48s) |
| A-4 | `npm run build` | **PASS** | 빌드 성공. 16개 라우트 정상 생성. 경고 1건(NFT tracing -- 기존 알려진 사항, backlog P2) |

빌드 산출물 라우트 확인:
```
Route (app)
  /api/search    (Dynamic)   -- Stage 3 신규
  /api/tags      (Dynamic)   -- Stage 3 신규
  /api/files     (Dynamic)   -- ctime 정렬 추가
  /api/upload    (Dynamic)   -- FTS5 훅 추가
  /api/file-content (Dynamic) -- FTS5 훅 추가
  /workspace     (Static)    -- SearchBar/TagBar 통합
```

---

## 2. P0 항목 해소 확인

### P0 SearchBar 검색어 1자 시 onClear 미호출

- 출처: `docs/valid/frontend-stage-3-validation.md` FAIL #32
- **현재 상태: 해소됨 (PASS)**
- 근거: `src/components/workspace/SearchBar.tsx:96-99`에서 `value.length < 2` 조건에서 무조건 `onClear()` 호출:

```typescript
// SearchBar.tsx:96-99 (현재 코드)
if (value.length < 2) {
  setLoading(false);
  onClear();  // 0자든 1자든 검색 해제
}
```

- 이전 코드에는 `if (value.length === 0)` 가드가 있어 1자일 때 onClear가 호출되지 않았으나, 수정 완료됨.

---

## 3. 보안 불변식 검증

| # | 불변식 | 판정 | 근거 |
|---|--------|------|------|
| 1 | 세션 보호 -- `/api/auth/login` 외 전 라우트 | **PASS** | curl: `GET /api/search?q=test` -> `401 Authentication required.`, `GET /api/tags` -> `401 Authentication required.`. `src/middleware.ts:33-35`에 POST /api/auth/login만 PUBLIC_API 등록 |
| 2 | 경로 안전 -- 단일 유틸 경유 | **PASS** | `search-index.ts:164-165`에서 `resolveUnderRoot` + `assertRealPathUnderRoot` 호출. files/upload/file-content/thumbnail 모두 동일 유틸 경유 확인 |
| 3 | 업로드 하드닝 | **PASS** | `upload/route.ts:208-223`. 413(크기), 415(확장자), `sanitizeFilename` 적용 -- 기존 유지 |
| 4 | Atomic write | **PASS** | 업로드: `writeFileAtomically()`. 에디터: 임시파일->rename -- 기존 유지 |
| 5 | 편집 충돌 409 | **PASS** | `file-content/route.ts:127-135`. `baseMtime` 비교 후 409 + `SaveConflictResponse` -- 기존 유지 |
| 6 | 시크릿 비노출 | **PASS** | Webhook URL, SESSION_SECRET이 클라이언트 코드(src/components/, src/app/workspace/)에 0건 출현. DB 경로도 응답에 미포함 |
| 7 | Rate limit | **PASS** | `/api/upload` (`upload/route.ts:163`), `/api/auth/login` (`login/route.ts:36`). 검색은 인증된 읽기 전용이므로 rate limit 불필요(계약 확인) |
| 8 | 내부 정보 비노출 | **PASS** | 모든 에러 응답이 `apiError()`/`internalError()` 경유(`api-response.ts:15-29`). `internalError`는 고정 "Internal server error." 메시지만 반환. 스택트레이스 클라이언트 노출 없음. curl로 401 응답 확인: 절대 경로/스택트레이스 없음 |

---

## 4. API 계약 준수

### 4-1. `GET /api/search?q=`

| # | 검증 | 판정 | 근거 |
|---|------|------|------|
| B-5 | 200 + SearchResponse 형태 | **PASS** (코드 레벨) | `search/route.ts:36-41`에서 `{ query, results, indexing? }` 형태. `SearchResponse` 타입 import 확인 |
| B-6 | snippet에 `[[hl]]`/`[[/hl]]` 마커 | **PASS** (유닛 테스트) | `search-index.test.ts:169-170` 검증 통과. `search-index.ts:247`에서 `SNIPPET_MARK.open`/`close` 사용 |
| B-7 | BM25 정렬 | **PASS** (유닛 테스트) | `search-index.test.ts:207-211`. `ORDER BY rank` (`search-index.ts:252`) |
| B-8 | 2자 미만 쿼리 -> 400 | **PASS** (코드 레벨) | `search/route.ts:30-32`: `q.trim().length < 2` -> `apiError(400, ...)` |
| B-9 | 빈 쿼리 -> 400 | **PASS** (코드 레벨) | `search/route.ts:30`: `!q` -> 400 |
| B-10 | 특수문자 검색 -> 에러 없음 | **PASS** (유닛 테스트) | `search-index.test.ts:392-429`: 쌍따옴표, C++ 포함 검색 에러 없음 |
| B-11 | 미인증 -> 401 | **PASS** (실서버 curl) | `curl -s http://localhost:3000/api/search?q=test` -> `{"code":401,"message":"Authentication required."}` |
| B-12 | 응답에 절대 경로 없음 | **PASS** (코드 레벨) | `search-index.ts:141`: `toSubpath(fullPath)`로 상대 경로 변환 후 FTS5 저장. 검색 결과의 subpath는 DB에 저장된 상대 경로 |

### 4-2. `GET /api/tags`

| # | 검증 | 판정 | 근거 |
|---|------|------|------|
| C-13 | TagsResponse 형태 반환 | **PASS** (코드 레벨) | `tags/route.ts:24-25`: `{ tags: TagCount[] }`. 타입 import 확인 |
| C-14 | count 내림차순 정렬 | **PASS** (유닛 테스트) | `search-index.test.ts:368-370`: 정렬 순서 검증. `search-index.ts:300`: `.sort((a, b) => b.count - a.count)` |
| C-15 | 미인증 -> 401 | **PASS** (실서버 curl) | `curl -s http://localhost:3000/api/tags` -> `{"code":401,"message":"Authentication required."}` |

### 4-3. `GET /api/files?sort=ctime`

| # | 검증 | 판정 | 근거 |
|---|------|------|------|
| D-16 | ctime 내림차순 정렬 | **PASS** (코드 레벨) | `files/route.ts:41`: VALID_SORT_KEYS에 'ctime' 포함. `files/route.ts:210-214`: `birthtimeMs` 내림차순 정렬 |
| D-17 | 기존 sort(mtime/name/size) 유지 | **PASS** (코드 레벨 + 빌드) | `files/route.ts:203-218`: switch문에 4개 케이스 모두 존재. typecheck 통과 |

### 4-4. FTS5 갱신 훅

| # | 검증 | 판정 | 근거 |
|---|------|------|------|
| E-18 | upload .md -> 즉시 검색 가능 | **PASS** (코드 레벨) | `upload/route.ts:244-252`: `.md`/`.markdown` 업로드 시 `indexFile(uploadedSubpath)` 호출. try/catch로 감싸 실패 격리 |
| E-19 | file-content PUT .md -> 검색 반영 | **PASS** (코드 레벨) | `file-content/route.ts:166-175`: `.md`/`.markdown` 저장 시 `indexFile(userSubpath)` 호출. try/catch로 감싸 실패 격리 |
| E-20 | 비-.md 업로드 -> 검색 미반영 | **PASS** (코드 레벨) | `upload/route.ts:247`: `uploadedSubpath.endsWith('.md') || uploadedSubpath.endsWith('.markdown')` 조건. 이미지/기타 파일은 색인 대상에서 제외 |

---

## 5. 통합 지점 검증 (프론트-백 연결)

### 5-1. 요청/응답 형태 일치

| # | 지점 | 판정 | 근거 |
|---|------|------|------|
| I-1 | SearchBar -> GET /api/search | **PASS** | 프론트: `apiFetch<SearchResponse>('/api/search?q=${encodeURIComponent(q)}')` (SearchBar.tsx:53-54). 백엔드: `searchParams.get('q')` (search/route.ts:28). 응답: `SearchResponse` 타입 공유 |
| I-2 | workspace page -> GET /api/tags | **PASS** | 프론트: `apiFetch<TagsResponse>('/api/tags')` (page.tsx:112). 백엔드: 파라미터 없는 GET (tags/route.ts:22). 응답: `TagsResponse` 타입 공유 |
| I-3 | workspace page -> GET /api/files?tag= | **PASS** | 프론트: `params.set('tag', tag)` (page.tsx:51). 백엔드: `searchParams.get('tag')` (files/route.ts:70). 타입: `FilesResponse` 공유 |
| I-4 | SearchResults -> /workspace/view?path= | **PASS** | 프론트: `router.push('/workspace/view?path=${encodeURIComponent(subpath)}')` (SearchResults.tsx:95). 검색 결과의 subpath는 MARKDOWN_ROOT 기준 상대 경로 |
| I-5 | SNIPPET_MARK 공유 | **PASS** | 백엔드: `search-index.ts:37` import `SNIPPET_MARK`. 프론트: `SearchResults.tsx:15` import `SNIPPET_MARK`. 동일 상수(`[[hl]]`/`[[/hl]]`) 사용 |
| I-6 | SortKey 타입 공유 | **PASS** | 프론트: `page.tsx:33` import `SortKey`. 백엔드: `files/route.ts:33` import `SortKey`. 타입에 'ctime' 포함 |

### 5-2. 연쇄 동작 (업로드 -> 색인 -> 검색)

| # | 검증 | 판정 | 근거 |
|---|------|------|------|
| I-7 | 업로드 -> indexFile -> 즉시 검색 | **PASS** (코드 체인) | 1) `upload/route.ts:248`: `await indexFile(uploadedSubpath)` 동기 대기. 2) `indexFile`은 FTS5에 INSERT. 3) 다음 `search()` 호출은 같은 DB 싱글턴에서 읽기. 단일 프로세스이므로 일관성 보장 |
| I-8 | 편집 -> indexFile -> 검색 반영 | **PASS** (코드 체인) | `file-content/route.ts:171`: `await indexFile(userSubpath)` 동기 대기 후 응답 반환. 클라이언트가 검색하면 갱신된 색인에서 조회 |
| I-9 | 업로드 -> refreshKey -> 태그 재조회 | **PASS** (코드 체인) | 1) `page.tsx:124-126`: `handleUploaded` -> `setRefreshKey(k+1)`. 2) `page.tsx:109-118`: `refreshKey` 변경 시 `GET /api/tags` 재호출. 3) 태그가 갱신된 색인에서 집계됨 |

### 5-3. 에러 상태 코드 전달 (백엔드 -> 프론트)

| # | 에러 | 판정 | 근거 |
|---|------|------|------|
| I-10 | 400 (검색 2자 미만) | **PASS** | `search/route.ts:31`: `apiError(400, ...)`. 프론트 `apiFetch`가 400을 `ApiRequestError`로 정규화 (`fetcher.ts`). SearchBar의 doSearch에서 catch 처리 |
| I-11 | 401 (미인증) | **PASS** | middleware가 401 JSON 반환. `fetcher.ts:83-89`: 401 시 `/login` 리다이렉트 자동 처리 |
| I-12 | 500 (내부 오류) | **PASS** | `search/route.ts:43`, `tags/route.ts:28`: `internalError()` -> 500. `fetcher.ts`가 에러 토스트 표시 |

---

## 6. 프론트엔드 UI 통합 검증

| # | 항목 | 판정 | 근거 |
|---|------|------|------|
| H-28 | SearchBar가 헤더에 배치 | **PASS** (코드 레벨) | `page.tsx:210`: `<SearchBar .../>` 헤더 `<div>` 안에 정렬 드롭다운 앞에 배치 |
| H-29 | TagBar가 GridView 상단에 배치 | **PASS** (코드 레벨) | `page.tsx:253-257`: `{!isSearchMode && tags.length > 0 && (<div className="mb-6"><TagBar .../></div>)}` Breadcrumb 아래, GridView 위 |
| H-30 | 검색 모드에서 TagBar 숨김 | **PASS** | `page.tsx:253`: `{!isSearchMode && ...}` 조건. `isSearchMode = searchResults !== null` |
| H-31 | 정렬 드롭다운에 "생성일" 옵션 | **PASS** | `page.tsx:39`: `{ value: 'ctime', label: '생성일' }` |
| H-32 | 검색 모드에서 정렬 드롭다운 비활성화 | **PASS** | `page.tsx:216`: `disabled={isSearchMode}` |
| H-33 | Escape로 검색 해제 | **PASS** | `SearchBar.tsx:103-111`: Escape 시 `setQuery('')`, `onClear()`, `blur()` |
| H-34 | Cmd+K 포커스 | **PASS** | `SearchBar.tsx:36-45`: 전역 keydown 리스너, `metaKey || ctrlKey && key === 'k'` |
| H-35 | 검색 결과 카드 클릭 -> view 이동 | **PASS** | `SearchResults.tsx:94-96`: `router.push('/workspace/view?path=${encodeURIComponent(subpath)}')` |
| H-36 | snippet 하이라이트 -> `<mark>` | **PASS** | `SearchResults.tsx:29-65`: `parseSnippet()` 함수가 `SNIPPET_MARK` 마커 파싱, `<mark>` React 엘리먼트 조립 |
| H-37 | `dangerouslySetInnerHTML` 미사용 | **PASS** | `SearchResults.tsx` 전체에서 실사용 0건 (주석/문서에서만 언급) |
| H-38 | 결과 0건 안내 | **PASS** | `SearchResults.tsx:117-124`: "검색 결과가 없습니다" 표시 |
| H-39 | indexing 배너 | **PASS** | `SearchResults.tsx:107-114`: `indexing && (...)` 조건부 배너 |
| H-40 | 태그 칩 바 "전체" 칩 | **PASS** | `TagBar.tsx:30-36`: 클릭 시 `onTagSelect(null)` |
| H-41 | 태그 클릭 필터 | **PASS** | `page.tsx:150-152`: `handleTagSelect` -> `setActiveTag(tag)`. `page.tsx:106`: `activeTag` 의존성으로 파일 재조회 |
| H-42 | 활성/비활성 태그 스타일 | **PASS** | `TagBar.tsx:55-63`: `chipClass()` 함수로 활성(반전)/비활성 스타일 분리 |
| H-43 | 키보드 접근성 | **PASS** | SearchBar input: `focus-visible`. 클리어 버튼: `focus-visible`. TagBar 칩: `focus-visible`. SearchResults 카드: `focus-visible`. Escape 처리 |
| H-44 | raw fetch 미사용 | **PASS** | `src/components/` 및 `src/app/workspace/` 전체에서 `fetch(` 직접 호출 0건. 모든 API 호출이 `apiFetch` 경유 |
| H-45 | 반응형 2열/4열 | **PASS** | `GridView.tsx:47`: `grid-cols-2 md:grid-cols-4` |

---

## 7. 보안 세부 검증

| # | 항목 | 판정 | 근거 |
|---|------|------|------|
| G-24 | search/tags 미인증 401 | **PASS** (실서버 curl) | `curl -s "http://localhost:3000/api/search?q=test"` -> `{"code":401,...}`, `curl -s "http://localhost:3000/api/tags"` -> `{"code":401,...}` |
| G-25 | 응답에 절대 경로 없음 | **PASS** (코드 레벨) | `search-index.ts`: DB에 상대 경로만 저장(`toSubpath`). search/tags 라우트: DB 경로 미포함. `internalError()`: 고정 메시지만 반환 |
| G-26 | 에러 응답에 스택트레이스 없음 | **PASS** | `api-response.ts:27-29`: `internalError`는 `console.error`(서버 로깅)만 하고 `apiError(500, 'Internal server error.')` 고정 반환 |
| G-27 | SQLite DB 위치 | **PASS** | `search-index.ts:58`: `path.join(path.resolve(getServerEnv().MARKDOWN_ROOT), '.mdws')`. 다른 위치에 DB 파일 없음. `.mdws/`는 숨김 디렉터리로 `/api/files` 필터(`!name.startsWith('.')`, files/route.ts:97) |
| G-28 | Webhook URL 클라이언트 미노출 | **PASS** | `src/components/`, `src/app/workspace/` 전체 grep: `webhook`, `WEBHOOK`, `discord`, `DISCORD`, `slack`, `SLACK` 0건 |
| G-29 | `runtime = 'nodejs'` 선언 | **PASS** | search/route.ts:24, tags/route.ts:20, files/route.ts:35, upload/route.ts:48, file-content/route.ts:31 |
| G-30 | 스코프 드리프트 | **PASS** | FTP/basic-ftp/카카오/os.homedir 하드코딩: 프로덕션 코드에 없음 |

---

## 8. 검색 ADR-007 전용 검증

| # | 항목 | 판정 | 근거 |
|---|------|------|------|
| S-1 | FTS5 trigram 토크나이저 | **PASS** | `search-index.ts:89`: `tokenize='trigram'` |
| S-2 | 실시간 fs 스캔으로 검색 금지 | **PASS** | 검색은 FTS5 MATCH 쿼리(`search-index.ts:240-253`). fs 스캔 없음 |
| S-3 | 한글 부분일치 동작 | **PASS** (유닛 테스트) | `search-index.test.ts:97-118`: "제주도"로 검색 시 "제주도에서 먹은 흑돼지" 매치 |
| S-4 | snippet 하이라이트 + BM25 | **PASS** (유닛 테스트) | snippet: test:169-170, BM25: test:207-211 |
| S-5 | 증분 빌드 (변경/삭제 감지) | **PASS** (유닛 테스트) | 변경: test:218-265, 삭제: test:271-303 |
| S-6 | 태그 집계 | **PASS** (유닛 테스트) | test:309-372: count 정확성 + 내림차순 정렬 |

---

## 9. E2E 해피패스

### 인증된 세션 E2E (UNVERIFIED)

| # | 시나리오 | 판정 | 사유 |
|---|----------|------|------|
| F-21 | 로그인 -> 업로드 .md -> 검색 -> 발견 -> 보기 | **UNVERIFIED** | 실행 중인 dev 서버에 인증 불가. 문서에 기재된 비밀번호(`MdWs-Dev-2026!`)가 서버에서 거부됨. 서버가 .env.local 로드 시점에 다른 해시를 사용했거나 이후 변경된 것으로 추정. 서버 재시작 권한 없음 |
| F-22 | 로그인 -> 편집 -> 검색 -> 변경 내용 발견 | **UNVERIFIED** | 동일 사유 |
| F-23 | 태그 필터: 업로드 -> 태그 조회 -> 파일 필터 | **UNVERIFIED** | 동일 사유 |

**대체 검증**: 인증된 세션 E2E를 실행할 수 없으나, 아래 항목으로 대체 커버리지를 확보함:

1. **유닛 테스트 119건 전체 통과** -- search-index 13건(한글 검색, BM25, snippet, 증분 빌드, 삭제 감지, 태그 집계, 특수문자 등)
2. **코드 레벨 통합 체인 검증** -- 업로드/편집 -> indexFile -> search/getAllTags 연쇄 동작을 코드 흐름으로 확인 (섹션 5-2)
3. **미인증 401 실서버 curl 확인** -- search/tags 엔드포인트가 존재하고 middleware를 거치는 것 확인
4. **빌드 성공** -- 모든 라우트가 정상 생성됨 (Dynamic 표시)

---

## 10. 추가 확인 사항

### 10-1. initIndex() 자동 호출

백엔드 검증 리포트에서 N-1으로 기록한 "initIndex() 서버 기동 시 호출 미구현"에 대해 추가 확인:

- `search-index.ts:70-104`: `ensureDb()` 함수가 첫 DB 접근 시 `initIndex()`를 호출한다 (라인 101).
- `search()`, `getAllTags()`, `indexFile()` 모두 `ensureDb()`를 경유한다.
- 즉, 첫 번째 검색/태그/색인 요청 시 lazy하게 증분 빌드가 시작된다.
- 서버 부팅 직후 즉시가 아닌 첫 요청 시점에 시작되는 것은 기능적으로 문제없음.
- backlog P2로 이관할 수 있으나 차단 사유가 아님.

### 10-2. 타입 공유 모듈 단일성

`src/types/api.ts`에 Stage 3 관련 타입이 모두 정의되어 있으며, 프론트/백엔드 양쪽에서 동일 모듈을 import:

- `SearchResult`, `SearchResponse`, `SNIPPET_MARK` -- 검색
- `TagCount`, `TagsResponse` -- 태그
- `SortKey` (ctime 포함) -- 정렬

로컬 중복 정의 0건 확인.

### 10-3. 색인 갱신 실패 격리

`upload/route.ts:244-252`와 `file-content/route.ts:166-175` 모두 `indexFile()` 호출을 try/catch로 감싸 실패 시 `console.error`만 하고 HTTP 응답에 영향을 주지 않음. 색인은 다음 서버 재시작 시 증분 빌드에서 자동 복구.

---

## 11. UNVERIFIED 항목 요약

| # | 항목 | 사유 | 차단 여부 |
|---|------|------|-----------|
| F-21 | 인증된 E2E: 업로드 -> 검색 | 서버 인증 불가 (비밀번호 불일치). 코드 레벨 + 유닛 테스트로 대체 검증 완료 | 비차단 |
| F-22 | 인증된 E2E: 편집 -> 검색 반영 | 동일 | 비차단 |
| F-23 | 인증된 E2E: 태그 필터 | 동일 | 비차단 |
| F-24 | 인증된 E2E: ctime 정렬 동작 | 동일 | 비차단 |
| F-25 | 인증된 E2E: 검색 한글 실서버 | 동일 | 비차단 |
| F-26 | 인증된 E2E: snippet 하이라이트 렌더 | 동일 | 비차단 |

**UNVERIFIED 사유 상세**: 실행 중인 dev 서버(PID 75022, port 3000)에 `POST /api/auth/login`으로 문서 기재 비밀번호(`MdWs-Dev-2026!`)를 전송했으나 401 응답. 서버 프로세스 재시작(kill/npm run dev) 권한이 없어 다른 비밀번호로 시도 불가. curl로 미인증 API 접근(401)은 성공적으로 확인됨.

**권장**: 서버를 재시작한 뒤 인증된 세션으로 E2E를 재검증하거나, `npm run hash-password`로 비밀번호를 재설정 후 재시도.

---

## 12. 단계 완료 조건 대조

| # | 조건 | 판정 |
|---|------|------|
| 1 | `/api/search?q=한글`로 FTS5 trigram 한글 부분일치 검색 동작 | PASS (유닛 테스트 13건) |
| 2 | snippet()으로 매치 구간 하이라이트 + BM25 관련도 정렬 | PASS (유닛 테스트 + 코드 리뷰) |
| 3 | `/api/tags`로 frontmatter 태그 + 개수 집계 | PASS (유닛 테스트 + 코드 리뷰) |
| 4 | 업로드/편집 저장 후 색인 즉시 갱신(증분) | PASS (코드 리뷰: indexFile 호출 확인) |
| 5 | 검색 바(Cmd+K) + 디바운스 + 인라인 결과 목록 동작 | PASS (코드 리뷰) |
| 6 | 태그 칩 바 + 클릭 필터 동작 | PASS (코드 리뷰) |
| 7 | ctime(생성일) 정렬 추가 | PASS (코드 리뷰: birthtimeMs 정렬) |
| 8 | 색인 구축 중 `indexing: true` 안내 | PASS (코드 리뷰: search/route.ts + SearchResults.tsx) |
| 9 | SQLite DB가 `MARKDOWN_ROOT/.mdws/search.db`에 위치 | PASS (코드 리뷰) |
| 10 | `npm run build` / `typecheck` / `test` / `lint` 통과 | PASS (실행 확인) |
| 11 | 검증 리포트 FAIL 0건 | PASS (P0 수정 확인, 현재 FAIL 0건) |

---

## 최종 판정

**PASS**

Stage 3(검색 / 정렬 / 태그) 구현은 Canonical API 계약, 보안 불변식 8개, ADR-007(FTS5 검색) 요구사항을 모두 충족한다.

- 정적 게이트 4개 전부 통과 (typecheck 0, lint 0, test 119/119, build 성공)
- P0 항목(SearchBar onClear 1자 미호출) 수정 확인됨
- 보안 불변식 8개 전항 PASS
- 프론트-백엔드 통합 지점 6개 대조 완료 (타입 공유, 요청 형태, SNIPPET_MARK 상수)
- 연쇄 동작(업로드 -> 색인 -> 검색) 코드 체인 검증 완료
- 에러 상태 코드(400/401/500) 전달 경로 확인
- 미인증 401 실서버 curl 검증 완료

UNVERIFIED 6건은 모두 "인증된 세션으로 실서버 E2E"이며, 서버 인증 문제(비밀번호 불일치)에 기인한다. 코드 레벨 검증 + 유닛 테스트 119건으로 대체 커버리지가 확보되어 있어 차단 사유가 아니다.
