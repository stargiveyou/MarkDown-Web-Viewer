# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**Mac Mini MD Workspace & Direct Local Storage Server** — 맥미니 로컬 디스크(`~/MarkdownDocs`)에 저장된 `.md`/미디어를 ngrok으로 인터넷에 공개된 웹에서 **업로드·조회·편집·검색·공유**하는 Next.js(App Router) 앱.

현재 상태: **Stage 0(스캐폴딩) 완료 / Stage 1 착수 대기**. 기준 문서는 [docs/setting/](docs/setting/) 3종이며, 그중 [PLAN.md](docs/setting/PLAN.md)가 최상위 SOURCE OF TRUTH다. 진행 상황은 [docs/plan/](docs/plan/)에서 확인한다.

## 기준 문서 (읽기 우선순위)

| 문서 | 역할 |
|------|------|
| [docs/setting/PLAN.md](docs/setting/PLAN.md) | **SOURCE OF TRUTH.** 요구사항→기능 매핑, API 명세, 보안 요구사항, 5단계 로드맵 |
| [docs/setting/DECISIONS.md](docs/setting/DECISIONS.md) | ADR-001~010. 확정된 아키텍처 결정 (재논의 금지) |
| [docs/setting/AGENT_PROMPTS.md](docs/setting/AGENT_PROMPTS.md) | 팀 에이전트 역할별 프롬프트 + `[SHARED CONTEXT]` 원문 |

기존 `v4.0` 스펙과 충돌하면 **PLAN v1.0 Final이 이긴다** (v4.0에 없던 인증·보안 레이어를 포함하므로).

## 아키텍처

```
브라우저 → ngrok Edge (TLS + Basic Auth) → Next.js :3000 (Mac Mini 상주 next start)
                                              ├→ ~/MarkdownDocs   (단일 저장소, fs/promises 직접 R/W)
                                              ├→ SQLite FTS5      (trigram 색인, 검색)
                                              └→ Discord/Slack Webhook (공유 + 업로드 알림)
```

핵심은 **저장소 통합**이다(ADR-002). 업로드 저장 대상, GridView가 읽는 대상, 에디터가 쓰는 대상이 전부 같은 로컬 디렉터리이므로 업로드 직후 파일이 그리드에 즉시 나타난다. FTP 계층은 존재하지 않는다(ADR-001/003).

### 기술 스택 (Stage 0에서 버전 확정)
- **Node 22.23.1** (`~/.local/node-v22.23.1-darwin-x64`, PATH 최상단 `~/.local/bin` 경유) — 시스템 v19는 그대로 남아 있다
- Next.js 16.2.11 (App Router, Turbopack) + React 19 + TypeScript
- **Tailwind v4** — v3와 달리 config 파일이 아니라 `src/app/globals.css`에서 `@plugin`으로 플러그인을 등록한다
- Vitest 4 (테스트 러너)
- `@monaco-editor/react` (편집), `react-markdown` + `remark-gfm` + `rehype-highlight` (렌더)
- `fs/promises` (직접 쓰기), `gray-matter` (frontmatter), `sharp` (썸네일), `better-sqlite3` (FTS5)
- `lucide-react` (아이콘)

### 절대 도입 금지 (스코프 드리프트)
- FTP / `basic-ftp` / FTPS — ADR-001, ADR-003
- 카카오톡 SDK — ADR-004
- 토큰 기반 공개 공유 링크 — ADR-004. "Copy Link"는 **인증된 앱 URL 복사**이며 수신자도 로그인해야 한다
- 인증 없는 엔드포인트 — ADR-005
- 검색을 실시간 재귀 `fs` 스캔으로 구현 — ADR-007 (반드시 FTS5 색인)

## API 계약 (Canonical)

프론트와 백엔드는 이 계약에만 의존한다. 요청/응답 타입은 **공유 TypeScript 타입 모듈 한 곳**에서 정의해 드리프트를 막는다.

| 메서드 | 경로 | 비고 |
|--------|------|------|
| POST | `/api/auth/login` | `{ password }` → httpOnly 세션 쿠키. **유일한 무인증 라우트** |
| POST | `/api/auth/logout` | 세션 삭제 |
| GET | `/api/files?path=&sort=&tag=` | 폴더/파일 목록 + 메타 |
| GET | `/api/search?q=` | FTS5 MATCH, `snippet()` 하이라이트, BM25 정렬 |
| GET | `/api/tags` | frontmatter 태그 + 개수 |
| GET | `/api/file-content?path=` | `{ content, mtime }` |
| PUT | `/api/file-content` | `{ path, content, baseMtime }` — mtime 불일치 시 **409** |
| POST | `/api/upload` | multipart → `MARKDOWN_ROOT` 하위 저장 |
| GET | `/api/thumbnail?path=&w=` | sharp 리사이즈 + 디스크 캐시 |
| POST | `/api/share/notify` | `{ target: "discord"\|"slack", filePath }` |

상태코드: `200` / `400` / `401` / `409` conflict / `413` too large / `415` unsupported type / `429` rate limited / `502` webhook 실패.

`fs`·`sharp`·`sqlite`를 쓰는 라우트에는 `export const runtime = "nodejs"`를 반드시 선언한다(Edge 아님).

## 보안 불변식 (협상 불가)

모든 코드에 무조건 적용된다. 하나라도 미충족이면 해당 단계는 완료가 아니다.

1. `/api/auth/login`을 제외한 **모든 페이지·API가 세션 보호**. 401 → `/login` 리다이렉트
2. 모든 `path` 파라미터는 `path.resolve()` 후 `MARKDOWN_ROOT` 하위임을 검증하는 **단일 유틸**을 경유 (files/upload/file-content/thumbnail 전부). `../`, 절대경로, 심볼릭 링크 탈출, 인코딩 우회를 유닛 테스트로 검증
3. 업로드 검증: 크기 상한(413), 확장자 화이트리스트(415), 파일명 새니타이즈
4. **Atomic write**: 업로드·에디터 저장 모두 임시 파일 → `rename`
5. 편집 충돌: `baseMtime` 비교 → 409, UI는 비파괴적 경고(무단 덮어쓰기 금지)
6. `SESSION_SECRET`·Webhook URL은 `.env.local` 전용. 클라이언트 번들에 절대 포함 금지
7. `/api/upload`, `/api/share/notify`에 rate limit
8. 서버 내부 오류·스택트레이스를 클라이언트에 노출 금지 (서버 로깅만)

## 환경변수

`MARKDOWN_ROOT`, `SESSION_PASSWORD`(해시), `SESSION_SECRET`, `UPLOAD_MAX_BYTES`, `ALLOWED_EXTENSIONS`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SEC`, `DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`

저장소 루트는 `MARKDOWN_ROOT`에서만 해석한다 — `path.join(os.homedir(), ...)` 같은 하드코딩 폴백을 두지 않는다.

## 개발 로드맵 (단계 순서 고정)

1. 인증 + 웹 업로드(로컬 저장)
2. GridView + 뷰어 + Monaco 편집 + 썸네일
3. 검색 · 정렬 · 태그 (FTS5)
4. 소셜 공유 (Discord/Slack)
5. 업로드 완료 알림

각 단계는 **인터페이스(타입 + 엔드포인트) 먼저 확정** → 프론트/백엔드 병렬 구현 → 검증 에이전트 통과 순으로 진행한다.

## 디렉터리 규칙

| 경로 | 용도 |
|------|------|
| [src/](src/) | **모든 작업 스크립트·구현 코드**. 코드는 여기서만 작성 |
| [docs/setting/](docs/setting/) | 기준 기획 문서 (수정 시 사용자 승인 필요) |
| [docs/plan/](docs/plan/) | 단계별 진행 목록, 완료 목록, 잔여 목록 |
| [docs/agent-work/](docs/agent-work/) | 에이전트 간 작업 공유 문서 (진행 중 산출물·인터페이스 합의) |
| [docs/valid/](docs/valid/) | 프론트/백엔드 검증 결과 리포트 |
| [docs/complete-work/](docs/complete-work/) | 에이전트가 완료한 작업 기록 |

## 팀 에이전트 운영 규칙

`.claude/agents/`에 정의된 서브에이전트로 작업을 분담한다.

**모델 배정 (고정)**
- 개발 에이전트(`tech-lead`, `frontend-dev`, `backend-dev`, `security-auth`) → **opus**
- 검증·최적화·에러 확인 에이전트(`frontend-validator`, `backend-validator`, `qa-integration`, `optimizer`) → **fable**

**문서 흐름**
```
docs/plan/         작업 계획·잔여 목록 확인
    ↓
docs/agent-work/   작업 중 인터페이스·중간 산출물 공유  (파일명: <agent>-<stage>-<topic>.md)
    ↓
src/               실제 구현
    ↓
docs/valid/        검증 리포트 (파일명: <frontend|backend>-<stage>-validation.md, PASS/FAIL + 재현 절차)
    ↓
docs/complete-work/ 완료 기록 (파일명: <stage>-<agent>-complete.md)
    ↓
docs/plan/         진행/잔여 목록 갱신
```

- 에이전트는 착수 전 `docs/plan/`과 `docs/agent-work/`의 관련 문서를 먼저 읽는다
- 검증 FAIL 항목은 `docs/complete-work/`에 완료로 기록하지 않는다 — `docs/plan/`의 잔여 목록으로 되돌린다
- 프론트/백엔드가 계약을 바꿔야 하면 코드보다 `docs/agent-work/`의 계약 문서를 먼저 갱신하고 `tech-lead`가 승인한다

## 명령어

```bash
npm run dev          # 개발 서버 (localhost:3000)
npm run build        # 프로덕션 빌드
npm start            # 맥미니 상주 실행 (ngrok이 이 포트를 터널링)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest 전체 실행 (1회)
npm run test:watch   # Vitest watch 모드

npx vitest run src/lib/path-safety.test.ts        # 단일 파일
npx vitest run -t "traversal"                     # 이름으로 단일 테스트
```

### 의존성 취약점 — `npm audit fix --force` 절대 금지

`--force`는 **next를 9.3.3으로 다운그레이드**하려 한다. 현재 취약점 3건(sharp/postcss/dompurify)은 전부 next·monaco 내부 transitive이며 상위 수정본이 아직 없다. 직접 의존성은 모두 최신이다. 상세와 완화책은 [backlog.md](docs/plan/backlog.md) P1-11/12 참조.

### 알려진 lint 경고

`src/lib/*` 스텁의 미사용 파라미터 경고 12건은 **의도된 미구현 표식**이다. Stage 1에서 구현하면 사라진다. 새 경고가 이 노이즈에 묻히지 않도록 구현 즉시 해소할 것.
