# 개발 단계별 진행 목록 (Roadmap)

> 기준: [PLAN.md §7](../setting/PLAN.md) · 단계 순서는 고정이며 앞 단계 검증 통과 전에 다음 단계로 넘어가지 않는다.
> 상태 표기: `⬜ 미착수` · `🟡 진행중` · `🔵 검증중` · `✅ 완료(검증 통과)`

---

## Stage 0 — 스캐폴딩 (선행) ✅ **완료 2026-07-23**
| 상태 | 작업 | 담당 | 산출물 |
|------|------|------|--------|
| ✅ | Node 22.23.1 업그레이드 (v19 → 22) | tech-lead | `~/.local/node-v22.23.1-darwin-x64` |
| ✅ | Next.js 16 App Router + TypeScript 생성 | tech-lead | `package.json`, `src/app/` |
| ✅ | Tailwind **v4** + typography 등록 | tech-lead | `src/app/globals.css` (`@plugin`) |
| ✅ | 공유 API 타입 모듈 정의 | tech-lead | [src/types/api.ts](../../src/types/api.ts) |
| ✅ | `src/lib/*` 스텁 5종 (시그니처 확정) | tech-lead | `env`·`path-safety`·`session`·`rate-limit`·`fetcher` |
| ✅ | Vitest 도입 + 환경 스모크 테스트 | tech-lead | `vitest.config.ts`, 2 passed |
| ✅ | `.env.local.example` + `.gitignore` | security-auth | 루트 |

> 완료 기록: [stage-0-tech-lead-complete.md](../complete-work/stage-0-tech-lead-complete.md)

## Stage 1 — 인증 + 웹 업로드(로컬 저장)
| 상태 | 작업 | 담당 | 산출물 |
|------|------|------|--------|
| ⬜ | 경로 안전 유틸 + traversal 유닛 테스트 | security-auth | `src/lib/path-safety.ts` |
| ⬜ | 세션 미들웨어 (전 페이지·API 보호) | security-auth | `src/middleware.ts` |
| ⬜ | Rate limiter (upload / share) | security-auth | `src/lib/rate-limit.ts` |
| ⬜ | `POST /api/auth/login` (timing-safe) / `logout` | backend-dev | 라우트 핸들러 |
| ⬜ | `POST /api/upload` — 검증 + atomic write | backend-dev | 라우트 핸들러 |
| ⬜ | `/login` 페이지 + 전역 fetch 래퍼(401/429) | frontend-dev | 페이지 + `src/lib/fetcher.ts` |
| ⬜ | 업로드 드롭존 (413/415/429 노출) | frontend-dev | 컴포넌트 |
| ⬜ | 검증 | frontend-validator / backend-validator / qa-integration | `docs/valid/*-stage-1-*.md` |

## Stage 2 — GridView + 뷰어 + Monaco 편집 + 썸네일
| 상태 | 작업 | 담당 | 산출물 |
|------|------|------|--------|
| ⬜ | `GET /api/files?path=&sort=&tag=` (gray-matter) | backend-dev | 라우트 핸들러 |
| ⬜ | `GET /api/file-content` / `PUT`(baseMtime 409) | backend-dev | 라우트 핸들러 |
| ⬜ | `GET /api/thumbnail` (sharp + 디스크 캐시) | backend-dev | 라우트 핸들러 |
| ⬜ | 폴더/이미지/md GridView + Breadcrumb | frontend-dev | 컴포넌트 |
| ⬜ | Monaco 분할 뷰 + Cmd+S + 409 충돌 UX | frontend-dev | 컴포넌트 |
| ⬜ | 검증 | 검증 3종 | `docs/valid/*-stage-2-*.md` |

## Stage 3 — 검색 · 정렬 · 태그 (FTS5)
| 상태 | 작업 | 담당 | 산출물 |
|------|------|------|--------|
| ⬜ | FTS5 스키마(`tokenize='trigram'`) + 초기 색인 | backend-dev | `src/lib/search-index.ts` |
| ⬜ | 업로드/저장 시 증분 색인 갱신 훅 | backend-dev | 색인 연동 |
| ⬜ | `GET /api/search` (snippet + BM25) | backend-dev | 라우트 핸들러 |
| ⬜ | `GET /api/tags` (태그 + 개수) | backend-dev | 라우트 핸들러 |
| ⬜ | 검색 입력(디바운스) + 정렬 드롭다운 + 태그 칩 | frontend-dev | 컴포넌트 |
| ⬜ | 한글 부분일치 검증 | qa-integration | `docs/valid/qa-stage-3-validation.md` |

## Stage 4 — 소셜 공유 (Discord / Slack)
| 상태 | 작업 | 담당 | 산출물 |
|------|------|------|--------|
| ⬜ | `POST /api/share/notify` (Embed / Block Kit, 502) | backend-dev | 라우트 핸들러 |
| ⬜ | 공유 모달 + Copy Link(인증 URL 명시) | frontend-dev | 컴포넌트 |
| ⬜ | 검증 (Webhook URL 미노출 확인) | 검증 3종 | `docs/valid/*-stage-4-*.md` |

## Stage 5 — 업로드 완료 알림
| 상태 | 작업 | 담당 | 산출물 |
|------|------|------|--------|
| ⬜ | 업로드 성공 훅 → 동일 Webhook 계층 재사용 | backend-dev | 알림 연동 |
| ⬜ | E2E 해피패스 최종 검증 | qa-integration | `docs/valid/qa-stage-5-validation.md` |
| ⬜ | 전체 최적화·에러 스윕 | optimizer | `docs/valid/optimize-stage-5-report.md` |

---

## 단계 완료 조건 (공통)
1. 담당 개발 에이전트가 `docs/complete-work/`에 완료 기록 작성
2. `frontend-validator` + `backend-validator` 리포트가 `docs/valid/`에 존재하고 **FAIL 0건**
3. `qa-integration` E2E 리포트 PASS
4. 보안 불변식 8개 전부 강제 위치가 매핑됨
5. `tech-lead`가 통합 체크리스트 승인 → `progress.md`로 이동
