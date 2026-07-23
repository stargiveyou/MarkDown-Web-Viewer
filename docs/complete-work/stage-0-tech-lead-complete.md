# Stage 0 — 스캐폴딩 완료 기록

- 담당: `tech-lead` (model: opus) / 일부 `security-auth` 영역 포함
- 완료일: 2026-07-23
- 근거 계약: [docs/agent-work/contract-stage-0.md](../agent-work/contract-stage-0.md)

## 구현 범위

Next.js App Router 프로젝트 골격 + 공유 API 계약 + 테스트 환경 구축. 비즈니스 로직은 없다(Stage 1부터).

## 확정된 스택 버전

| 항목 | 버전 | 비고 |
|------|------|------|
| Node | **22.23.1** | v19.1.0에서 업그레이드. `~/.local/node-v22.23.1-darwin-x64` |
| npm | 10.9.8 | Node 22 동봉 |
| Next.js | 16.2.11 | App Router + Turbopack |
| React | 19.2.4 | |
| Tailwind | **v4** | v3와 달리 config가 아닌 CSS에서 플러그인 등록 |
| Vitest | 4.1.10 | 테스트 러너 확정 (backlog P2-1 해소) |

## 변경/생성 파일

| 파일 | 내용 |
|------|------|
| [src/types/api.ts](../../src/types/api.ts) | **공유 API 계약** — 10개 엔드포인트 요청·응답 타입 |
| [src/lib/env.ts](../../src/lib/env.ts) | 서버 env 접근 시그니처 |
| [src/lib/path-safety.ts](../../src/lib/path-safety.ts) | 경로 안전 유틸 시그니처 (보안 불변식 2) |
| [src/lib/session.ts](../../src/lib/session.ts) | 세션 인증 시그니처 (보안 불변식 1) |
| [src/lib/rate-limit.ts](../../src/lib/rate-limit.ts) | rate limiter 시그니처 (보안 불변식 7) |
| [src/lib/fetcher.ts](../../src/lib/fetcher.ts) | 전역 fetch 래퍼 시그니처 (401/429 처리) |
| [src/test/setup.test.ts](../../src/test/setup.test.ts) | 테스트 환경 스모크 (2 passed) |
| [src/test/server-only-stub.ts](../../src/test/server-only-stub.ts) | 테스트 전용 `server-only` 치환 |
| [vitest.config.ts](../../vitest.config.ts) | `@` 별칭 + `server-only` alias |
| [next.config.ts](../../next.config.ts) | `images.unoptimized` — 아래 보안 근거 참조 |
| [.env.local.example](../../.env.local.example) | env 9키 템플릿 |
| [.gitignore](../../.gitignore) | `.env.local`, sqlite 색인, 썸네일 캐시 제외 |
| `package.json` | name/engines/scripts 정리 |
| `src/app/globals.css` | `@plugin "@tailwindcss/typography"` (v4 방식) |

`src/lib/*`는 **시그니처만 있는 스텁**이며 호출 시 `NOT_IMPLEMENTED`를 throw한다. Stage 1에서 담당 에이전트가 구현한다.

## 검증 결과

| 항목 | 결과 |
|------|------|
| `npm run build` | ✅ 통과 (Turbopack, 24.7s) |
| `npm run typecheck` | ✅ 통과 (0 errors) |
| `npm run lint` | ⚠️ 0 errors / 12 warnings — 전부 스텁의 미사용 파라미터. **의도된 미구현 표식**이며 Stage 1 구현 시 자연 소멸 |
| `npm test` | ✅ 2 passed — `@` 별칭 + `server-only` 치환 동작 확인 |
| sharp 런타임 로드 | ✅ libvips 8.18.3 |
| better-sqlite3 + FTS5 | ✅ **trigram 한글 부분일치 실증** — `"제주도"` → `[[hl]]제주도[[/hl]]에서 찍은 사진` |

FTS5 검증은 ADR-007의 핵심 가정(한국어 조사 부분일치)을 Stage 3 이전에 실물로 확인한 것이며, `SNIPPET_MARK` 마커 왕복도 함께 확인됐다.

## 보안 사항 — 의존성 취약점 5건

**전부 transitive이며 직접 의존성은 최신이다.** `npm audit fix`로 해결 가능한 항목은 0건이고,
`npm audit fix --force`는 **next를 9.3.3으로 다운그레이드**하려 하므로 절대 실행하지 않는다.

| 패키지 | 심각도 | 경로 | 판단 |
|--------|--------|------|------|
| sharp 0.34.5 | **high** | next 16.2.11 내부 | libvips CVE 4건. 우리 직접 의존은 0.35.3(안전). `images.unoptimized: true`로 업로드 이미지가 이 경로를 타지 못하게 차단 |
| postcss 8.4.31 | moderate | next 내부 | CSS stringify XSS. **빌드타임 전용**이라 런타임 노출 없음 |
| dompurify 3.4.8 | moderate/low | monaco-editor 내부 | 에디터 sanitize 경로. 단일 사용자가 자기 문서를 편집하는 구조라 노출면이 좁음 |

완화책이 계약과 정합한다는 점이 중요하다 — 프론트가 카드 이미지에 `/api/thumbnail`만 쓰도록 이미 강제되어 있어(계약 §4), next의 취약한 sharp 경로가 애초에 사용되지 않는다.

## 다음 단계로 넘긴 항목

| 항목 | 이관 위치 |
|------|-----------|
| next의 번들 sharp 0.35+ 승급 추적 | backlog P1 |
| `~/MarkdownDocs` 실제 디렉터리 생성 | OS 작업 — 사용자 확인 필요 |
| `git init` | OS 작업 — 사용자 확인 필요 |
| README 작성 | 미정 (CLAUDE.md가 역할 대행 중) |

## 검증 요청

> TO: `backend-validator`, `frontend-validator` — Stage 0은 비즈니스 로직이 없어 개별 검증을 생략한다.
> 대신 Stage 1 착수 시 [contract-stage-0.md](../agent-work/contract-stage-0.md)를 계약 기준선으로 삼는다.
