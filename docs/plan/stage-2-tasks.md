# Stage 2 작업 분해 -- GridView + 뷰어 + Monaco 편집 + 썸네일

- 작성: `tech-lead` / 2026-07-24
- 계약 기준: [backend-stage-2-contract.md](../agent-work/backend-stage-2-contract.md) / [frontend-stage-2-contract.md](../agent-work/frontend-stage-2-contract.md)
- 타입 기준: [src/types/api.ts](../../src/types/api.ts) (Stage 0에서 이미 정의됨 -- 변경 불필요)
- 목표: 폴더 탐색 -> 파일 목록 -> 마크다운 뷰어/편집까지의 전체 콘텐츠 워크플로

---

## 선행 결정 (tech-lead 확정)

### D2-1. SVG 저장형 XSS 대응 (backlog P2-5 해소)

**결정: SVG는 `<img>`로만 렌더한다.**

- `ALLOWED_EXTENSIONS`에서 `svg`를 제거하지 않는다 -- 업로드/저장은 허용.
- GridView 카드, 뷰어, 에디터 미리보기 어디에서도 SVG를 DOM에 인라인 삽입하지 않는다.
- 모든 이미지는 `<img src="/api/thumbnail?path=...">` 또는 `<img src="...">`로 렌더한다.
- `<img>` 태그는 SVG 내부 스크립트를 실행하지 않으므로 XSS가 성립하지 않는다.
- sanitize 라이브러리 의존성이 불필요하고, 우회 위험이 없다.
- 근거: security-stage-1-validation.md T-22 후속 제안.

### D2-2. sharp 사용 확인

- `next.config.ts`의 `images.unoptimized: true`는 `next/image` 내장 최적화만 끈다.
- `/api/thumbnail`은 직접 설치한 `sharp@0.35.3`을 쓰므로 이 설정의 영향을 받지 않는다.
- 확인 완료 -- 추가 조치 불필요.

### D2-3. Monaco 로딩 전략

- `@monaco-editor/react`의 기본 CDN 로딩을 사용한다.
- 앱은 ngrok을 통해 인터넷에 노출되므로 CDN 접근에 문제가 없다.
- 로컬 번들링은 빌드 크기를 크게 늘리므로 채택하지 않는다.
- 오프라인 사용이 필요해지면 그때 재검토한다.

### D2-4. 워크스페이스 라우팅 구조

쿼리 파라미터 기반 + 별도 페이지 조합:

| URL | 용도 |
|-----|------|
| `/workspace` 또는 `/workspace?path=subfolder` | GridView (폴더/파일 목록) |
| `/workspace/view?path=docs/note.md` | 마크다운 뷰어 (읽기 전용) |
| `/workspace/edit?path=docs/note.md` | Monaco 에디터 (편집 + 실시간 미리보기) |

- `/workspace`는 기존 Stage 1 골격을 확장한다. `path` 파라미터 없으면 루트.
- 뷰어와 에디터는 별도 페이지로 분리한다 -- Monaco 번들을 GridView에서 로딩하지 않기 위함.
- 뷰어에서 "편집" 버튼 클릭 시 `/workspace/edit?path=...`로 이동한다.
- 에디터에서 저장 후 뷰어로 돌아갈 수 있다.

---

## 범위에 포함되는 엔드포인트

| 메서드 | 경로 | 담당 |
|--------|------|------|
| GET | `/api/files?path=&sort=&tag=` | backend-dev |
| GET | `/api/file-content?path=` | backend-dev |
| PUT | `/api/file-content` | backend-dev |
| GET | `/api/thumbnail?path=&w=` | backend-dev |

타입은 `src/types/api.ts`에 이미 정의되어 있다:
`FilesQuery`, `FileEntry`, `FilesResponse`, `FileContentResponse`, `SaveFileRequest`, `SaveFileResponse`, `SaveConflictResponse`, `ThumbnailQuery`.

유틸은 `src/lib/file-utils.ts`에 이미 정의되어 있다:
`classifyEntry`, `isThumbnailable`, `buildThumbnailUrl`, `extractSnippet`.

---

## 실행 순서 (Wave)

```
Wave 1 ──┬── backend-dev   : /api/files + /api/file-content(GET+PUT) + /api/thumbnail
         └── frontend-dev  : GridView + 브레드크럼 + 뷰어 + 에디터 + 409 UI   (계약만 보고 병렬)
              ↓
Wave 2 ──┬── backend-validator    (fable)
         └── frontend-validator   (fable)                   동시 실행
              ↓
Wave 3 ───── qa-integration → optimizer                     (fable)
```

**임계 경로**: 없음 -- 프론트와 백엔드가 완전 병렬. 타입 계약이 이미 확정되어 있다.

**의존성 확인**: Stage 1 산출물(`path-safety`, `session`, `api-response`, `env`, `rate-limit`, `fetcher`, `file-utils`)이 모두 완성되어 있으므로 즉시 착수 가능하다.

---

## Wave 1-A -- backend-dev (opus)

Stage 1의 `path-safety`, `api-response`, `env` 유틸과 `file-utils`를 그대로 사용한다.

### 보안 불변식 준수 사항

모든 라우트에 공통:
- `export const runtime = 'nodejs'` 선언 (fs/sharp/crypto 사용)
- 모든 `path` 파라미터: `resolveUnderRoot` -> `assertRealPathUnderRoot` (불변식 2)
- `verifySession`은 middleware가 처리 -- 라우트에서 중복 호출 불필요
- 에러 응답은 `apiError()` / `internalError()` 경유 (불변식 8)

| # | 작업 | 산출물 | 보안 불변식 |
|---|------|--------|-------------|
| 1 | `GET /api/files` -- 폴더/파일 목록 조회 | `src/app/api/files/route.ts` | 2, 8 |
| 2 | `GET /api/file-content` -- 마크다운 파일 읽기 | `src/app/api/file-content/route.ts` | 2, 8 |
| 3 | `PUT /api/file-content` -- 마크다운 파일 저장 (baseMtime 409 + atomic write) | 같은 파일 | 2, 4, 5, 8 |
| 4 | `GET /api/thumbnail` -- sharp 리사이즈 + 디스크 캐시 | `src/app/api/thumbnail/route.ts` | 2, 8 |

### 상세 요구사항

**1. `GET /api/files`**
- 쿼리: `path` (상대 경로, 기본값 루트), `sort` (`mtime`|`name`|`size`, 기본값 `mtime`), `tag` (선택)
- `fs.readdir` + `fs.stat`으로 목록 구성
- `classifyEntry()`로 타입 분류, `isThumbnailable()`이면 `coverThumbUrl` 생성
- 마크다운 파일: `gray-matter`로 frontmatter 파싱 -> `tags`, `title`, `extractSnippet()` 2줄 미리보기
- 폴더: `fileCount` = 직접 하위 항목 수
- breadcrumb: `path`를 `/`로 분할 -> `['2026-Travel', 'Jeju']`
- 정렬: sort 파라미터에 따라 `mtime` 내림차순 / `name` 오름차순 / `size` 내림차순
- tag 필터: frontmatter tags에 해당 태그가 포함된 엔트리만 반환
- **절대 경로를 응답에 포함하지 않는다** -- 모든 경로는 `toSubpath()` 경유

**2. `GET /api/file-content`**
- 쿼리: `path` (필수, 상대 경로)
- `fs.readFile` + `fs.stat` -> `{ content, mtime: Math.round(stat.mtimeMs) }`
- 마크다운 파일이 아니어도 텍스트로 반환한다 (에디터에서 다른 텍스트 파일도 열 수 있도록)
- 파일이 없으면 400 (존재하지 않는 경로)

**3. `PUT /api/file-content`**
- 바디: `SaveFileRequest` = `{ path, content, baseMtime }`
- 충돌 감지: 디스크 `stat.mtimeMs`와 `baseMtime` 비교 -> 불일치 시 **409** + `SaveConflictResponse`
- **Atomic write** (불변식 4): 임시 파일 -> `fsync` -> `rename` (Stage 1 upload와 동일 패턴)
- 성공: `SaveFileResponse` = `{ ok: true, mtime }` (갱신된 mtime)
- TODO(Stage 3): 저장 후 FTS5 색인 증분 갱신 훅 지점

**4. `GET /api/thumbnail`**
- 쿼리: `path` (필수), `w` (필수, 양의 정수, 최대 1200)
- `isThumbnailable()`이 false면 400
- 캐시 키: `MARKDOWN_ROOT/.thumbcache/<sha256(subpath + mtime + w)>.webp`
  - 캐시 디렉터리는 `MARKDOWN_ROOT` 하위에 둔다 (별도 env 불필요)
  - 캐시 히트 시 캐시 파일을 그대로 스트리밍
- sharp: 원본 읽기 -> `resize(w)` -> `webp({ quality: 80 })` -> 캐시에 저장 + 응답
- 응답 헤더: `Content-Type: image/webp`, `Cache-Control: public, max-age=86400, immutable`
- SVG는 `isThumbnailable()`에서 이미 제외되므로 썸네일 대상이 아니다

---

## Wave 1-B -- frontend-dev (opus)

`fetcher.ts`의 `apiFetch`를 모든 API 호출에 사용한다. 401 리다이렉트와 429 토스트는 자동 처리된다.

| # | 작업 | 산출물 | 호출 API |
|---|------|--------|----------|
| 1 | GridView 컴포넌트 (반응형 카드 그리드) | `src/components/workspace/GridView.tsx` | GET /api/files |
| 2 | 브레드크럼 내비게이션 | `src/components/workspace/Breadcrumb.tsx` | (props) |
| 3 | `/workspace` 페이지 확장 | `src/app/workspace/page.tsx` 수정 | GET /api/files |
| 4 | 마크다운 뷰어 페이지 | `src/app/workspace/view/page.tsx` | GET /api/file-content |
| 5 | Monaco 에디터 페이지 (분할 뷰) | `src/app/workspace/edit/page.tsx` | GET+PUT /api/file-content |
| 6 | 409 충돌 경고 UI | `src/components/workspace/ConflictWarning.tsx` | (props) |
| 7 | Cmd+S 저장 단축키 | (에디터 페이지 내) | PUT /api/file-content |

### 상세 요구사항

**1. GridView**
- Tailwind `grid grid-cols-2 md:grid-cols-4 gap-4` 반응형 카드
- 카드 종류 (EntryType별):
  - `folder`: 폴더 아이콘(lucide `Folder`) + 이름 + fileCount
  - `markdown`: 커버 썸네일(있으면) + 제목(title 또는 name) + snippet 2줄 + tags
  - `image`: 썸네일(`/api/thumbnail?path=...&w=400`) + 파일명
  - `other`: 파일 아이콘(lucide `File`) + 파일명 + 크기
- 클릭 동작:
  - `folder` -> `/workspace?path=<subpath>` (같은 페이지, 쿼리만 변경)
  - `markdown` -> `/workspace/view?path=<subpath>`
  - `image` -> 새 탭에서 원본 열기 (또는 뷰어에서 표시)
  - `other` -> 아무 동작 없음 (또는 다운로드)
- 빈 폴더: "이 폴더는 비어 있습니다" 안내

**2. 브레드크럼**
- `FilesResponse.breadcrumb` 배열을 순서대로 렌더
- 각 세그먼트 클릭 -> 해당 경로의 GridView로 이동
- 최상위는 "Home" (path 없음)
- 현재 위치는 링크가 아닌 텍스트로 표시

**3. `/workspace` 페이지 확장**
- 기존 Stage 1 골격(`uploadOpen`, `loggingOut`, `handleUploaded`)을 유지한다
- `useSearchParams`로 `path` 쿼리 읽기
- `apiFetch<FilesResponse>('/api/files?path=...')` 호출
- 정렬 드롭다운 UI (Stage 3 검색과 별개로, 기본 정렬은 이 단계에서 구현)
- 업로드 성공 후 `handleUploaded`에서 파일 목록 재조회 (TODO 해소)

**4. 마크다운 뷰어**
- `apiFetch<FileContentResponse>('/api/file-content?path=...')`
- `react-markdown` + `remark-gfm` + `rehype-highlight`로 렌더
- 이미지 참조(`![](./image.png)`)는 상대 경로를 `/api/thumbnail?path=...`로 변환
- **SVG는 `<img>` 태그로만 렌더** (D2-1 결정)
- 상단에 "편집" 버튼 -> `/workspace/edit?path=...`
- 뒤로가기: 브레드크럼 또는 브라우저 히스토리

**5. Monaco 에디터**
- 좌우 분할: 왼쪽 Monaco, 오른쪽 react-markdown 미리보기
- 파일 로드 시 `mtime`을 상태에 저장 (baseMtime)
- Cmd+S (Mac) / Ctrl+S (기타):
  - `apiFetch<SaveFileResponse>('/api/file-content', { method: 'PUT', body: JSON.stringify(saveRequest) })`
  - 성공 시 baseMtime을 응답의 `mtime`으로 갱신
  - 409 시 ConflictWarning 표시
- 에디터 언어: `markdown`
- 미저장 변경 시 페이지 이탈 경고 (`beforeunload`)

**6. 409 충돌 경고 UI**
- "이 파일이 다른 곳에서 수정되었습니다. 현재 편집 내용을 복사한 뒤 새로고침하세요." 식 비파괴적 경고
- **덮어쓰기 버튼을 제공하지 않는다** (불변식 5 -- 무단 덮어쓰기 금지)
- 사용자는 내용을 클립보드에 복사 -> 새로고침 -> 수동 병합해야 한다
- `SaveConflictResponse.currentMtime`을 표시해 언제 변경됐는지 알려 준다

**7. Cmd+S 단축키**
- `useEffect`에서 `keydown` 이벤트 리스너 등록
- `event.metaKey && event.key === 's'` (Mac) 또는 `event.ctrlKey && event.key === 's'`
- `event.preventDefault()`로 브라우저 기본 저장 대화상자 차단
- 저장 중에는 중복 요청 방지 (debounce 또는 lock)

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
| 5 | 보안 불변식 2 -- path 검증 | 4개 라우트 모두 `resolveUnderRoot` + `assertRealPathUnderRoot` 호출 확인 |
| 6 | 보안 불변식 4 -- atomic write | PUT /api/file-content가 임시 파일 -> fsync -> rename 패턴 사용 |
| 7 | 보안 불변식 5 -- baseMtime 409 | mtime 불일치 시 409 + `SaveConflictResponse` 반환 |
| 8 | 보안 불변식 8 -- 내부 정보 비노출 | 응답에 절대 경로/스택트레이스 없음 |
| 9 | `runtime = 'nodejs'` | 4개 라우트 전부 선언 |
| 10 | curl E2E | files/file-content(GET+PUT)/thumbnail 정상 동작 |
| 11 | traversal 시도 | `../`, 절대 경로, 인코딩 우회가 400으로 거부됨 |
| 12 | 미인증 요청 | 4개 라우트 전부 401 |

### frontend-validator 체크리스트

| # | 검증 항목 | 통과 조건 |
|---|-----------|-----------|
| 1 | 빌드 성공 | `npm run build` 에러 없음 |
| 2 | GridView 렌더 | 폴더/md/이미지/기타 카드가 올바르게 표시 |
| 3 | 브레드크럼 동작 | 세그먼트 클릭으로 상위 폴더 이동 |
| 4 | 뷰어 렌더 | react-markdown으로 마크다운 정상 렌더 |
| 5 | 에디터 분할 뷰 | Monaco 좌측 + 미리보기 우측 |
| 6 | Cmd+S 저장 | 성공 시 mtime 갱신, 토스트 확인 |
| 7 | 409 충돌 UI | 비파괴적 경고 표시, 덮어쓰기 버튼 없음 |
| 8 | SVG XSS 방어 | SVG가 `<img>`로만 렌더됨, 인라인 삽입 없음 |
| 9 | 모든 API 호출이 `apiFetch` 경유 | raw fetch 사용 없음 |
| 10 | 업로드 후 목록 갱신 | 업로드 성공 -> GridView 재조회 |

---

## Wave 3 -- qa-integration + optimizer (fable)

- qa-integration: 전체 흐름 E2E (로그인 -> GridView -> 뷰어 -> 편집 -> 저장 -> 목록 갱신)
- optimizer: 번들 크기, 렌더 성능, 불필요한 리렌더 점검

---

## 단계 완료 조건

1. GridView에서 폴더/파일 목록이 정상 표시
2. 폴더 클릭 -> 하위 목록 -> 마크다운 클릭 -> 뷰어 -> 편집 -> 저장의 전체 흐름 동작
3. `baseMtime` 불일치 시 409 + 비파괴적 경고 표시
4. 썸네일 생성 및 캐시 동작
5. SVG가 `<img>`로만 렌더 (XSS 방어)
6. 모든 path 파라미터가 `resolveUnderRoot` + `assertRealPathUnderRoot` 경유
7. `npm run build` / `typecheck` / `test` / `lint` 통과
8. 검증 리포트 FAIL 0건
