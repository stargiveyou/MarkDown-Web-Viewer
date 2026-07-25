# 백엔드 API 계약 -- Stage 2

- 작성: `tech-lead` / 2026-07-24
- 상태: **확정** (backend-dev는 이 계약에 따라 구현한다)
- 타입 기준: [src/types/api.ts](../../src/types/api.ts) -- **변경하지 않는다**. 타입이 이미 전부 정의되어 있다.
- 유틸 기준: [src/lib/path-safety.ts](../../src/lib/path-safety.ts), [src/lib/api-response.ts](../../src/lib/api-response.ts), [src/lib/file-utils.ts](../../src/lib/file-utils.ts), [src/lib/env.ts](../../src/lib/env.ts)

---

## 공통 규칙

1. **`export const runtime = 'nodejs'`** -- 4개 라우트 전부 (fs/sharp 사용)
2. **경로 검증 (보안 불변식 2)** -- 사용자 입력 경로는 반드시:
   - `resolveUnderRoot(userPath)` -> 절대 경로 획득
   - `assertRealPathUnderRoot(absolutePath)` -> 심볼릭 링크 탈출 차단
   - 이 순서를 건너뛰거나 직접 `path.join(root, userPath)` 하면 검증 FAIL
3. **에러 응답 (보안 불변식 8)** -- `apiError()` 또는 `internalError()` 경유. 절대 경로/스택트레이스 노출 금지
4. **PathSafetyError 처리** -- catch해서 `apiError(400, 'Invalid path.')`로 변환. error.message를 클라이언트에 넘기지 않는다
5. **인증** -- middleware가 처리한다. 라우트에서 중복 확인 불필요
6. **Rate limit** -- Stage 2 라우트(GET 읽기 전용)에는 rate limit을 적용하지 않는다. PUT /api/file-content는 쓰기지만, 인증된 단일 사용자 앱이므로 이 단계에서는 미적용. Stage 4에서 필요 시 추가

---

## 1. `GET /api/files`

**파일**: `src/app/api/files/route.ts`

### 요청

```
GET /api/files?path=2026-Travel/Jeju&sort=mtime&tag=travel
```

| 파라미터 | 타입 | 필수 | 기본값 | 설명 |
|----------|------|------|--------|------|
| `path` | string | 아니오 | `""` (루트) | MARKDOWN_ROOT 기준 상대 경로 |
| `sort` | `SortKey` | 아니오 | `"mtime"` | `mtime` / `name` / `size` |
| `tag` | string | 아니오 | 없음 | frontmatter 태그 필터 |

### 응답: `FilesResponse`

```json
{
  "breadcrumb": ["2026-Travel", "Jeju"],
  "entries": [
    {
      "name": "photos",
      "type": "folder",
      "size": 0,
      "mtime": 1721800000000,
      "subpath": "2026-Travel/Jeju/photos",
      "fileCount": 12
    },
    {
      "name": "day1.md",
      "type": "markdown",
      "size": 4096,
      "mtime": 1721790000000,
      "subpath": "2026-Travel/Jeju/day1.md",
      "title": "제주 여행 1일차",
      "snippet": "오늘은 한라산을 등반했다.\n날씨가 매우 맑았다.",
      "tags": ["travel", "jeju"],
      "coverThumbUrl": "/api/thumbnail?path=2026-Travel%2FJeju%2Fcover.jpg&w=400"
    },
    {
      "name": "sunset.jpg",
      "type": "image",
      "size": 2048000,
      "mtime": 1721780000000,
      "subpath": "2026-Travel/Jeju/sunset.jpg",
      "coverThumbUrl": "/api/thumbnail?path=2026-Travel%2FJeju%2Fsunset.jpg&w=400"
    }
  ]
}
```

### 구현 지침

1. `path` -> `resolveUnderRoot()` -> `assertRealPathUnderRoot()` -> 디렉터리인지 확인
2. `fs.readdir(dir, { withFileTypes: true })` -> 디렉터리 엔트리 목록
3. 숨김 파일(`.`으로 시작) 제외 -- `.thumbcache`, `.DS_Store` 등
4. 각 엔트리에 대해 `fs.stat()` -> `FileEntry` 구성:
   - `classifyEntry(name, dirent.isDirectory())` -> `type`
   - `toSubpath(absolutePath)` -> `subpath` (절대 경로 노출 금지)
   - 폴더: `fs.readdir(subdir)` -> `fileCount` (숨김 파일 제외)
   - 마크다운: `gray-matter(await fs.readFile(..., 'utf8'))` -> `title`, `tags`, `snippet`
     - `matter.data.title` 또는 `matter.data.tags` 추출
     - `extractSnippet(matter.content)` -> `snippet`
     - 마크다운 본문에서 첫 이미지를 찾아 `buildThumbnailUrl()` -> `coverThumbUrl` (이미지가 `isThumbnailable()`인 경우만)
   - 이미지: `buildThumbnailUrl(subpath, 400)` -> `coverThumbUrl` (`isThumbnailable()`인 경우만)
5. `breadcrumb`: `path`를 `/`로 split -> `['2026-Travel', 'Jeju']`. 루트면 빈 배열.
6. 정렬:
   - `mtime`: `entries.sort((a, b) => b.mtime - a.mtime)` (내림차순 -- 최신 우선)
   - `name`: `entries.sort((a, b) => a.name.localeCompare(b.name, 'ko'))` (오름차순)
   - `size`: `entries.sort((a, b) => b.size - a.size)` (내림차순 -- 큰 파일 우선)
   - 정렬 전에 폴더를 맨 위로 올린다 (폴더 내부에서는 같은 기준)
7. `tag` 필터: `entries.filter(e => e.tags?.includes(tag))`
   - 태그 필터가 있으면 폴더는 결과에 포함하지 않는다 (폴더 자체에는 태그가 없다)
8. 디렉터리가 아닌 경로가 들어오면 `apiError(400, 'Not a directory.')`

### 에러 코드

| 코드 | 조건 |
|------|------|
| 400 | 경로 검증 실패 / 디렉터리가 아님 / 잘못된 sort 값 |
| 401 | (middleware 처리) |
| 500 | fs 읽기 실패 |

---

## 2. `GET /api/file-content`

**파일**: `src/app/api/file-content/route.ts`

### 요청

```
GET /api/file-content?path=2026-Travel/Jeju/day1.md
```

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `path` | string | 예 | MARKDOWN_ROOT 기준 상대 경로 |

### 응답: `FileContentResponse`

```json
{
  "content": "---\ntitle: 제주 여행 1일차\ntags:\n  - travel\n  - jeju\n---\n\n# 제주 여행 1일차\n\n오늘은 한라산을 등반했다...",
  "mtime": 1721790000000
}
```

### 구현 지침

1. `path` 필수. 없으면 `apiError(400, 'Path is required.')`
2. `resolveUnderRoot(path)` -> `assertRealPathUnderRoot()` -> 파일 존재 확인
3. `fs.readFile(absolutePath, 'utf8')` -> `content`
4. `fs.stat(absolutePath)` -> `Math.round(stat.mtimeMs)` -> `mtime`
5. frontmatter를 포함한 원본 전체를 반환한다 (에디터가 frontmatter도 편집할 수 있어야 한다)
6. 디렉터리 경로가 들어오면 `apiError(400, 'Not a file.')`

### 에러 코드

| 코드 | 조건 |
|------|------|
| 400 | path 미지정 / 경로 검증 실패 / 디렉터리인 경우 / 파일 미존재 |
| 401 | (middleware 처리) |
| 500 | fs 읽기 실패 |

---

## 3. `PUT /api/file-content`

**파일**: `src/app/api/file-content/route.ts` (같은 파일에 GET과 PUT 핸들러)

### 요청

```
PUT /api/file-content
Content-Type: application/json

{
  "path": "2026-Travel/Jeju/day1.md",
  "content": "# 수정된 내용\n\n...",
  "baseMtime": 1721790000000
}
```

바디 타입: `SaveFileRequest`

### 응답

**성공 (200)**: `SaveFileResponse`

```json
{
  "ok": true,
  "mtime": 1721795000000
}
```

**충돌 (409)**: `SaveConflictResponse`

```json
{
  "code": 409,
  "message": "File has been modified externally.",
  "currentMtime": 1721793000000
}
```

### 구현 지침

1. 바디 파싱: `await request.json()` -> `SaveFileRequest` 검증
   - `path`: 문자열, 필수
   - `content`: 문자열 (빈 문자열 허용 -- 빈 파일 저장은 유효)
   - `baseMtime`: 양의 정수, 필수
2. `resolveUnderRoot(path)` -> `assertRealPathUnderRoot()`
3. **충돌 감지 (보안 불변식 5)**:
   - `fs.stat(absolutePath)` -> `currentMtime = Math.round(stat.mtimeMs)`
   - `currentMtime !== baseMtime`이면 409 + `SaveConflictResponse` 반환
   - 파일이 없으면 (신규 파일 생성 시도) `apiError(400, 'File does not exist.')` -- 신규 파일 생성은 이 라우트의 역할이 아니다
4. **Atomic write (보안 불변식 4)**:
   - 임시 파일: `path.join(directory, '.mdws-edit-' + randomBytes(12).toString('hex') + '.tmp')`
   - `fs.open(tempPath, 'wx')` -> `writeFile(content, 'utf8')` -> `sync()` -> `close()`
   - `fs.rename(tempPath, absolutePath)`
   - 실패 시 임시 파일 정리 (`fs.rm(tempPath, { force: true }).catch(() => {})`)
5. 저장 후 `fs.stat()` -> 갱신된 mtime -> `SaveFileResponse` 반환
6. TODO(Stage 3): FTS5 색인 증분 갱신 훅 지점

### 에러 코드

| 코드 | 조건 |
|------|------|
| 400 | 경로 검증 실패 / 바디 형식 오류 / 파일 미존재 |
| 401 | (middleware 처리) |
| 409 | baseMtime != 디스크 mtime |
| 500 | fs 쓰기 실패 |

---

## 4. `GET /api/thumbnail`

**파일**: `src/app/api/thumbnail/route.ts`

### 요청

```
GET /api/thumbnail?path=2026-Travel/sunset.jpg&w=400
```

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `path` | string | 예 | MARKDOWN_ROOT 기준 상대 경로 |
| `w` | number | 예 | 리사이즈 폭 (px). 양의 정수, 최대 1200 |

### 응답

- 성공: webp 이미지 바이너리
- `Content-Type: image/webp`
- `Cache-Control: public, max-age=86400, immutable`

### 구현 지침

1. `path`, `w` 필수. `w`는 양의 정수이고 1~1200 범위. 범위 밖이면 400
2. `resolveUnderRoot(path)` -> `assertRealPathUnderRoot()`
3. `isThumbnailable(path)`가 false면 `apiError(400, 'Not a thumbnailable file.')`
   - SVG는 `isThumbnailable()`에서 이미 제외 (file-utils.ts의 `THUMBNAIL_EXTENSIONS`)
4. **디스크 캐시**:
   - 캐시 디렉터리: `path.join(MARKDOWN_ROOT, '.thumbcache')`
   - 캐시 키 생성: `createHash('sha256').update(subpath + ':' + mtime + ':' + w).digest('hex')` + `.webp`
   - `mtime` = 원본 파일의 `Math.round(stat.mtimeMs)` -- 원본이 바뀌면 캐시 미스
   - 캐시 히트: `fs.readFile(cachePath)` -> 응답으로 스트리밍
   - 캐시 미스: 아래 5번
5. **sharp 리사이즈**:
   ```typescript
   const buffer = await sharp(absolutePath)
     .resize(w, null, { fit: 'inside', withoutEnlargement: true })
     .webp({ quality: 80 })
     .toBuffer();
   ```
   - `withoutEnlargement: true` -- 원본보다 크게 확대하지 않는다
   - 캐시 디렉터리 `mkdir({ recursive: true })` -> 캐시 파일에 저장
6. 응답:
   ```typescript
   return new NextResponse(buffer, {
     headers: {
       'Content-Type': 'image/webp',
       'Cache-Control': 'public, max-age=86400, immutable',
     },
   });
   ```
7. **sharp 에러 처리**: 깨진 이미지 등 sharp가 실패하면 `internalError()` -- 사유는 서버 로깅만

### 에러 코드

| 코드 | 조건 |
|------|------|
| 400 | path/w 미지정 / 경로 검증 실패 / 썸네일 불가 파일 / w 범위 초과 |
| 401 | (middleware 처리) |
| 500 | sharp 처리 실패 / fs 읽기 실패 |

---

## 기존 유틸 사용 안내

backend-dev가 새로 만들 필요 없이 import해서 쓸 것:

| 모듈 | 함수/클래스 | 용도 |
|------|-------------|------|
| `@/lib/path-safety` | `resolveUnderRoot`, `assertRealPathUnderRoot`, `toSubpath`, `PathSafetyError` | 모든 경로 처리 |
| `@/lib/api-response` | `apiError`, `internalError` | 에러 응답 |
| `@/lib/env` | `getServerEnv()` | `MARKDOWN_ROOT` 등 env 접근 |
| `@/lib/file-utils` | `classifyEntry`, `isThumbnailable`, `buildThumbnailUrl`, `extractSnippet` | 파일 분류/스니펫 |
| `@/types/api` | 모든 타입 | 요청/응답 타입 |
| `gray-matter` | `matter()` | frontmatter 파싱 |
| `sharp` | default import | 이미지 리사이즈 |

---

## 계약 변경 절차

이 문서의 내용을 변경해야 하는 상황이 생기면:
1. 이 문서를 먼저 갱신한다 (코드보다 문서가 먼저)
2. `tech-lead`에게 승인을 받는다
3. 필요 시 `src/types/api.ts`를 갱신한다 (api.ts 변경은 tech-lead만)
4. frontend-dev에게 변경 사항을 전달한다
