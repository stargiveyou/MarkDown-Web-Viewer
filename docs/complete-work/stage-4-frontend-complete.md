# Stage 4 Frontend 완료 기록 -- 소셜 공유 UI (Discord / Slack)

- 작성: `frontend-dev` / 2026-07-25
- 상태: **완료**
- 계약 기준: [frontend-stage-4-contract.md](../agent-work/frontend-stage-4-contract.md)

---

## 변경 파일 목록

| 파일 | 변경 유형 | 설명 |
|------|-----------|------|
| `src/components/workspace/ShareModal.tsx` | **신규** | Discord/Slack 공유 알림 + 링크 복사 모달 컴포넌트 |
| `src/app/workspace/view/page.tsx` | 수정 | 공유 버튼 추가 + ShareModal 연결 |
| `src/app/workspace/edit/page.tsx` | 수정 | 공유 버튼 추가 + ShareModal 연결 |

---

## 구현 범위

### 1. ShareModal 컴포넌트

- 기존 `Modal` 컴포넌트(`src/components/ui/Modal.tsx`) 재사용.
- 세 가지 액션 버튼: Discord 공유, Slack 공유, 링크 복사.
- Discord/Slack 버튼 클릭 시 `apiFetch<ShareNotifyResponse>('/api/share/notify', ...)` 호출.
- 전송 중 해당 버튼에 `Loader2` 스피너 표시 + 전체 버튼 비활성화.
- 성공 시 토스트 (`"Discord에 공유되었습니다."` / `"Slack에 공유되었습니다."`).
- 성공 후 모달을 닫지 않음 -- 다른 플랫폼에도 공유 가능.
- 에러 처리:
  - 400: 서버 메시지를 토스트로 표시.
  - 401: `apiFetch`가 `/login` 자동 리다이렉트.
  - 429: `apiFetch`가 자동 토스트 처리.
  - 502: `"전송에 실패했습니다. 잠시 후 재시도해 주세요."` 토스트.
- 링크 복사: `navigator.clipboard.writeText(window.location.href)` + 성공/실패 토스트.
- 하단 안내 텍스트: "공유 링크를 받은 사람도 로그인이 필요합니다." (ADR-004 준수).

### 2. 뷰어 페이지 공유 버튼

- 헤더 우측에 "공유" 버튼 추가 (편집 버튼 좌측).
- `Share2` 아이콘 + "공유" 텍스트.
- 클릭 시 ShareModal 열기, `filePath`는 URL 쿼리의 `path` 값.

### 3. 편집 페이지 공유 버튼

- 헤더 우측에 "공유" 버튼 추가 (저장 버튼 좌측).
- 동일한 패턴으로 ShareModal 연결.

---

## 보안 체크리스트

| # | 항목 | 상태 |
|---|------|------|
| 1 | 모든 API 호출이 `apiFetch` 경유 (401 자동 리다이렉트) | PASS |
| 2 | 타입 안전 -- `ShareNotifyResponse`, `ShareTarget` import from `@/types/api` | PASS |
| 3 | ADR-004 -- "링크 복사" 시 인증 필요 안내 포함, 카카오 없음 | PASS |
| 4 | 보안 불변식 6 -- Webhook URL이 클라이언트 코드에 참조되지 않음 | PASS |
| 5 | 502 처리 -- 재시도 안내 토스트 | PASS |
| 6 | 에러 분류 -- 400/429/502 각각 다른 UI 대응 | PASS |

---

## 접근성

| 항목 | 구현 |
|------|------|
| 모달 포커스 트랩 | Modal 컴포넌트가 처리 |
| 포커스 복원 | Modal 컴포넌트가 처리 |
| Esc 닫기 | Modal 컴포넌트가 처리 |
| 배경 클릭 닫기 | Modal 컴포넌트가 처리 |
| 버튼 title 속성 | 공유 버튼에 `title="공유하기"` |
| disabled 상태 | 전송 중 `disabled` 속성 적용 |
| 로딩 상태 | Loader2 스피너 아이콘으로 시각적 표시 |

---

## 검증 결과

| 검증 | 결과 |
|------|------|
| `npm run typecheck` | PASS (에러 0) |
| `npm run lint` | PASS (프론트엔드 에러/경고 0; 백엔드 webhook.test.ts 경고 3건은 무관) |
| `npm run build` | PASS (성공) |

---

## 아이콘 사용

모두 `lucide-react`에서 import:
- `Share2` -- 공유 버튼 (뷰어/편집 헤더)
- `MessageCircle` -- Discord 버튼
- `Hash` -- Slack 버튼
- `Link` -- 링크 복사 버튼
- `Loader2` -- 전송 중 스피너

---

## 미결 항목

없음.
