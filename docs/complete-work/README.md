# complete-work — 완료 작업 기록 폴더

에이전트가 작업을 마쳤을 때 **무엇을 했는지** 기록하는 곳이다.
진행 중 공유는 [../agent-work/](../agent-work/), 판정은 [../valid/](../valid/).

## 파일명 규칙

`stage-<N>-<agent>-complete.md`

예: `stage-1-backend-complete.md`, `stage-2-frontend-complete.md`, `stage-1-integration-complete.md`

## 기록 규칙

1. 개발 에이전트는 작업 완료 직후 이 폴더에 기록하고, 그 다음 검증 에이전트를 호출한다.
2. **검증 FAIL 항목은 여기에 완료로 기록하지 않는다.** [../plan/backlog.md](../plan/backlog.md)로 되돌린다.
3. 검증 PASS 후 `tech-lead`가 [../plan/progress.md](../plan/progress.md)에 요약을 반영한다.

## 템플릿

```markdown
# Stage <N> — <agent> 완료 기록
- 담당: <agent> (model: opus)
- 완료일: <YYYY-MM-DD>
- 근거 계약: docs/agent-work/contract-stage-<N>.md

## 구현 범위
- <무엇을 했는가>

## 변경/생성 파일
| 파일 | 내용 |
|------|------|
| `src/...` | ... |

## 계약 준수 확인 (자체 점검)
| 항목 | 확인 |
|------|------|
| 인증 강제 | ☐ |
| 경로 검증 유틸 경유 | ☐ |
| atomic write | ☐ |
| 상태 코드 | ☐ |

## 의존성 추가
`npm install ...`

## 미결 / 다음 단계로 넘긴 항목
- <항목> → backlog.md 반영 여부

## 검증 요청
> TO: <frontend-validator | backend-validator> — 검증 범위: <파일 범위>
```
