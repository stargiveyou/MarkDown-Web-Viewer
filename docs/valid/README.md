# valid — 검증 결과 폴더

프론트/백엔드 검증 에이전트와 QA·최적화 에이전트가 **검증 리포트**를 남기는 곳이다.
모든 검증 에이전트 모델은 **fable**이며, 코드를 수정하지 않고 판정만 한다.

## 파일명 규칙

| 형식 | 작성자 |
|------|--------|
| `frontend-stage-<N>-validation.md` | `frontend-validator` |
| `backend-stage-<N>-validation.md` | `backend-validator` |
| `security-stage-<N>-validation.md` | `security-auth` (보안 체크리스트) |
| `qa-stage-<N>-validation.md` | `qa-integration` (E2E·통합) |
| `optimize-stage-<N>-report.md` | `optimizer` (성능·에러) |

## 판정 규칙

- 판정은 `PASS` / `FAIL` / `UNVERIFIED` 세 가지다.
- 모든 판정 근거는 **`파일:라인`으로 지목**한다. 추측 기반 PASS는 금지.
- 실행하지 않은 테스트를 PASS로 기록하지 않는다 — `UNVERIFIED` + 이유를 적는다.
- **FAIL이 1건이라도 있으면 해당 단계는 완료가 아니다.** 해당 항목은
  [../complete-work/](../complete-work/)에 기록하지 않고 [../plan/backlog.md](../plan/backlog.md)의 `P0`으로 되돌린다.
- 보안 불변식(CLAUDE.md) 위반은 무조건 `P0` 차단 사유다.

## 검증 순서

```
frontend-validator ─┐
                    ├→ qa-integration (통합·E2E) → optimizer (성능·에러 스윕)
backend-validator  ─┘
```

개별 검증에서 이미 FAIL로 잡힌 항목은 후속 에이전트가 중복 보고하지 않는다.
