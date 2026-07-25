# Stage 2 백엔드 완료 기록

- 작성: `backend-dev` / 2026-07-24
- 계약 기준: [backend-stage-2-contract.md](../agent-work/backend-stage-2-contract.md)
- 타입 기준: [src/types/api.ts](../../src/types/api.ts) (변경 없음)

---

## 구현 완료 항목

### 1. `GET /api/files` -- `src/app/api/files/route.ts`

| 항목 | 상태 |
|------|------|
| `export const runtime = 'nodejs'` | 완료 |
| `resolveUnderRoot` + `assertRealPathUnderRoot` 경로 검증 | 완료 |
| `PathSafetyError` -> `apiError(400, 'Invalid path.')` | 완료 |
| 숨김 파일(`.` 시작) 제외 | 완료 |
| `classifyEntry()`로 타입 분류 | 완료 |
| 폴더: `fileCount` (숨김 제외 직접 하위 항목 수) | 완료 |
| 마크다운: `gray-matter` frontmatter 파싱 (title, tags, snippet) | 완료 |
| 마크다운: 본문 첫 이미지 -> `coverThumbUrl` | 완료 |
| 마크다운: frontmatter `cover` 필드 우선 사용 | 완료 |
| 이미지: `isThumbnailable` -> `buildThumbnailUrl` -> `coverThumbUrl` | 완료 |
| breadcrumb: path 분할 -> 세그먼트 배열 | 완료 |
| 정렬: 폴더 먼저 + sort 키 (mtime/name/size) | 완료 |
| 태그 필터: 폴더 제외, `tags.includes(tag)` | 완료 |
| 절대 경로 비노출 (`toSubpath()` 경유) | 완료 |
| `apiError` / `internalError` 경유 에러 응답 | 완료 |

### 2. `GET /api/file-content` -- `src/app/api/file-content/route.ts`

| 항목 | 상태 |
|------|------|
| `export const runtime = 'nodejs'` | 완료 |
| `path` 필수 검증 | 완료 |
| `resolveUnderRoot` + `assertRealPathUnderRoot` 경로 검증 | 완료 |
| `fs.readFile(utf8)` + `Math.round(stat.mtimeMs)` | 완료 |
| frontmatter 포함 원본 전체 반환 | 완료 |
| 디렉터리 -> `apiError(400, 'Not a file.')` | 완료 |
| 미존재 -> `apiError(400, 'File not found.')` | 완료 |

### 3. `PUT /api/file-content` -- `src/app/api/file-content/route.ts`

| 항목 | 상태 |
|------|------|
| 바디 타입 검증 (path, content, baseMtime) | 완료 |
| 빈 문자열 content 허용 | 완료 |
| 충돌 감지 (보안 불변식 5): mtime 비교 -> 409 + `SaveConflictResponse` | 완료 |
| Atomic write (보안 불변식 4): 임시 파일 -> writeFile -> sync -> close -> rename | 완료 |
| 임시 파일 패턴: `.mdws-edit-<randomBytes(12).hex>.tmp` | 완료 |
| 실패 시 임시 파일 정리 | 완료 |
| 저장 후 stat -> 갱신된 mtime 반환 | 완료 |
| 미존재 파일 -> `apiError(400, 'File does not exist.')` | 완료 |
| TODO(Stage 3) FTS5 색인 갱신 훅 주석 | 완료 |

### 4. `GET /api/thumbnail` -- `src/app/api/thumbnail/route.ts`

| 항목 | 상태 |
|------|------|
| `export const runtime = 'nodejs'` | 완료 |
| `path`, `w` 필수 + `w` 범위 검증 (1-1200) | 완료 |
| `isThumbnailable()` 검증 | 완료 |
| 디스크 캐시: `MARKDOWN_ROOT/.thumbcache/` | 완료 |
| 캐시 키: `sha256(subpath + ':' + mtime + ':' + w).hex + '.webp'` | 완료 |
| 캐시 히트 -> 캐시 파일 읽기 반환 | 완료 |
| 캐시 미스 -> sharp 리사이즈 -> 캐시에 저장 + 반환 | 완료 |
| sharp 옵션: `resize(w, null, { fit: 'inside', withoutEnlargement: true })` | 완료 |
| webp 품질: 80 | 완료 |
| 응답 헤더: `Content-Type: image/webp`, `Cache-Control: public, max-age=86400, immutable` | 완료 |
| sharp 에러 -> `internalError()` | 완료 |
| 캐시 쓰기 실패 -> 서버 로깅만 (응답에 영향 없음) | 완료 |

---

## 추가 수정 (빌드 통과를 위한 프론트엔드 보조 수정)

프론트엔드 코드에서 빌드를 차단하는 3가지 이슈를 함께 수정했다.

| 파일 | 문제 | 수정 |
|------|------|------|
| `src/app/workspace/view/page.tsx` | `react-markdown` v10에서 `{ Markdown }` named export 없음 | `{ MarkdownHooks as Markdown }` 으로 변경 |
| `src/app/workspace/edit/page.tsx` | 동일 이슈 + `useSearchParams()` Suspense 경계 누락 | `MarkdownHooks` import + Suspense 래핑 |
| `src/app/workspace/view/page.tsx` | `useSearchParams()` Suspense 경계 누락 | Suspense 래핑 |
| `src/app/workspace/page.tsx` | `useEffect` 내 동기 `setState` lint 오류 | IIFE async 패턴으로 리팩토링 |
| `src/app/workspace/view/page.tsx`, `src/app/workspace/edit/page.tsx` | `img.src`가 `string | Blob` 타입 | `typeof src !== 'string'` 가드 추가 |

---

## 변경 파일 목록

### 신규 생성 (백엔드 라우트)

| 파일 | 설명 |
|------|------|
| `src/app/api/files/route.ts` | `GET /api/files` -- 디렉터리 목록 |
| `src/app/api/file-content/route.ts` | `GET /api/file-content` + `PUT /api/file-content` -- 파일 읽기/저장 |
| `src/app/api/thumbnail/route.ts` | `GET /api/thumbnail` -- sharp 썸네일 |

### 수정 (빌드 통과 보조)

| 파일 | 변경 사항 |
|------|-----------|
| `src/app/workspace/view/page.tsx` | react-markdown import 수정 + Suspense 래핑 + img src 타입 가드 |
| `src/app/workspace/edit/page.tsx` | react-markdown import 수정 + Suspense 래핑 + img src 타입 가드 |
| `src/app/workspace/page.tsx` | useEffect 내 동기 setState 제거 |

---

## 보안 불변식 준수 확인

| # | 불변식 | 적용 라우트 | 상태 |
|---|--------|-------------|------|
| 2 | 모든 path -> `resolveUnderRoot` + `assertRealPathUnderRoot` | files, file-content(GET+PUT), thumbnail | 완료 |
| 4 | Atomic write (임시 파일 -> fsync -> rename) | file-content(PUT) | 완료 |
| 5 | baseMtime 충돌 감지 -> 409 + `SaveConflictResponse` | file-content(PUT) | 완료 |
| 8 | 절대 경로/스택트레이스 비노출 | 전체 | 완료 |
| - | `export const runtime = 'nodejs'` | 전체 4개 라우트 | 완료 |

---

## 검증 결과

| 항목 | 결과 |
|------|------|
| `npm run typecheck` | 통과 (오류 0) |
| `npm run lint` | 통과 (오류 0, 경고 0) |
| `npm test` | 통과 (6 파일, 106 테스트 전체 통과) |
| `npm run build` | 통과 (14 페이지 성공 생성) |

빌드 경고 1건: `next.config.ts` NFT tracing 경고 -- Stage 1에서부터 존재하는 기존 경고이며, `upload/route.ts`의 fs 연산 때문이다. 기능에 영향 없음.

---

## 미결 항목

| 항목 | 예정 단계 |
|------|-----------|
| FTS5 색인 증분 갱신 (PUT /api/file-content 저장 후) | Stage 3 |
| FTS5 색인 증분 갱신 (POST /api/upload 저장 후) | Stage 3 |
