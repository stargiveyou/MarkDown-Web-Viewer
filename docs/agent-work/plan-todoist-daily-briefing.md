# 기획서 — 업로드 문서 기반 Todoist 자동 동기화 + 아침 할 일 브리핑

> 상태: **기획 확정 전 (가능성 검토 완료)** · 작성 2026-10-05
> 성격: **MD 뷰어와 분리된 독립 프로젝트**. MD 뷰어 PLAN v1.0 로드맵 밖이며, 이 문서는 MD 뷰어 쪽에서 본 연동 계약과 합의 내용을 기록한다.
> 착수 시 새 저장소(가칭 `todoist-daily-sync`)로 옮기고, MD 뷰어에는 이 문서만 남긴다.

---

## 1. 목표

프로젝트마다 형상관리 도구(git / svn / perforce …)가 달라 커밋 기록을 공통 입력으로 쓸 수 없다.
대신 **모든 프로젝트가 MD 뷰어에 md를 업로드한다**는 공통 경로를 입력으로 삼는다.

매일 아침 정시에:
1. 지난 실행 이후 업로드된 md를 모두 읽고
2. 할 일 문서의 항목을 Todoist에 추가하고
3. 작업 기록을 근거로 Todoist의 열린 할 일(자동 추가 + 직접 추가 모두)을 **완료 체크**하고
4. "어제 정리 + 오늘 할 일" 브리핑을 Discord로 공지하고 MD 뷰어에 기록한다.

## 2. 확정된 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 형태 | 독립 프로젝트 (맥미니 로컬 워커). **MD 뷰어 코드 변경 없음** | 인터넷 노출 앱에 Todoist 쓰기 권한을 넣지 않는다. 장애 격리 |
| 실행 시점 | 매일 아침 정시 (평일 07:30 가정) | 하루치를 함께 봐야 완료 대조 정확도가 높다. CLI 사용량 1일 1회 |
| 입력 | 지난 **성공** 실행 이후 업로드된 md 전체 | "최근 24시간"이 아니라 커서 방식 → 실패·꺼짐·주말 누락 없음 |
| 할 일 앱 | Todoist | 프로젝트·작업 ID·토큰 인증이 단순, 모바일 알림 기본 제공 |
| 대상 범위 | **`mapping.yaml`로 연결한 폴더 ↔ Todoist 프로젝트만** | 매핑 안 된 개인 프로젝트의 할 일은 조회조차 하지 않는다 |
| 완료 체크 수준 | **AI가 높은 확신으로 판단한 것까지 자동 체크** (검증 조건 §5) | 사용자 결정 |
| 날짜별 작업 정리 | **MD 뷰어** `briefing/YYYY-MM-DD.md` | 캘린더·FTS5 검색이 이미 있음. Notion은 외부 공유가 필요해질 때만 |
| 알림 | Discord 아침 공지 | 기존 webhook 계층 재사용 |

### 역할 분담

```
Todoist   → 할 일 상태   (무엇을 해야 하고 무엇이 끝났나)
MD 뷰어   → 날짜별 기록  (원본 작업 기록 + 일일 정리, 검색·캘린더)
Discord   → 아침 공지
```

## 3. 아키텍처

```
[하루 동안]
  각 프로젝트 → md 업로드 (웹 / curl / Claude Code upload-md 스킬)
  MD 뷰어: 저장 → FTS5 색인 → 업로드 이력(SQLite) 기록          ← 변경 없음

[평일 07:25]  pmset repeat wakeorpoweron   (잠자기 중에도 정시 실행)
[평일 07:30]  launchd (StartCalendarInterval) → 워커
  1. 수집   업로드 이력에서 커서 이후 md 목록 + 매핑 폴더 내 할 일 파일 수정 시각/해시
  2. 추가   type: todo 문서 → 항목 추출 → Todoist 추가 (매핑 DB로 중복 차단)
  3. 조회   매핑된 Todoist 프로젝트의 열린 할 일 전체 (직접 추가분 포함)
  4. 판정   프로젝트별 Claude CLI 1회 → 판정 JSON
  5. 검증   스크립트가 §5 조건 검사 → 통과분만 Todoist API로 완료 + 근거 댓글
  6. 브리핑 AI는 "어제 정리" 문장만 작성, "오늘 할 일" 목록은 코드가 Todoist 데이터로 생성
  7. 출력   Discord 공지 + briefing/YYYY-MM-DD.md 를 MD 뷰어 업로드 API로 저장
  8. 커서   전부 성공한 프로젝트만 커서 전진. 실패 프로젝트는 다음 날 재시도
```

### 판단과 실행의 분리 (핵심 보안 설계)

- Claude CLI는 **판정만** 한다. 권한: `--restricted --strict-mcp-config --allowed-tools=Read,Glob,Grep` (웹 AI 패널과 동일한 읽기 전용).
- Todoist 쓰기는 **워커 스크립트가 REST API로** 수행한다. AI에게 Todoist MCP를 주지 않는다.
- 효과: 업로드 문서 속 프롬프트 인젝션이 Todoist를 직접 조작할 수 없다. AI 판정을 코드로 검증할 수 있다.

## 4. 입력 규칙

### 4-1. 폴더 ↔ Todoist 프로젝트 매핑

```yaml
# mapping.yaml (워커 저장소)
mappings:
  - folder: CustomLightmapper        # MARKDOWN_ROOT 기준
    todoistProjectId: "2203306141"   # 이름이 아니라 ID (이름 변경에 강함)
    label: CustomLightmapper
  - folder: MD-Viewer
    todoistProjectId: "2203306142"
  - folder: Husky-Proxy
    todoistProjectId: "2203306143"
```

- 하위 폴더 파일은 상위 매핑을 따른다. 중첩 매핑이 있으면 **가장 구체적인 경로 우선**.
- 1 폴더 = 1 Todoist 프로젝트 (다대다 금지).
- 매핑 없는 폴더·루트 파일: 대조하지 않고 공지에 "매핑되지 않은 업로드 N건"으로 알린다.
- 매핑 폴더가 사라짐(뷰어에서 이동·이름 변경) / Todoist 프로젝트 삭제·보관: 해당 매핑을 건너뛰고 공지에 경고. **자동 수정하지 않는다.**
- (선택, 후순위) 하위 폴더 ↔ Todoist 섹션 매핑.

### 4-2. 문서 종류

```yaml
---
type: todo        # 할 일 추가용 문서에만 필수
---
```

- 완료 판정 근거로는 **매핑 폴더의 모든 md**를 쓴다. 작업 기록에 별도 표시는 필요 없다.
- 프로젝트는 폴더 위치로 결정되므로 `project` 필드는 필요 없다.
- 할 일 문서 항목 형식: `- [ ] 항목` 체크리스트. 이미 `- [x]`인 항목은 추가하지 않는다.

## 5. 자동 완료 체크 조건

AI 판정 출력:

```json
[{ "todoId": "8123456789", "verdict": "done", "confidence": 0.93,
   "evidence": "작업 기록 원문에서 그대로 인용한 문장",
   "source": "CustomLightmapper/worklog/2026-10-05.md" }]
```

모두 만족해야 체크한다:

| # | 조건 | 검증 |
|---|---|---|
| 1 | `verdict=done` 이고 확신도 기준 이상 (아래 차등표) | 스크립트 |
| 2 | `evidence`가 `source` 문서 원문에 **실제로 존재** (정규화 후 문자열 대조) | 스크립트 |
| 3 | 근거 문장에 미완료 신호 없음: 일부, 진행 중, 남음, TODO, 다음에, 보류, WIP … | 스크립트 |
| 4 | 할 일이 같은 매핑 프로젝트에 속하고 아직 열려 있음 | 스크립트 + Todoist |
| 5 | 1회 실행에서 프로젝트당 자동 체크 ≤ 10건. 초과 시 그날은 전부 "확인 필요"로 강등 | 스크립트 |
| 6 | 작업 기록에 할 일 ID·제목이 그대로 언급되면 확신도와 무관하게 체크 | 스크립트 |

확신도 차등:

| 할 일 종류 | 자동 체크 기준 |
|---|---|
| 자동 추가 (출처 문서 있음) | ≥ 0.90 |
| 직접 추가, 설명(description) 충분 | ≥ 0.90 |
| 직접 추가, 짧은 제목만 | ≥ 0.95 또는 "확인 필요"만 |

제외 대상:
- **반복 할 일** — 완료 시 다음 회차로 넘어가므로 기본 제외
- 하위 할 일이 남은 부모 할 일
- 사람이 다시 연 할 일 (매핑 DB에 `manually_reopened` 기록 → 같은 근거로 재체크 금지)

미달 항목은 체크하지 않고 브리핑의 "확인 필요"로 올린다.

### 되돌리기와 감사

- 자동 완료 시 Todoist 댓글: `✅ 자동 완료 (YYYY-MM-DD 브리핑) / 근거: "…" / 정리: <뷰어 briefing 링크>`
- 공지에 자동 체크 목록 + 근거 표시 → Todoist에서 다시 열면 되돌려진다.
- 모든 판정(미체크 포함)을 감사 테이블에 기록 → 기준 조정 근거.

## 6. 데이터 (워커 전용 SQLite)

| 테이블 | 주요 컬럼 |
|---|---|
| `runs` | id, started_at, finished_at, status, cursor_before, cursor_after |
| `project_cursor` | mapping_folder, last_success_upload_at, last_success_upload_id |
| `todo_map` | todoist_task_id, mapping_folder, origin(auto/manual), source_file, source_line_hash, text, state, manually_reopened |
| `todo_file_state` | subpath, content_hash, mtime (할 일 문서 수정·삭제 감지) |
| `verdicts` | run_id, todoist_task_id, verdict, confidence, evidence, source, applied(bool), reject_reason |

MD 뷰어 SQLite(업로드 이력)는 **읽기 전용**으로만 연다.

## 7. 아침 공지 형식 (Discord)

```
📋 10월 6일 (월) 오늘의 할 일

✅ 자동 완료 3건
 • [CustomLightmapper] 라이트맵 UV 겹침 검사 추가
   └ 근거: "UV overlap 검사 로직 추가 후 테스트 통과" (worklog/2026-10-03.md)
🔍 확인 필요 1건
 • [CustomLightmapper] 베이크 진행률 UI — "일부 구현" 언급
📝 지난 작업 요약
 • CustomLightmapper: UV 검사 로직 완성, 베이크 UI 착수
📌 오늘 할 일 (7건)
 ⚠️ 밀린 일: [MD-Viewer] Stage 6 게이트 S-1·S-2 실측 — 3일째
 🆕 새로 추가 2건 …
⚠️ 매핑되지 않은 업로드 1건: misc/notes.md
🔗 전체: https://<뷰어>/workspace/view?path=briefing/2026-10-06.md
```

실행 실패 시 빈 공지 대신 **"브리핑 생성 실패 + 사유"**를 보낸다.

## 8. 단계별 도입

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| P0 | 선행: MD 뷰어 Stage 6 게이트 S-1·S-2 (CLI 경로 봉쇄 실측) | 맥미니에서 PASS |
| P1 | 워커 골격: 커서 수집, 매핑, launchd/pmset, 브리핑 md + Discord (Todoist 읽기만) | 3일 연속 정시 공지 |
| P2 | 할 일 추가 (실제 모드) + 매핑 DB 중복 차단 | 같은 문서 재업로드 시 중복 0 |
| P3 | 완료 판정 **미리보기 모드** 1~2주 — 판정·"체크했을 것"만 공지 | 오체크율 측정 |
| P4 | 자동 체크 실제 모드 전환, 확신도 기준 실측 조정 (0.85~0.95) | 사용자 승인 |
| P5 (선택) | 섹션 매핑 / Notion 일일 정리 복사 (외부 공유 필요 시) | — |

## 9. 위험과 미확인 사항

| 항목 | 대응 / 확인 방법 |
|---|---|
| 짧은 제목 할 일의 오체크 | 차등 기준 + P3 미리보기 + 공지에서 되돌리기 |
| AI가 근거를 지어냄 | §5-2 원문 대조 |
| 프롬프트 인젝션 | AI에 Todoist 권한 없음. 판정만 |
| 하루치 분량이 CLI 시간 초과 | 프로젝트별 분할, 필요 시 문서 묶음 분할 / FTS5 사전 필터 — **맥미니 실측 필요** |
| Todoist API의 반복·하위 할 일 필드 구조 | 착수 시 최신 공식 API 문서 확인 |
| 같은 `claude` 로그인(Claude Max) 공유 | 웹 AI 패널과 시간대 분리 (아침 실행) |
| 업로드 폴더가 곧 AI 입력 | 매핑 폴더만 읽음. 업로드 영역과 할 일 판정 범위 일치 확인 |
| Todoist 토큰 | 워커 `.env` 전용, 저장소 커밋 금지 |

## 10. MD 뷰어 쪽 영향

- 코드 변경 **없음**. 사용하는 것: 업로드 이력 테이블(읽기 전용), `POST /api/upload`(브리핑 저장), 캘린더·검색 화면.
- 워커의 브리핑 업로드는 업로드 rate limit(보안 불변식 7)에 1일 1회 1건으로 걸리지 않는다.
- 워커가 업로드 API를 쓰려면 세션 로그인이 필요하다 → 워커 전용 비밀번호 로그인 흐름 또는 로컬 전용 업로드 경로 중 택1. **착수 시 `security-auth` 검토 항목.**

## 관련 문서

- [PWA·iPhone 푸시 검토](review-pwa-ios-push.md) — 아침 공지를 Discord 대신 MD 뷰어 앱 알림으로 받는 경로
- [Stage 6 맥미니 게이트](../plan/stage-6-macmini-gate.md) — 선행 조건(CLI 경로 봉쇄 S-1·S-2)
- [진행 목록](../plan/progress.md) · [잔여 목록](../plan/backlog.md)
