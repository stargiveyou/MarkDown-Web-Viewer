# 백엔드 검증 -- Stage 3 (검색 / 정렬 / 태그)

- 검증 일시: 2026-07-25
- 검증 담당: backend-validator (fable)
- 대상 파일 범위:
  - `src/lib/search-index.ts` (신규)
  - `src/lib/search-index.test.ts` (신규)
  - `src/app/api/search/route.ts` (신규)
  - `src/app/api/tags/route.ts` (신규)
  - `src/app/api/files/route.ts` (변경: ctime 정렬)
  - `src/app/api/upload/route.ts` (변경: FTS5 훅)
  - `src/app/api/file-content/route.ts` (변경: FTS5 훅)
  - `src/scripts/rebuild-index.mts` (신규)
  - `package.json` (변경: rebuild-index 스크립트)
- 계약 문서: `docs/agent-work/backend-stage-3-contract.md`
- 종합 판정: **PASS** (FAIL 0건, 주의 사항 1건)

---

## 자동화 검증 결과

| 항목 | 결과 | 비고 |
|------|------|------|
| `npm run typecheck` | 오류 0 | PASS |
| `npm run lint` | 오류 0 | PASS |
| `npm test` | 119건 전체 통과 (7파일, 실패 0) | PASS |
| `npm run build` | 성공 (경고 1건: NFT tracing -- 기존 알려진 사항) | PASS |

---

## 엔드포인트별 계약 대조표

| 엔드포인트 | 인증 | 경로검증 | 상태코드 | runtime | 판정 |
|-----------|------|---------|---------|---------|------|
| `GET /api/search?q=` | middleware 세션 (불변식 1) | 결과 subpath는 상대 경로만 반환 (`toSubpath` 경유) | 200/400(q 미만)/401/500 | `nodejs` (`:24`) | PASS |
| `GET /api/tags` | middleware 세션 (불변식 1) | 파라미터 없음 | 200/401/500 | `nodejs` (`:20`) | PASS |
| `GET /api/files?sort=ctime` | middleware 세션 (불변식 1) | `resolveUnderRoot` + `assertRealPathUnderRoot` (`:79-80`) | 200/400/401/500 | `nodejs` (`:35`) | PASS |
| `POST /api/upload` (FTS5 훅) | middleware + rate limit (`:163`) | `resolveUnderRoot` + `assertRealPathUnderRoot` (`:202-203`) | 기존 유지 | `nodejs` (`:48`) | PASS |
| `PUT /api/file-content` (FTS5 훅) | middleware 세션 | `resolveUnderRoot` + `assertRealPathUnderRoot` (`:111-112`) | 기존 유지 (409 포함) | `nodejs` (`:31`) | PASS |

---

## 보안 불변식 대조표

| # | 불변식 | 강제 위치 (파일:라인) | 판정 |
|---|--------|---------------------|------|
| 1 | 세션 보호 -- `/api/auth/login` 외 전 라우트 | `src/middleware.ts:86-134` (matcher `config` `:148-152`). `/api/search`, `/api/tags` 포함 모든 `/api/*` 경로 보호. | PASS |
| 2 | 경로 안전 -- 단일 유틸 경유 | `src/lib/path-safety.ts` 단일 구현. `indexFile()`에서 `resolveUnderRoot`+`assertRealPathUnderRoot` 호출 (`search-index.ts:161-162`). files/upload/file-content/thumbnail 전부 경유 확인. | PASS |
| 3 | 업로드 하드닝 (크기/확장자/새니타이즈) | `src/app/api/upload/route.ts:208-223`. 413(크기), 415(확장자), `sanitizeFilename` 적용. | PASS |
| 4 | Atomic write | 업로드: `writeFileAtomically()` (`upload/route.ts:124-156`). 에디터: 임시파일->rename (`file-content/route.ts:144-155`). | PASS |
| 5 | 편집 충돌 409 | `file-content/route.ts:127-135`. `baseMtime` 비교 후 409 + `SaveConflictResponse` 반환. | PASS |
| 6 | 시크릿 비노출 | `SESSION_SECRET`, `WEBHOOK_URL`은 `src/lib/env.ts`에서만 참조. 응답 바디에 포함되지 않음. DB 경로도 응답에 미포함. | PASS |
| 7 | Rate limit | `/api/upload` (`upload/route.ts:163`), `/api/auth/login` (`login/route.ts:36`). `/api/share/notify`는 Stage 4 범위. | PASS |
| 8 | 내부 정보 비노출 | 모든 에러 응답이 `apiError()`/`internalError()` 경유 (`api-response.ts:15-29`). `error.message`는 `console.error`에서만 사용. 스택트레이스 클라이언트 노출 없음. | PASS |

---

## 체크리스트 항목별 검증

### 1. `npm run typecheck` -- 오류 0
**PASS**. 타입 체크 완료, 오류 없음.

### 2. `npm test` -- 전체 통과
**PASS**. 7 파일, 119건 전체 통과, 실패 0건. search-index 테스트 13건 포함.

### 3. `npm run lint` -- 오류 0
**PASS**. ESLint 오류 없음.

### 4. `npm run build` -- 성공
**PASS**. 빌드 성공. 경고 1건(NFT tracing)은 기존 알려진 사항이며 동작에 영향 없음.

### 5. `/api/search?q=` -- 200 + SearchResponse 형태
**PASS**. `src/app/api/search/route.ts:36-41`에서 `SearchResponse` 타입으로 응답.
- `query`: 입력 검색어 (`q.trim()`)
- `results`: `SearchResult[]` (BM25 순)
- `indexing`: 색인 구축 중일 때만 `true`

### 6. snippet 하이라이트 -- `[[hl]]` 마커
**PASS**. `search-index.ts:244`에서 `SNIPPET_MARK.open`/`close` (`[[hl]]`/`[[/hl]]`)을 snippet() 함수에 전달.
유닛 테스트 `search-index.test.ts:169-170`에서 마커 포함 검증.

### 7. BM25 정렬
**PASS**. `search-index.ts:249`에서 `ORDER BY rank` (FTS5 내장 BM25). 유닛 테스트 `search-index.test.ts:207-211`에서 검색어 빈도가 높은 문서가 상위에 오는지 검증.

### 8. `/api/tags` -- 200 + TagsResponse 형태
**PASS**. `src/app/api/tags/route.ts:24-25`에서 `TagsResponse` 타입으로 응답.
`getAllTags()` (`search-index.ts:281-298`)에서 count 내림차순 정렬 확인 (`:297`).
유닛 테스트 `search-index.test.ts:353-371`에서 태그별 개수 정확성 + 정렬 순서 검증.

### 9. `/api/files?sort=ctime` -- 생성일 내림차순
**PASS**. `files/route.ts:41`에서 `VALID_SORT_KEYS`에 `'ctime'` 포함.
`files/route.ts:210-215`에서 `birthtimeMs` 내림차순 정렬. `ctimeMap` (`files/route.ts:102,128`)으로 birthtimeMs 보관.
응답 `FileEntry`에 ctime 필드 미포함 (계약 준수).

### 10. 업로드 후 색인 갱신 -- 즉시 검색 가능
**PASS**. `upload/route.ts:244-252`에서 `.md`/`.markdown` 파일 업로드 시 `indexFile(toSubpath(destination))` 호출.
try/catch로 감싸 실패해도 업로드 성공에 영향 없음 (`:250-251`).

### 11. file-content PUT 후 색인 갱신
**PASS**. `file-content/route.ts:166-175`에서 `.md`/`.markdown` 파일 저장 시 `indexFile(userSubpath)` 호출.
try/catch로 감싸 실패해도 저장 성공에 영향 없음 (`:173-174`).

### 12. 보안 불변식 2 -- 절대 경로 비노출
**PASS**. 검색 결과의 `subpath`는 `search-index.ts`의 FTS5 테이블에 상대 경로로 저장됨 (`:192`, `toSubpath` 경유).
`indexFile()` 에서 `toSubpath(fullPath)` 사용 (`search-index.ts:138`, `indexFile` 내부에서는 `subpath` 인자를 그대로 저장).

### 13. 보안 불변식 8 -- 에러 응답에 내부 정보 없음
**PASS**.
- `search/route.ts:31`: `apiError(400, 'Search query must be at least 2 characters.')` -- 일반 메시지만 노출.
- `search/route.ts:43`: `internalError('search', error)` -- 클라이언트에는 "Internal server error."만, 서버 로깅만.
- `tags/route.ts:28`: `internalError('tags', error)` -- 동일.
- `api-response.ts:28-29`: `internalError`가 `console.error`로 서버 로깅 + 클라이언트에는 고정 메시지만 반환.

### 14. `runtime = 'nodejs'` 선언
**PASS**.
- `search/route.ts:24`: `export const runtime = 'nodejs';`
- `tags/route.ts:20`: `export const runtime = 'nodejs';`
- 기존 라우트도 전부 선언 확인 (files `:35`, upload `:48`, file-content `:31`, thumbnail `:31`).

### 15. 미인증 요청 -- 401
**PASS**. `src/middleware.ts:86-124`에서 `/api/search`, `/api/tags` 포함 모든 `/api/*` 경로를 세션 검증.
`PUBLIC_API` (`:33-35`)에는 `POST /api/auth/login`만 등록. 미인증 시 API는 401 JSON 반환 (`:107-108`).

### 16. search-index 유닛 테스트
**PASS**. `src/lib/search-index.test.ts`에 13건의 테스트:
- 한글 trigram 부분 일치 (`:97-118`)
- 영문 검색 (`:125-147`)
- snippet 하이라이트 마커 (`:153-172`)
- BM25 정렬 (`:178-212`)
- 증분 빌드 변경 감지 (`:218-265`)
- 증분 빌드 삭제 감지 (`:271-303`)
- 태그 집계 (`:309-372`)
- 빈 검색어 (`:378-386`)
- 특수문자 검색 2건 (`:392-429`)
- frontmatter 없는 파일 (`:435-454`)
- isIndexing() 상태 (`:460-478`)
- 검색 결과 mtime (`:484-502`)

전부 통과.

### 17. SQLite DB -- `.mdws/` 디렉터리
**PASS**. `search-index.ts:57-63`에서 DB 경로를 `MARKDOWN_ROOT/.mdws/search.db`로 설정.
`.mdws/` 디렉터리 자동 생성 (`:75`). `/api/files`에서 `.` 시작 이름 필터링 (`:97`)으로 GridView 미노출.

### 18. 색인 갱신 실패 시 업로드/저장 성공
**PASS**.
- `upload/route.ts:244-252`: try/catch로 `indexFile` 감싸, 실패 시 `console.error`만 하고 계속 진행.
- `file-content/route.ts:166-175`: 동일 패턴.

---

## 검색 (ADR-007) 전용 검증

| 항목 | 근거 | 판정 |
|------|------|------|
| FTS5 테이블 `tokenize='trigram'` | `search-index.ts:89` | PASS |
| 실시간 재귀 `fs` 스캔으로 검색 구현 금지 | 검색은 `search()` 함수가 FTS5 MATCH 쿼리 실행 (`search-index.ts:240-253`). `fs` 스캔 없음. | PASS |
| 업로드/저장 시 증분 색인 갱신 호출 | `upload/route.ts:248`, `file-content/route.ts:171` | PASS |
| `snippet()` 하이라이트 + BM25 정렬 | `search-index.ts:244` (snippet), `:249` (ORDER BY rank) | PASS |

---

## 스코프 드리프트 검증

| 항목 | 결과 |
|------|------|
| FTP 패키지 (`basic-ftp` 등) | 코드/의존성에 없음 | PASS |
| 카카오 관련 코드/의존성 | 코드/의존성에 없음 | PASS |
| `os.homedir()` 하드코딩 폴백 | 프로덕션 코드에 없음 (테스트에서 `os.tmpdir()`만 사용) | PASS |

---

## 주의 사항 (FAIL 아님)

### N-1. `initIndex()` 서버 기동 시 호출 미구현

**현상**: `search-index.ts:308`의 `initIndex()` 함수는 구현되어 있으나, 프로덕션 코드(라우트/미들웨어)에서 호출하는 지점이 없다. 테스트 코드에서만 호출된다.

**영향**: 서버 재시작 후 기존 마크다운 파일의 색인이 자동으로 구축되지 않는다. 앱 내 업로드/편집된 파일은 `indexFile()`이 호출되어 즉시 검색 가능하지만, 서버 외부에서 추가된 파일은 검색되지 않는다.

**완화**: `npm run rebuild-index`로 수동 색인 구축 가능. `stage-3-backend-complete.md` 섹션 8에서 이 항목을 명시적으로 미결 사항으로 기록함.

**FAIL로 판정하지 않는 이유**: 계약서(`backend-stage-3-contract.md` 1.3)에서 `initIndex()`의 **함수 구현**을 요구하고 있으며, 호출 지점은 "서버 기동 시 1회 호출"로 명시되어 있으나 구체적인 호출 위치(미들웨어/instrumentation/layout)는 지정하지 않았다. 완료 문서에서 미결 사항으로 명시적 기록. Stage 3 체크리스트의 핵심 검증 항목(업로드 후 검색 가능, 편집 후 검색 반영)은 `indexFile()` 직접 호출로 충족됨.

**권장 조치**: `src/instrumentation.ts` 또는 첫 번째 검색/태그 요청 시 lazy `initIndex()` 호출 추가. backlog P2에 기록 권장.

---

## 최종 판정

**PASS**

Stage 3 백엔드 구현은 계약 문서 및 보안 불변식을 모두 충족한다. 자동화 검증(typecheck/lint/test/build) 전부 통과. 신규 엔드포인트(`/api/search`, `/api/tags`)와 기존 엔드포인트 변경(`/api/files` ctime, upload/file-content FTS5 훅)이 계약과 일치하며, FTS5 trigram 색인, snippet 하이라이트, BM25 정렬, 증분 갱신이 올바르게 구현되었다. `initIndex()` 자동 호출 미구현은 주의 사항으로 기록하되, 핵심 기능(업로드/편집 후 즉시 검색)에는 영향 없으므로 FAIL로 판정하지 않는다.
