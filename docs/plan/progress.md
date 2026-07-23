# 개발이 진행된 목록 (Completed)

> 검증(`docs/valid/`)을 **통과한 항목만** 이 문서로 이동한다.
> 개별 완료 기록의 원문은 [docs/complete-work/](../complete-work/)에 있다.
> 검증 FAIL 항목은 여기 기록하지 않고 [backlog.md](backlog.md)로 되돌린다.

---

## 요약

| 단계 | 상태 | 완료일 | 검증 리포트 |
|------|------|--------|-------------|
| Stage 0 스캐폴딩 | ✅ 완료 | 2026-07-23 | 빌드/타입체크/테스트 통과 |
| Stage 1 인증 + 업로드 | ⬜ 미착수 | — | — |
| Stage 2 GridView + 뷰어 + 편집 | ⬜ 미착수 | — | — |
| Stage 3 검색 · 정렬 · 태그 | ⬜ 미착수 | — | — |
| Stage 4 소셜 공유 | ⬜ 미착수 | — | — |
| Stage 5 업로드 알림 | ⬜ 미착수 | — | — |

---

## 완료 이력

### 2026-07-22 — 프로젝트 셋업
- 기획 문서 3종 확정 반영 → [CLAUDE.md](../../CLAUDE.md) 생성
- 팀 서브에이전트 8종 정의 (`.claude/agents/`)
  - 개발(opus): `tech-lead`, `frontend-dev`, `backend-dev`, `security-auth`
  - 검증·최적화(fable): `frontend-validator`, `backend-validator`, `qa-integration`, `optimizer`
- 작업 폴더 규약 수립: `src/` · `docs/agent-work/` · `docs/valid/` · `docs/complete-work/` · `docs/plan/`

### 2026-07-23 — Stage 0: 스캐폴딩
- 담당: `tech-lead`
- 산출물: Next.js 16 + React 19 + Tailwind v4 골격, [src/types/api.ts](../../src/types/api.ts)(공유 계약), `src/lib/*` 스텁 5종, Vitest 환경
- 런타임: **Node v19.1.0 → v22.23.1 업그레이드** (`~/.local/node-v22.23.1-darwin-x64`, sudo 불필요 방식)
- 검증: build ✅ / typecheck ✅ / test 2 passed ✅ / lint 0 errors(12 warnings = 스텁 미구현 표식)
- 실증: **FTS5 trigram 한글 부분일치 확인** — ADR-007 가정 검증 완료
- 완료 기록: [stage-0-tech-lead-complete.md](../complete-work/stage-0-tech-lead-complete.md)

> 이후 항목은 아래 형식으로 추가한다.
>
> ```
> ### YYYY-MM-DD — Stage <N>: <작업명>
> - 담당: <agent>
> - 산출물: <파일 경로>
> - 검증: docs/valid/<리포트>.md — PASS
> - 완료 기록: docs/complete-work/<기록>.md
> ```
