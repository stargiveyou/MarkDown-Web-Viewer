# Stage 1 작업 분해 — 인증 + 웹 업로드(로컬 저장)

- 작성: `tech-lead` / 2026-07-23
- 계약 기준: [contract-stage-0.md](../agent-work/contract-stage-0.md) · [src/types/api.ts](../../src/types/api.ts)
- 목표: 로그인 → 업로드 → 로컬 디스크 저장까지의 최소 수직 관통

## 범위에 포함되는 엔드포인트

| 메서드 | 경로 | 담당 |
|--------|------|------|
| POST | `/api/auth/login` | backend-dev |
| POST | `/api/auth/logout` | backend-dev |
| POST | `/api/upload` | backend-dev |

`/api/files`·`/api/thumbnail`은 Stage 2다. 업로드 후 확인은 파일시스템 직접 확인으로 충분하다.

## 실행 순서 (Wave)

```
Wave 1 ──┬── security-auth : path-safety → session/middleware → rate-limit → .env.local
         └── frontend-dev  : fetcher → /login → 업로드 드롭존        (계약만 보고 병렬)
              ↓
Wave 2 ───── backend-dev   : login/logout → upload                  (Wave 1 산출물 의존)
              ↓
Wave 3 ──┬── backend-validator
         └── frontend-validator                                      (완전 독립, 동시)
              ↓
Wave 4 ───── qa-integration → optimizer
```

**임계 경로**: `path-safety` → `session`/`middleware` → `/api/upload`.
경로 안전 유틸과 세션이 없으면 백엔드는 보안 불변식 1·2를 만족하는 라우트를 쓸 수 없다.

## Wave 1-A — security-auth (opus)

| # | 작업 | 산출물 |
|---|------|--------|
| 1 | `env.ts` 구현 — 필수 env 검증, 미설정 시 기동 실패 | `src/lib/env.ts` |
| 2 | `path-safety.ts` 구현 | `src/lib/path-safety.ts` |
| 3 | **traversal 유닛 테스트** — `../`, 절대경로, 심볼릭 링크, 인코딩 우회 | `src/lib/path-safety.test.ts` |
| 4 | `session.ts` 구현 — scrypt 해시 + timing-safe 비교 + 서명 쿠키 | `src/lib/session.ts` |
| 5 | `middleware.ts` — 전 페이지·API 보호 (`/login`, `POST /api/auth/login` 예외) | `src/middleware.ts` |
| 6 | `rate-limit.ts` 구현 — 세션 키 우선, IP 폴백 | `src/lib/rate-limit.ts` |
| 7 | `.env.local` 생성 — `MARKDOWN_ROOT=/Users/husky/MarkdownDocs` | (gitignore 대상) |
| 8 | 위협 모델 + 보안 체크리스트 | `docs/valid/security-stage-1-validation.md` |

## Wave 1-B — frontend-dev (opus)

| # | 작업 | 산출물 |
|---|------|--------|
| 1 | `fetcher.ts` 구현 — 401 리다이렉트 / 429 토스트 / `ApiRequestError` 정규화 | `src/lib/fetcher.ts` |
| 2 | `/login` 페이지 | `src/app/login/page.tsx` |
| 3 | 업로드 드롭존 — 진행률 + 413/415/429 구분 표시 | `src/components/upload/` |
| 4 | 토스트 최소 구현 | `src/components/ui/` |
| 5 | `/workspace` 골격 — 업로드 진입점 + 로그아웃 (GridView는 Stage 2) | `src/app/workspace/page.tsx` |

## Wave 2 — backend-dev (opus)

| # | 작업 | 산출물 |
|---|------|--------|
| 1 | `POST /api/auth/login` — timing-safe 비교, 쿠키 발급 | `src/app/api/auth/login/route.ts` |
| 2 | `POST /api/auth/logout` | `src/app/api/auth/logout/route.ts` |
| 3 | `POST /api/upload` — 크기(413)·확장자(415)·파일명 새니타이즈·**atomic write** | `src/app/api/upload/route.ts` |

`runtime = "nodejs"` 선언 필수. 색인 갱신·Webhook 발화는 Stage 3·5이므로 이번엔 훅 지점만 TODO로 남긴다.

## Wave 3·4 — 검증 (fable)

`backend-validator` ∥ `frontend-validator` → `qa-integration` → `optimizer`.
결과는 [docs/valid/](../valid/)에 기록하며, **FAIL 1건이라도 있으면 Stage 1은 완료가 아니다**.

## 단계 완료 조건

1. 로그인 → 업로드 → `~/MarkdownDocs`에 파일 실제 저장 확인
2. 미인증 요청이 모든 보호 라우트에서 401
3. traversal 테스트 전부 통과
4. `npm run build` / `typecheck` / `test` 통과
5. 검증 리포트 FAIL 0건
