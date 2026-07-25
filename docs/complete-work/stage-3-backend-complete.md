# Stage 3 -- backend-dev 완료 기록

- 담당: `backend-dev` (model: opus)
- 완료일: 2026-07-25
- 근거 계약: [backend-stage-3-contract.md](../agent-work/backend-stage-3-contract.md) / [stage-3-tasks.md](../plan/stage-3-tasks.md)
- 타입 기준: [src/types/api.ts](../../src/types/api.ts)
- 계약 변경: **없음** (SortKey에 'ctime' 추가는 Wave 0에서 tech-lead가 이미 반영함)

---

## 1. 구현 범위

Stage 3 계획서 [stage-3-tasks.md](../plan/stage-3-tasks.md) Wave 1-A의 전체 항목.

| # | 작업 | 상태 |
|---|------|------|
| 1 | `src/lib/search-index.ts` -- FTS5 색인 관리 모듈 | 완료 |
| 2 | `GET /api/search?q=` -- FTS5 검색 라우트 | 완료 |
| 3 | `GET /api/tags` -- 태그 집계 라우트 | 완료 |
| 4 | `GET /api/files` -- ctime 정렬 추가 | 완료 |
| 5 | upload/file-content에 FTS5 갱신 훅 삽입 | 완료 |
| 6 | `src/scripts/rebuild-index.mts` -- 수동 재구축 스크립트 | 완료 |
| 7 | `src/lib/search-index.test.ts` -- 유닛 테스트 | 완료 (13건 전체 통과) |

---

## 2. 신규 생성 파일

| 파일 | 내용 |
|------|------|
| `src/lib/search-index.ts` | FTS5 색인 관리 단일 모듈. DB 초기화, 증분 빌드, indexFile, search, getAllTags, initIndex, isIndexing |
| `src/app/api/search/route.ts` | `GET /api/search?q=`. FTS5 MATCH + snippet() + BM25 정렬. `SearchResponse` 반환 |
| `src/app/api/tags/route.ts` | `GET /api/tags`. 전체 태그 집계. `TagsResponse` 반환 (count 내림차순) |
| `src/scripts/rebuild-index.mts` | 수동 색인 전체 재구축 CLI. 기존 DB 삭제 후 처음부터 구축 |
| `src/lib/search-index.test.ts` | 13개 유닛 테스트 (한글/영문 검색, snippet 마커, BM25, 증분/삭제, 태그, 특수문자 등) |

## 3. 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/app/api/files/route.ts` | `VALID_SORT_KEYS`에 `'ctime'` 추가, switch문에 `case 'ctime'` (birthtimeMs 내림차순) |
| `src/app/api/upload/route.ts` | FTS5 갱신 훅 추가 (indexFile, .md 파일만, try/catch로 감싸 실패해도 업로드 성공에 영향 없음) |
| `src/app/api/file-content/route.ts` | FTS5 갱신 훅 추가 (indexFile, .md 파일만, try/catch로 감싸 실패해도 저장 성공에 영향 없음) |
| `package.json` | `"rebuild-index": "tsx src/scripts/rebuild-index.mts"` 스크립트 추가 |

---

## 4. 엔드포인트별 상태

| 메서드 | 경로 | 상태 | 비고 |
|--------|------|------|------|
| GET | `/api/search?q=` | 완료 | FTS5 MATCH, snippet 하이라이트, BM25 정렬, indexing 플래그 |
| GET | `/api/tags` | 완료 | frontmatter 태그 집계, count 내림차순 |
| GET | `/api/files?sort=ctime` | 완료 | birthtimeMs 내림차순 정렬. 응답에 ctime 필드 미포함 (계약) |
| POST | `/api/upload` | 변경 완료 | 업로드 후 .md 파일 1건 색인 갱신 |
| PUT | `/api/file-content` | 변경 완료 | 저장 후 .md 파일 1건 색인 갱신 |

---

## 5. 보안 불변식 준수 현황

| # | 불변식 | 적용 확인 |
|---|--------|-----------|
| 1 | 세션 보호 | `/api/search`, `/api/tags` 모두 middleware에서 세션 검증 |
| 2 | 경로 검증 | `search-index.ts`의 `indexFile()`에서 `resolveUnderRoot` + `assertRealPathUnderRoot` |
| 6 | 시크릿 비노출 | DB 경로를 응답에 포함하지 않음 |
| 8 | 내부 정보 비노출 | 에러 응답에 절대 경로/스택트레이스 포함 금지. `apiError()` / `internalError()` 경유 |

---

## 6. 검증 결과

| 검증 | 결과 |
|------|------|
| `npm run typecheck` | 오류 0 |
| `npm run lint` | 오류 0 |
| `npm test` | 119건 전체 통과 (7 파일, 실패 0) |
| `npm run build` | 성공 |

---

## 7. 설계 결정 및 특이사항

1. **SQLite DB 위치**: `MARKDOWN_ROOT/.mdws/search.db`. `.mdws/`는 숨김 디렉터리로 `/api/files`의 GridView에 노출되지 않는다.

2. **trigram 토크나이저**: FTS5 `tokenize='trigram'`을 사용해 한국어 부분일치를 지원한다. trigram은 3자 단위이므로 2자 미만 검색어는 의미 있는 결과를 반환하지 않는다. 라우트에서 2자 미만을 400으로 사전 거부한다.

3. **증분 빌드**: `initIndex()` 호출 시 비동기 백그라운드에서 디스크와 DB를 비교해 변경분만 색인한다. 빌드 중 `isIndexing() === true`이고 검색 응답에 `indexing: true`를 포함한다.

4. **색인 갱신 실패 격리**: upload/file-content 라우트에서 `indexFile()` 호출을 try/catch로 감싸 실패해도 HTTP 응답에 영향을 주지 않는다. 다음 서버 재시작 시 증분 빌드에서 복구된다.

5. **ctime 정렬**: `stat.birthtimeMs`를 사용. macOS에서는 실제 생성일, Linux에서는 메타데이터 변경일이다. `FileEntry` 응답에 ctime 필드를 포함하지 않는다(계약상 정렬 전용).

6. **빈 검색어 처리**: FTS5 trigram에서 빈 쌍따옴표 `""` MATCH는 결과 없음(빈 배열)을 반환한다. 라우트 핸들러가 2자 미만을 400으로 사전 거부하므로 실제로 빈 검색어가 search()에 도달하지 않는다.

---

## 8. 미결 항목

- **chokidar 파일 감시**: 앱 외부(파인더/터미널) 변경 포착용. backlog P2-2로 이관. 현재는 서버 재시작 시 증분 빌드에서 포착.
- **initIndex() 호출 지점**: 서버 기동 시 자동 호출하는 훅이 아직 없다. 프론트엔드 또는 미들웨어에서 최초 요청 시 호출하거나, 별도 서버 시작 스크립트에서 호출해야 한다.
