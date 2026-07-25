# MarkDown Web Viewer

Mac Mini 로컬 디스크에 저장된 마크다운 파일과 미디어를 웹에서 업로드, 조회, 편집, 검색, 공유할 수 있는 워크스페이스 앱.

## Tech Stack

- **Runtime**: Node.js 22 + Next.js 16 (App Router, Turbopack)
- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Monaco Editor, lucide-react
- **Backend**: fs/promises (직접 R/W), SQLite FTS5 (trigram 검색), sharp (썸네일)
- **Security**: scrypt 패스워드 해싱, HMAC 세션 쿠키, 경로 탈출 차단, rate limiting

## Features

| 기능 | 설명 |
|------|------|
| **인증** | 단일 패스워드 로그인 (scrypt 해시 + httpOnly 세션) |
| **파일 탐색** | 폴더/파일 GridView + 브레드크럼 네비게이션 |
| **마크다운 뷰어** | react-markdown + GFM + 코드 하이라이팅 |
| **에디터** | Monaco 분할 뷰 (실시간 미리보기) + mtime 기반 409 충돌 감지 |
| **업로드** | 드래그앤드롭 + 진행률 표시, 확장자/크기 검증 |
| **검색** | FTS5 trigram 색인 (한글 부분일치, BM25 정렬) |
| **태그/정렬** | frontmatter 태그 필터링 + 이름/날짜/크기 정렬 |
| **다운로드** | 개별 파일 + 폴더 ZIP 스트리밍 다운로드 |
| **썸네일** | sharp WebP 변환 + 디스크 캐시 |
| **공유** | Discord / Slack 웹훅 알림 |

## Architecture

```
Browser --> ngrok Edge (TLS) --> Next.js :3000 (Mac Mini)
                                   ├── ~/MarkdownDocs    (단일 저장소, fs 직접 R/W)
                                   ├── SQLite FTS5       (trigram 검색 색인)
                                   ├── .thumbcache/      (썸네일 캐시)
                                   └── Discord/Slack     (Webhook API)
```

## Getting Started

### Prerequisites

- Node.js 20.9.0+
- macOS (Mac Mini 상주 권장)

### Installation

```bash
git clone https://github.com/stargiveyou/MarkDown-Web-Viewer.git
cd MarkDown-Web-Viewer
npm install
```

### Configuration

```bash
cp .env.local.example .env.local
```

`.env.local`을 편집하여 필수 환경변수를 설정합니다:

| 변수 | 필수 | 설명 |
|------|:----:|------|
| `MARKDOWN_ROOT` | Y | 마크다운 저장 디렉터리 절대경로 |
| `SESSION_PASSWORD` | Y | scrypt 해시 (아래 명령으로 생성) |
| `SESSION_SECRET` | Y | 세션 서명 키 (32바이트 hex) |
| `UPLOAD_MAX_BYTES` | Y | 업로드 크기 상한 (기본 20MB) |
| `ALLOWED_EXTENSIONS` | Y | 허용 확장자 (쉼표 구분) |
| `RATE_LIMIT_MAX` | Y | 분당 최대 요청 수 |
| `RATE_LIMIT_WINDOW_SEC` | Y | Rate limit 윈도우 (초) |
| `DISCORD_WEBHOOK_URL` | N | Discord 알림 webhook URL |
| `SLACK_WEBHOOK_URL` | N | Slack 알림 webhook URL |

### Password Setup

```bash
# 대화형 입력
npm run hash-password

# 또는 인자로 전달
npm run hash-password -- 'your-password-here'

# 출력된 scrypt:... 값을 .env.local의 SESSION_PASSWORD에 설정
```

### Run

```bash
# 개발 서버
npm run dev

# LAN 접속 허용
npm run dev -- -H 0.0.0.0

# 프로덕션
npm run build && npm start
```

### Verify

```bash
npm run typecheck    # TypeScript 타입 체크
npm run lint         # ESLint
npm test             # Vitest (160 tests)
```

### Search Index

```bash
npm run rebuild-index    # FTS5 색인 재구축
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | 로그인 (유일한 무인증 라우트) |
| POST | `/api/auth/logout` | 로그아웃 |
| GET | `/api/files` | 파일/폴더 목록 |
| GET | `/api/file-content` | 파일 내용 읽기 |
| PUT | `/api/file-content` | 파일 저장 (mtime 409 충돌 감지) |
| POST | `/api/upload` | 파일 업로드 (multipart) |
| GET | `/api/download` | 파일/폴더 다운로드 (ZIP) |
| GET | `/api/search` | FTS5 검색 |
| GET | `/api/tags` | 태그 집계 |
| GET | `/api/thumbnail` | 썸네일 생성 |
| POST | `/api/share/notify` | Discord/Slack 웹훅 발송 |

## Security

- 모든 라우트 세션 보호 (`/api/auth/login` 제외)
- 경로 탈출 차단 (`path.resolve` + realpath 검증)
- 업로드: 크기 상한 (413), 확장자 화이트리스트 (415), 파일명 새니타이즈
- Atomic write (임시 파일 -> rename)
- 편집 충돌 감지 (mtime 기반 409)
- Rate limiting
- 서버 내부 오류/스택트레이스 클라이언트 미노출

## License

MIT

---

> Developed with [Claude Code](https://claude.ai/code)
>
> Co-Authored-By: Claude Opus 4.6 \<noreply@anthropic.com\>
