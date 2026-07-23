# API 계약 — Stage 0 (기준선)

- 작성: `tech-lead` / 2026-07-22
- 상태: **확정** (구현체: [src/types/api.ts](../../src/types/api.ts))
- 근거: [CLAUDE.md](../../CLAUDE.md) "API 계약(Canonical)" · [AGENT_PROMPTS.md](../setting/AGENT_PROMPTS.md) `[SHARED CONTEXT]`

> 이 문서와 `src/types/api.ts`가 프론트·백엔드의 **유일한 계약**이다.
> 변경이 필요하면 코드보다 이 문서를 먼저 고치고 `tech-lead` 승인을 받는다.

---

## 1. 엔드포인트 ↔ 타입 매핑

| 메서드 | 경로 | 요청 타입 | 응답 타입 | 인증 |
|--------|------|-----------|-----------|------|
| POST | `/api/auth/login` | `LoginRequest` | `LoginResponse` | **없음(유일)** |
| POST | `/api/auth/logout` | — | `{ ok: true }` | 세션 |
| GET | `/api/files` | `FilesQuery` | `FilesResponse` | 세션 |
| GET | `/api/file-content` | `?path=` | `FileContentResponse` | 세션 |
| PUT | `/api/file-content` | `SaveFileRequest` | `SaveFileResponse` / 409 `SaveConflictResponse` | 세션 |
| POST | `/api/upload` | `FormData` (`UPLOAD_FIELD`) | `UploadResponse` | 세션 |
| GET | `/api/thumbnail` | `ThumbnailQuery` | 이미지 바이트 | 세션 |
| GET | `/api/search` | `?q=` | `SearchResponse` | 세션 |
| GET | `/api/tags` | — | `TagsResponse` | 세션 |
| POST | `/api/share/notify` | `ShareNotifyRequest` | `ShareNotifyResponse` | 세션 |

에러 응답은 전부 `ApiError` 형태이며 상태 코드는 `ApiErrorCode` 집합(400/401/409/413/415/429/502)으로 제한된다.

## 2. 계약에 못 박은 3가지 (드리프트 방지 장치)

| 항목 | 이유 |
|------|------|
| `UPLOAD_FIELD` 상수 | multipart 필드명이 문자열 리터럴로 양쪽에 흩어지면 조용히 어긋난다. 프론트는 `UPLOAD_FIELD.file`로 append, 백엔드는 같은 상수로 조회한다. |
| `SNIPPET_MARK` 상수 | FTS5 `snippet()`의 하이라이트 마커. 백엔드가 이 마커로 감싸고 프론트가 같은 값으로 파싱한다. **원문 HTML을 그대로 삽입하지 않는다**(XSS 차단). |
| `mtime` = epoch ms (number) | `Date` 객체나 ISO 문자열은 JSON 직렬화에서 어긋난다. 숫자로 고정하고, `FileContentResponse.mtime` → `SaveFileRequest.baseMtime`으로 그대로 왕복시킨다. |

## 3. 경로 표기 규칙

- 모든 경로 필드(`subpath`, `path`, `filePath`, `targetPath`)는 **`MARKDOWN_ROOT` 기준 상대 경로**다.
- 절대 경로를 응답에 포함하지 않는다 — 서버 파일시스템 구조 노출 방지(보안 불변식 8).
- 백엔드는 수신한 모든 경로를 경로 안전 유틸에 통과시킨다(보안 불변식 2). 위반 시 400.

## 4. 프론트가 지켜야 할 계약

- 카드 이미지는 `FileEntry.coverThumbUrl`(= `/api/thumbnail` URL)만 사용. 원본 경로로 이미지를 로드하지 않는다.
- 401 수신 → `/login` 리다이렉트. 429 → rate limited 토스트. 전역 fetch 래퍼 경유가 강제된다.
- 409 수신 → `SaveConflictResponse.currentMtime`으로 비파괴적 경고 표시. 조용한 덮어쓰기 금지.

## 5. 백엔드가 지켜야 할 계약

- `POST /api/auth/login`을 제외한 모든 핸들러에서 세션 검증 → 실패 시 401.
- `fs`/`sharp`/`sqlite` 사용 라우트에 `export const runtime = "nodejs"` 선언.
- `UploadResponse.notified`는 Webhook 실패와 업로드 성공을 분리하기 위한 필드다. Webhook이 실패해도 업로드는 200이며 `notified: false`로 알린다.

## 6. 미결 항목

| # | 항목 | 처리 |
|---|------|------|
| 1 | 다중 파일 업로드 시 부분 실패 표현 | `UploadResponse.files`에 성공분만 담는 현행 안으로 Stage 1 착수. 부분 실패 UX가 필요해지면 재논의 |
| 2 | `SearchResponse.indexing` 사용 여부 | 초기 색인 구축이 체감될 만큼 느린지 Stage 3에서 측정 후 확정 |
