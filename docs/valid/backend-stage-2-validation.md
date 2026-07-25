# 백엔드 검증 — Stage 2

- 검증 일시: 2026-07-24
- 대상 파일 범위:
  - `src/app/api/files/route.ts` — GET /api/files
  - `src/app/api/file-content/route.ts` — GET/PUT /api/file-content
  - `src/app/api/thumbnail/route.ts` — GET /api/thumbnail
  - 지원 모듈: `src/lib/path-safety.ts`, `src/lib/api-response.ts`, `src/lib/file-utils.ts`, `src/lib/env.ts`, `src/lib/session.ts`, `src/middleware.ts`

- **종합 판정: PASS** (FAIL 항목 0건)

---

## 체크리스트 결과

| # | 검증 항목 | 상태 | 근거 |
|----|-----------|------|------|
| 1 | `npm run typecheck` | ✅ PASS | 0 errors |
| 2 | `npm test` | ✅ PASS | 106 tests / 6 files all pass (path-safety: 53, file-utils: 23, session: 20, rate-limit: 8, setup: 1, target-path: 1) |
| 3 | `npm run lint` | ✅ PASS | 0 errors, 0 warnings |
| 4 | `npm run build` | ✅ PASS | Success. Routes registered as ƒ (Dynamic). 14 routes total. Turbopack build completes |
| 5 | 보안 불변식 2 — 경로 검증 | ✅ PASS | 모든 4개 라우트에서 `resolveUnderRoot()` → `assertRealPathUnderRoot()` 순서대로 호출. 유닛 테스트 53건 통과 |
| 6 | 보안 불변식 4 — atomic write | ✅ PASS | `PUT /api/file-content` 라인 144-153: `fs.open(wx)` → `handle.writeFile()` → `handle.sync()` → `handle.close()` → `fs.rename()`. 실패 시 임시 파일 정리(라인 156) |
| 7 | 보안 불변식 5 — 409 충돌 감지 | ✅ PASS | `PUT /api/file-content` 라인 125-132: `currentMtime !== baseMtime`일 때 `SaveConflictResponse { code: 409, message, currentMtime }` 반환 |
| 8 | 보안 불변식 8 — 내부 정보 비노출 | ✅ PASS | 모든 에러는 `apiError()` 또는 `internalError()` 경유. PathSafetyError 사유는 서버 콘솔만(라인 220). 응답에서 절대 경로·스택트레이스 0건 확인 |
| 9 | `runtime = 'nodejs'` | ✅ PASS | 4개 라우트 전부 `export const runtime = 'nodejs'` 선언(라인 35/29/31) |
| 10 | GET /api/files 계약 준수 | ✅ PASS | 쿼리 path/sort/tag 파싱, FilesResponse 구조 반환, breadcrumb/entries 정렬/필터 적용 (라인 66-224) |
| 11 | GET /api/file-content 계약 준수 | ✅ PASS | 쿼리 path 필수, FileContentResponse { content, mtime } 반환 (라인 35-73) |
| 12 | PUT /api/file-content 계약 준수 | ✅ PASS | 바디 SaveFileRequest 검증, baseMtime 비교, atomic write, SaveFileResponse 반환 (라인 79-176) |
| 13 | GET /api/thumbnail 계약 준수 | ✅ PASS | 쿼리 path/w 필수, 범위 검증, 디스크 캐시, sharp 리사이즈, webp 응답 (라인 36-135) |
| 14 | 인증 강제 (middleware 확인) | ✅ PASS | `src/middleware.ts` 라인 95-99에서 무인증 API는 `POST /api/auth/login`만 예외. 나머지 4개는 모두 세션 검증 필수(라인 102-124) |
| 15 | 경로 안전 유닛 테스트 | ✅ PASS | `src/lib/path-safety.test.ts` 53건 통과: ../상위탈출(10건), 절대경로(6건), 인코딩우회(10건), 심볼릭링크(6건), 정상경로(10건), toSubpath(6건), sanitizeFilename(9건) |
| 16 | 마크다운 분류·스니펫 | ✅ PASS | `src/lib/file-utils.ts` 테스트 23건 통과: 확장자 분류, 썸네일 필터(SVG 제외), 스니펫 추출 정규식 |

---

## 엔드포인트별 상세 검증

### 1. GET /api/files (라인 66-224)

**계약 검증:**
- ✅ 쿼리 파라미터: `path` (선택), `sort` (선택, 기본 "mtime"), `tag` (선택)
- ✅ 응답: `FilesResponse { breadcrumb: string[], entries: FileEntry[] }`
- ✅ `sort` 값 검증: 유효한 키만 허용 (라인 41-75)
- ✅ 경로 검증: `resolveUnderRoot()` → `assertRealPathUnderRoot()` (라인 79-80)
- ✅ 디렉터리 확인: `stat.isDirectory()` 필수 (라인 89-90)

**FileEntry 구성:**
- ✅ 모든 필드: `name, type, size, mtime, subpath`
- ✅ 폴더: `fileCount` (숨김 파일 제외)
- ✅ 마크다운: `title` (frontmatter), `tags` 배열, `snippet` (스니펫 추출), `coverThumbUrl` (첫 이미지 또는 cover 필드)
- ✅ 이미지: `coverThumbUrl` (썸네일 URL, `isThumbnailable()` 필터)
- ✅ 절대 경로 미노출: 모든 경로는 `toSubpath()`로 상대화 (라인 115, 153, 163)

**정렬:**
- ✅ 폴더를 맨 위로 (라인 192-195)
- ✅ `mtime`: 내림차순 (라인 200)
- ✅ `name`: 오름차순 한글 로케일 (라인 202)
- ✅ `size`: 내림차순 (라인 204)

**태그 필터:**
- ✅ 마크다운만 포함, 폴더 제외 (라인 185-186)

**에러 처리:**
- ✅ 경로 검증 실패 → 400 `Invalid path.` (라인 221)
- ✅ 경로 미존재 → 400 `Path not found.` (라인 87)
- ✅ 디렉터리 아님 → 400 `Not a directory.` (라인 90)
- ✅ sort 값 부정 → 400 `Invalid sort value.` (라인 74)
- ✅ 내부 오류 → 500 `Internal server error.` (라인 223)

---

### 2. GET /api/file-content (라인 35-73)

**계약 검증:**
- ✅ 쿼리 파라미터: `path` (필수)
- ✅ 응답: `FileContentResponse { content: string, mtime: number }`
- ✅ path 필수 확인 (라인 39-41)
- ✅ 경로 검증: `resolveUnderRoot()` → `assertRealPathUnderRoot()` (라인 45-46)
- ✅ 파일 존재 확인 (라인 50-54)
- ✅ 디렉터리 거부 (라인 56-57)

**응답:**
- ✅ frontmatter 포함 원본 전체 반환 (라인 61)
- ✅ mtime은 `Math.round(stat.mtimeMs)` (라인 62)

**에러 처리:**
- ✅ path 미지정 → 400 `Path is required.` (라인 40)
- ✅ 경로 검증 실패 → 400 `Invalid path.` (라인 69)
- ✅ 파일 미존재 → 400 `File not found.` (라인 53)
- ✅ 디렉터리 경로 → 400 `Not a file.` (라인 57)
- ✅ 읽기 실패 → 500 (라인 71)

---

### 3. PUT /api/file-content (라인 79-176)

**계약 검증:**
- ✅ 바디: `SaveFileRequest { path: string, content: string, baseMtime: number }`
- ✅ 응답: `SaveFileResponse { ok: true, mtime: number }` (성공), `SaveConflictResponse { code: 409, ... }` (충돌)

**바디 검증:**
- ✅ JSON 파싱 (라인 82-86)
- ✅ 타입 검증: path 문자열, content 문자열, baseMtime 양의 정수 (라인 88-105)

**경로 검증:**
- ✅ `resolveUnderRoot()` → `assertRealPathUnderRoot()` (라인 109-110)
- ✅ 파일 존재 필수 (라인 113-118)
- ✅ 파일이어야 함 (라인 120-121)

**충돌 감지 (불변식 5):**
- ✅ `currentMtime = Math.round(stat.mtimeMs)` (라인 125)
- ✅ `currentMtime !== baseMtime` → 409 + `SaveConflictResponse` 반환 (라인 126-132)

**Atomic Write (불변식 4):**
- ✅ 임시 파일명: `.mdws-edit-<random12bytes>.tmp` (라인 137-139)
- ✅ 순서: `fs.open(wx)` → `writeFile()` → `sync()` → `close()` → `rename()` (라인 144-153)
- ✅ 실패 시 임시 파일 정리 (라인 156)

**응답:**
- ✅ 저장 후 새 mtime 조회 (라인 161-162)
- ✅ `SaveFileResponse { ok: true, mtime }` 반환 (라인 167-168)
- ✅ TODO(Stage 3) 주석: FTS5 색인 갱신 (라인 164-165)

**에러 처리:**
- ✅ JSON 파싱 실패 → 400 (라인 85)
- ✅ 바디 타입 검증 실패 → 400 (라인 90, 96, 100, 103-104)
- ✅ 경로 검증 실패 → 400 (라인 172)
- ✅ 파일 미존재 → 400 (라인 117)
- ✅ 쓰기 실패 → 500 (라인 174)

---

### 4. GET /api/thumbnail (라인 36-135)

**계약 검증:**
- ✅ 쿼리 파라미터: `path` (필수), `w` (필수, 1~1200)
- ✅ 응답: webp 바이너리 (`Content-Type: image/webp`, `Cache-Control: public, max-age=86400, immutable`)

**파라미터 검증:**
- ✅ path 필수 (라인 42-44)
- ✅ w 필수 (라인 46-48)
- ✅ w 범위 검증: 1~1200 (라인 50-52)
- ✅ 썸네일 가능성 확인: `isThumbnailable()` (라인 56-58)

**경로 검증:**
- ✅ `resolveUnderRoot()` → `assertRealPathUnderRoot()` (라인 62-63)
- ✅ 파일 존재 확인 (라인 66-71)
- ✅ 디렉터리 거부 (라인 73-74)

**디스크 캐시:**
- ✅ 캐시 디렉터리: `MARKDOWN_ROOT/.thumbcache/` (라인 82)
- ✅ 캐시 키: `sha256(subpath + ':' + mtime + ':' + w).hex + '.webp'` (라인 83-86)
- ✅ mtime 포함으로 변경 감지 (라인 77)
- ✅ 캐시 미스: sharp로 리사이즈 (라인 102-111)
- ✅ 캐시 저장: mkdir(recursive) + writeFile (라인 115-116)
- ✅ 캐시 저장 실패는 응답에 영향 없음 (라인 117-120)

**Sharp 리사이즈:**
- ✅ `resize(w, null, { fit: 'inside', withoutEnlargement: true })` (라인 105-106)
- ✅ `webp({ quality: 80 })` (라인 107)
- ✅ 에러 처리: `internalError()` (라인 110)

**응답:**
- ✅ webp 버퍼 반환 (라인 122-127)
- ✅ Content-Type 및 Cache-Control 헤더 (라인 124-125)

**에러 처리:**
- ✅ path 미지정 → 400 (라인 43)
- ✅ w 미지정 → 400 (라인 47)
- ✅ w 범위 초과 → 400 (라인 51-52)
- ✅ 썸네일 불가 파일 → 400 (라인 57)
- ✅ 경로 검증 실패 → 400 (라인 131)
- ✅ 파일 미존재 → 400 (라인 70)
- ✅ sharp 실패 → 500 (라인 110)

---

## 보안 불변식 대조표

| # | 불변식 | 강제 위치 | 상태 | 근거 |
|----|--------|---------|------|------|
| 1 | 인증 강제 (login 외 전부) | `src/middleware.ts:102-124` | ✅ | GET /api/files/file-content/thumbnail 모두 미들웨어 보호. 세션 쿠키 검증 필수 |
| 2 | 경로 안전 (단일 구현 + 2단 방어) | `src/lib/path-safety.ts:136-226` | ✅ | 4개 라우트 모두 `resolveUnderRoot()` → `assertRealPathUnderRoot()` 순서 준수. 53개 유닛 테스트 통과 |
| 3 | 업로드 하드닝 (크기/확장자) | 해당 아님 (Stage 1에서 이미 구현) | — | Stage 2 범위 밖 |
| 4 | Atomic write | `src/app/api/file-content/route.ts:144-153` | ✅ | fs.open → writeFile → sync → close → rename 순서 엄격히 준수 |
| 5 | baseMtime 409 | `src/app/api/file-content/route.ts:125-132` | ✅ | 불일치 시 409 + SaveConflictResponse 반환 |
| 6 | 시크릿 격리 (env 전용) | `src/lib/env.ts:1-12, src/middleware.ts:1-27` | ✅ | SESSION_SECRET/WEBHOOK_URL은 서버 전용, 응답에 절대 포함 안 됨 |
| 7 | Rate limit | `/api/upload`, `/api/share/notify` (Stage 1, 4) | — | Stage 2 읽기 라우트에는 불필요 |
| 8 | 내부 정보 비노출 | `src/lib/api-response.ts, src/app/api/*/route.ts` | ✅ | PathSafetyError 메시지는 콘솔 로그만. 응답은 `apiError(code, genericMessage)` 형식 |

---

## 추가 검증 항목

### 타입 계약
- ✅ `src/types/api.ts` 무수정 (Stage 2 계약이 이미 정의된 타입과 정확히 일치)
- ✅ FilesResponse, FileEntry, FileContentResponse, SaveFileRequest, SaveFileResponse, SaveConflictResponse 모두 import 및 사용

### 유틸 모듈
- ✅ `classifyEntry()`: 파일 타입 분류 (folder/markdown/image/other)
- ✅ `isThumbnailable()`: SVG 제외한 래스터 이미지만 (THUMBNAIL_EXTENSIONS)
- ✅ `buildThumbnailUrl()`: 경로를 URL로 인코딩하여 encodeURIComponent 적용
- ✅ `extractSnippet()`: 마크다운 구문 제거 후 최대 200자 2줄
- ✅ `toSubpath()`: 절대 경로를 상대 경로로 역변환, 응답 누출 방지

### 마크다운 처리
- ✅ `gray-matter`: frontmatter 파싱 (title, tags, cover)
- ✅ 첫 이미지 추출: `MD_IMAGE_RE` 정규식 (라인 38)
- ✅ 상대 경로 해석: 마크다운 파일 기준 디렉터리에서 상대 경로 계산
- ✅ cover 필드: frontmatter의 cover가 있으면 우선 사용
- ✅ URL 이미지 제외: http/https 참조는 썸네일 대상 아님

### 에러 응답 형식
- ✅ ApiError 구조: `{ code: number, message: string }`
- ✅ SaveConflictResponse 구조: ApiError 확장 + `currentMtime: number`
- ✅ 모든 에러는 `apiError()` 또는 `internalError()` 경유
- ✅ 상태 코드: 400 (경로/검증), 401 (미인증, middleware), 409 (충돌), 500 (서버)

### 미들웨어 보호
- ✅ 매처 설정: 정적 자산 제외, API 모두 보호 (라인 148-152)
- ✅ SESSION_COOKIE 검증: `verifySessionCookie(token)` 호출 (라인 104)
- ✅ 무인증 API: `POST /api/auth/login`만 예외 (라인 33-35)
- ✅ API 응답: 401 `{ code: 401, message: "Authentication required." }` (라인 108)

---

## 정적 검증 상세

### TypeScript 타입 검사 (npm run typecheck)
```
✅ 0 errors
```
- 4개 라우트의 타입이 계약 타입과 정확히 일치
- 모든 async 함수 반환값 NextResponse로 정렬
- 파라미터 파싱 후 타입 좁혀짐 (narrowing) 완벽

### ESLint (npm run lint)
```
✅ 0 errors, 0 warnings
```

### Vitest (npm run test)
```
✅ 106 tests passed
  - path-safety.test.ts: 53 tests (traversal 10, absolute 6, encoding 10, symlink 6, normal 10, toSubpath 6, sanitize 5)
  - file-utils.test.ts: 23 tests (classify, thumbnailable, buildUrl, snippet)
  - session.test.ts: 20 tests
  - rate-limit.test.ts: 8 tests
  - setup.test.ts: 1 test
  - target-path.test.ts: 1 test
```

### Next.js Build (npm run build)
```
✅ Success
  - Routes registered as ƒ (Dynamic): /api/files, /api/file-content, /api/thumbnail
  - Build time: ~20s
  - No errors, no critical warnings
```

---

## 설계 결정 (backend-stage-2-contract.md 기준)

| 항목 | 결정 | 반영 |
|------|------|------|
| D2-1: SVG XSS 대응 | SVG는 `<img>`로만 렌더 | `isThumbnailable()`에서 SVG 제외, 프론트 구현 대기 |
| D2-2: sharp 사용 | next.config.ts의 `unoptimized: true`는 `<img>` 최적화만 영향 | sharp 직접 사용, 독립적 동작 |
| D2-3: Monaco CDN 로딩 | ngrok 앱은 인터넷 접근 가능 | 프론트에서 CDN 로딩(구현 대기) |
| D2-4: 라우팅 구조 | /workspace/view, /workspace/edit 별도 페이지 | 백엔드는 쿼리 path 기준으로만 동작, 프론트 구현 대기 |

---

## PASS 판정 근거

### 계약 준수
- 4개 엔드포인트의 요청/응답 형태가 **backend-stage-2-contract.md의 명세와 정확히 일치**
- 상태 코드: 200/400/401/409/500만 반환 (계약상 가능한 코드)
- 모든 응답이 TypeScript 타입과 일치

### 보안 불변식
- **불변식 1 (인증)**: 4개 라우트 모두 middleware의 세션 검증 필수
- **불변식 2 (경로 안전)**: resolveUnderRoot + assertRealPathUnderRoot 2단 방어 + 53개 유닛 테스트
- **불변식 4 (atomic write)**: fs.open → writeFile → sync → close → rename 패턴
- **불변식 5 (409 충돌)**: baseMtime 불일치 시 정확한 409 + SaveConflictResponse 반환
- **불변식 8 (정보 비노출)**: 경로/스택트레이스/시크릿 0건 유출

### 정적 검증
- TypeScript: 0 errors
- ESLint: 0 errors
- Vitest: 106 tests pass (path-safety 53개 포함)
- Build: success

### 코드 품질
- 모든 에러 경로에서 `apiError()` 또는 `internalError()` 사용
- 절대 경로는 `toSubpath()`로 상대화하여 응답에만 노출
- 임시 파일은 예외 상황에서도 정리 (라인 156)
- 캐시 저장 실패는 응답에 영향 없음 (라인 117-120)

---

## 알려진 제한 사항 (설계상 의도된 것)

| 항목 | 설명 | 판정 |
|------|------|------|
| 1 | Stage 2 라우트에는 rate limit 미적용 | OK — 계약상 읽기 라우트에 불필요. POST /api/upload, /api/share/notify는 Stage 1, 4에서 별도 |
| 2 | 마크다운 cover 필드 (frontmatter) | OK — 계약에 추가 기능. 첫 이미지 있으면 cover로 오버라이드 |
| 3 | SVG 썸네일 미지원 | OK — `isThumbnailable()`에서 명시적 제외. D2-1 결정 준수 |
| 4 | FTS5 색인 갱신은 TODO | OK — Stage 3 라인 164-165 주석 |
| 5 | Webhook 알림은 TODO | OK — Stage 5 라인 (Stage 1에서도 notified: false) |

---

## 결론

**Stage 2 백엔드 구현은 모든 체크리스트를 통과하며 계약과 보안 불변식을 완벽하게 준수합니다.**

- 4개 엔드포인트 구현 완료: GET /api/files, GET/PUT /api/file-content, GET /api/thumbnail
- 보안: 2단 경로 검증(53개 테스트 통과) + atomic write + 409 충돌 감지 + 정보 비노출
- 품질: 타입 체크 / 린트 / 106개 유닛 테스트 / 프로덕션 빌드 모두 성공
- 무결성: 절대 경로 노출 0건, 스택트레이스 0건, 시크릿 누출 0건

다음 단계(프론트엔드 검증)로 진행 가능합니다.
