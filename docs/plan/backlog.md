# 앞으로 해야 할 목록 (Backlog)

> 미착수 작업 + **검증 FAIL로 되돌아온 항목**을 관리한다.
> 단계별 전체 계획은 [roadmap.md](roadmap.md), 완료분은 [progress.md](progress.md).
> 우선순위: `P0`(차단) > `P1`(단계 필수) > `P2`(개선).

---

## P0 — 차단 항목 (검증 FAIL / 보안 불변식 위반)

| # | 항목 | 출처 리포트 | 담당 | 비고 |
|---|------|-------------|------|------|
| — | 현재 없음 | — | — | — |

> ~~1. Node 런타임 v19.1.0 → 20.9+ 업그레이드~~ → **2026-07-23 해소**. v22.23.1 설치 완료(`~/.local`, sudo 불필요 방식).

> 검증 에이전트가 FAIL을 낼 때마다 여기에 추가한다. P0가 하나라도 있으면 해당 단계는 완료 불가.

---

## P1 — 다음 착수 (Stage 1)

Stage 0 완료로 1~3번은 해소됐다. 스텁 시그니처가 이미 있으므로 4~9는 **구현만** 하면 된다.

| # | 항목 | 담당 | 선행 조건 |
|---|------|------|-----------|
| ~~1~~ | ~~Next.js 스캐폴딩~~ | ✅ 2026-07-23 | — |
| ~~2~~ | ~~공유 API 타입 모듈~~ | ✅ [src/types/api.ts](../../src/types/api.ts) | — |
| ~~3~~ | ~~`.env.local.example` + gitignore~~ | ✅ 2026-07-23 | — |
| 4 | `path-safety.ts` 구현 + traversal 유닛 테스트 | security-auth | 없음 (임계 경로) |
| 5 | `session.ts` + `src/middleware.ts` (전 라우트 보호) | security-auth | 4 |
| 6 | `rate-limit.ts` 구현 | security-auth | 없음 |
| 7 | `POST /api/auth/login` / `logout` | backend-dev | 5 |
| 8 | `POST /api/upload` (검증 + atomic write) | backend-dev | 4, 5, 6 |
| 9 | `fetcher.ts` 구현 + `/login` 페이지 | frontend-dev | 없음 (계약 확정됨) |
| 10 | 업로드 드롭존 (413/415/429 노출) | frontend-dev | 9 |

**임계 경로**: 4 → 5 → 8. `security-auth`의 경로 안전 유틸이 없으면 백엔드가 보안 불변식 2를 만족하는 라우트를 쓸 수 없다.
**병렬 가능**: 9·10(frontend-dev)은 계약이 확정되어 있어 백엔드를 기다리지 않는다.

### 신규 P1 — Stage 0에서 발생

| # | 항목 | 내용 |
|---|------|------|
| 11 | next 번들 sharp 0.35+ 승급 추적 | next 16.2.11이 sharp@0.34.5를 번들하며 libvips CVE 4건(high) 보유. 현재 `images.unoptimized: true`로 경로 차단 중. next 업데이트 시 재검토하고 차단 해제 여부 판단 |
| 12 | `npm audit fix --force` **금지** 규칙 | next를 9.3.3으로 다운그레이드하려 함. 실행 시 프로젝트 파괴. 취약점 3건은 전부 transitive이며 상위 수정본 미출시 |

---

## P2 — 미결정 / 후속 판단 필요

| # | 항목 | 내용 |
|---|------|------|
| ~~1~~ | ~~테스트 러너 선정~~ | ✅ 2026-07-23 **Vitest 4** 확정. `vitest.config.ts`에 `@` 별칭 + `server-only` 치환 설정 완료. 단일 테스트 실행법은 CLAUDE.md "명령어" 참조 |
| 2 | chokidar 파일 감시 | ADR-007의 **선택** 항목. 앱 외부(파인더·터미널) 변경 포착용. Stage 3 이후 판단 |
| 3 | ngrok Traffic Policy 실적용 | 무료 플랜 Basic Auth + 정적 도메인 예약. 배포 시점에 진행 (운영체제/외부 계정 관련 → 사용자 확인 필요) |
| 4 | 상주 프로세스 관리 | `next start` 무한 상주 방식(launchd / pm2 등) 미정. 배포 시점 결정 |

---

## 되돌아온 항목 기록 형식

```
### [P0] <항목명>
- 출처: docs/valid/<리포트>.md — FAIL #<n>
- 위반: <보안 불변식 번호 또는 ADR>
- 재현: <절차>
- 담당: <agent>
- 상태: 미착수 | 수정중 | 재검증 대기
```
