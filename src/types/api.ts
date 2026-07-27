/**
 * Canonical API 계약 — 프론트엔드와 백엔드의 **유일한** 타입 정의처.
 *
 * 규칙:
 * - 프론트/백엔드는 요청·응답 타입을 로컬에서 중복 정의하지 않고 이 모듈에서 import한다.
 * - 계약 변경은 코드보다 `docs/agent-work/contract-stage-<N>.md`를 먼저 갱신하고
 *   tech-lead 승인을 받은 뒤 이 파일에 반영한다.
 *
 * 근거: CLAUDE.md "API 계약(Canonical)" / docs/setting/AGENT_PROMPTS.md [SHARED CONTEXT]
 */

// ---------------------------------------------------------------------------
// 공통
// ---------------------------------------------------------------------------

/** 파일 목록 정렬 키. 기본값은 `mtime`(수정일 내림차순). */
export type SortKey = 'mtime' | 'name' | 'size' | 'ctime';

/** 공유 대상 채널. 카카오는 채택하지 않음 (ADR-004). */
export type ShareTarget = 'discord' | 'slack';

/** GridView 카드 종류. */
export type EntryType = 'folder' | 'markdown' | 'image' | 'other';

/**
 * 에러 응답 바디. 서버 내부 정보(스택트레이스·절대경로)를 절대 담지 않는다.
 * 보안 불변식 8.
 */
export interface ApiError {
  /** HTTP 상태 코드와 동일한 값. */
  code: ApiErrorCode;
  /** 사용자에게 노출 가능한 메시지. */
  message: string;
}

/**
 * 계약상 사용하는 상태 코드 전체 집합. 이 외의 코드는 반환하지 않는다.
 *
 * 500과 502를 구분하는 이유: 사용자가 취해야 할 행동이 다르다.
 * 502(webhook 실패)는 재시도가 의미 있지만, 500(서버 내부)은 관리자 확인이 필요하다.
 */
export type ApiErrorCode =
  | 400 // bad request — 경로 검증 실패 포함
  | 401 // unauthenticated — 프론트는 /login 리다이렉트
  | 409 // conflict — baseMtime 불일치
  | 413 // payload too large — UPLOAD_MAX_BYTES 초과
  | 415 // unsupported media type — ALLOWED_EXTENSIONS 위반
  | 429 // rate limited
  | 500 // internal server error — 디스크 쓰기 실패 등. 원인은 서버에만 로깅한다
  | 502; // upstream(webhook) 실패

// ---------------------------------------------------------------------------
// 인증 — POST /api/auth/login, POST /api/auth/logout
// ---------------------------------------------------------------------------

export interface LoginRequest {
  password: string;
}

export interface LoginResponse {
  ok: true;
}

// ---------------------------------------------------------------------------
// 파일 목록 — GET /api/files?path=&sort=&tag=
// ---------------------------------------------------------------------------

export interface FilesQuery {
  /** MARKDOWN_ROOT 기준 상대 경로. 미지정 시 루트. */
  path?: string;
  sort?: SortKey;
  /** frontmatter 태그 필터. */
  tag?: string;
}

export interface FileEntry {
  name: string;
  type: EntryType;
  /** 폴더면 0. */
  size: number;
  /** epoch milliseconds. `baseMtime` 비교의 기준값이기도 하다. */
  mtime: number;
  /** MARKDOWN_ROOT 기준 상대 경로. 절대 경로를 노출하지 않는다. */
  subpath: string;
  /** 폴더 카드에 표시할 하위 파일 수. type === 'folder'일 때만. */
  fileCount?: number;
  /** 카드 이미지. 항상 /api/thumbnail URL이며 원본 경로가 아니다. */
  coverThumbUrl?: string;
  /** 마크다운 카드의 2줄 미리보기. */
  snippet?: string;
  /** frontmatter에서 추출한 태그. */
  tags?: string[];
  /** frontmatter title. 없으면 프론트가 name으로 대체. */
  title?: string;
  /** 폴더 카드에 표시할 최근 수정 파일 요약 (최대 3개). type === 'folder'일 때만. */
  recentFiles?: { name: string; snippet?: string }[];
}

export interface FilesResponse {
  /** 현재 위치의 breadcrumb 세그먼트. 예: ['2026-Travel', 'Jeju'] */
  breadcrumb: string[];
  entries: FileEntry[];
}

// ---------------------------------------------------------------------------
// 파일 내용 — GET/PUT /api/file-content
// ---------------------------------------------------------------------------

export interface FileContentResponse {
  content: string;
  /** 저장 시 baseMtime으로 되돌려 보내야 하는 값. */
  mtime: number;
}

export interface SaveFileRequest {
  path: string;
  content: string;
  /** 읽어올 때 받은 mtime. 디스크의 현재 mtime과 다르면 409. */
  baseMtime: number;
}

export interface SaveFileResponse {
  ok: true;
  /** 저장 후 갱신된 mtime. 클라이언트는 이 값으로 baseMtime을 교체한다. */
  mtime: number;
}

/** 409 응답 바디. 프론트는 이 정보로 비파괴적 경고를 띄운다. */
export interface SaveConflictResponse extends ApiError {
  code: 409;
  /** 디스크의 현재 mtime. */
  currentMtime: number;
}

// ---------------------------------------------------------------------------
// 업로드 — POST /api/upload (multipart/form-data)
// ---------------------------------------------------------------------------

/**
 * FormData 필드명. 문자열 리터럴이 프론트·백엔드에서 어긋나지 않도록 상수로 고정한다.
 */
export const UPLOAD_FIELD = {
  file: 'file',
  /** 저장할 대상 폴더 (MARKDOWN_ROOT 기준 상대 경로). */
  targetPath: 'targetPath',
} as const;

export interface UploadedFileInfo {
  name: string;
  subpath: string;
  size: number;
  mtime: number;
}

export interface UploadResponse {
  ok: true;
  files: UploadedFileInfo[];
  /** 업로드 완료 Webhook 발화 여부 (실패해도 업로드 자체는 성공). */
  notified: boolean;
}

// ---------------------------------------------------------------------------
// 썸네일 — GET /api/thumbnail?path=&w=
// ---------------------------------------------------------------------------

export interface ThumbnailQuery {
  path: string;
  /** 렌더 폭(px). 디스크 캐시 키의 일부. */
  w: number;
}

// ---------------------------------------------------------------------------
// 검색 — GET /api/search?q=
// ---------------------------------------------------------------------------

export interface SearchResult {
  subpath: string;
  title: string;
  /**
   * FTS5 snippet() 결과. 매치 구간이 마크로 감싸여 있으므로
   * 프론트는 이 마커를 파싱해 하이라이트한다(원문 HTML 삽입 금지).
   */
  snippet: string;
  /** BM25 관련도 점수. 낮을수록 관련도가 높다. */
  score: number;
  mtime: number;
  tags?: string[];
  coverThumbUrl?: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  /** 색인이 아직 구축 중이면 true — 프론트는 안내를 띄운다. */
  indexing?: boolean;
}

/** snippet() 하이라이트 마커. 백엔드와 프론트가 동일 값을 써야 한다. */
export const SNIPPET_MARK = { open: '[[hl]]', close: '[[/hl]]' } as const;

// ---------------------------------------------------------------------------
// 태그 — GET /api/tags
// ---------------------------------------------------------------------------

export interface TagCount {
  tag: string;
  count: number;
}

export interface TagsResponse {
  tags: TagCount[];
}

// ---------------------------------------------------------------------------
// 파일 버전 — GET /api/file-versions?path=
// ---------------------------------------------------------------------------

export interface FileVersion {
  /** 파일명 (예: report_20260727-143022.md) */
  name: string;
  /** MARKDOWN_ROOT 기준 상대 경로 */
  subpath: string;
  size: number;
  /** epoch milliseconds */
  mtime: number;
}

export interface FileVersionsResponse {
  /** 현재(최신) 파일 */
  current: FileVersion;
  /** 이전 버전 목록 (최신순) */
  versions: FileVersion[];
}

// ---------------------------------------------------------------------------
// 공유·알림 — POST /api/share/notify
// ---------------------------------------------------------------------------

export interface ShareNotifyRequest {
  target: ShareTarget;
  /** MARKDOWN_ROOT 기준 상대 경로. */
  filePath: string;
}

/**
 * 공유 응답. Webhook URL은 서버 전용이므로 어떤 필드에도 포함되지 않는다.
 * 보안 불변식 6.
 */
export interface ShareNotifyResponse {
  ok: true;
  target: ShareTarget;
}
