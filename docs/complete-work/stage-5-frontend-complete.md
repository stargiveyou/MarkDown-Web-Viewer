# Stage 5 Frontend 완료 기록

- 작성: `frontend-dev` / 2026-07-25
- 범위: Wave 1-B -- UploadDropzone 알림 상태 표시

---

## 변경 파일

| 파일 | 변경 유형 | 설명 |
|------|-----------|------|
| `src/components/upload/UploadDropzone.tsx` | 수정 | `notified` 필드를 추적하여 토스트 메시지에 알림 상태 반영 |

---

## 구현 범위

### UploadDropzone 알림 상태 표시

`runQueue` 함수에서 `UploadResponse.notified` 필드를 추적하여, 업로드 성공 토스트 메시지에 알림 전송 여부를 반영한다.

**변경 내용:**

1. `runQueue` 함수 시작부에 `let notifiedAny = false;` 선언 추가 (97행)
2. 각 `apiUpload<UploadResponse>` 성공 응답에서 `res?.notified`가 truthy이면 `notifiedAny = true` 설정 (117행)
3. 토스트 메시지 구성 로직 변경 (134~137행):
   - 기존: `"N개 파일을 업로드했습니다."`
   - 변경: Webhook 알림 성공 시 `"N개 파일을 업로드했습니다. (알림 전송됨)"`, 미발송 시 기존과 동일

**동작 규칙:**
- 하나라도 `notified: true`인 응답이 있으면 "(알림 전송됨)" 표시
- 전부 `notified: false`이거나 Webhook 미설정이면 기본 메시지만 표시
- 업로드 흐름(드래그앤드롭, 파일 선택, 진행률, 에러 처리)에 변경 없음

---

## 변경하지 않은 것

- 업로드 흐름 (순차 전송, 429 중단, 401 리다이렉트) -- 기존 동작 그대로
- `apiUpload` 사용 -- raw fetch/XHR 사용 없음
- 에러 처리 로직 -- `toUploadFailure` 기존 흐름 유지
- 타입 정의 -- `UploadResponse.notified: boolean`은 이미 `src/types/api.ts`에 정의됨

---

## 검증 결과

| 검증 | 결과 |
|------|------|
| `npm run typecheck` | PASS -- 오류 0 |
| `npm run lint` | PASS -- 오류 0 |
| `npm run build` | PASS -- 성공 (경고 1건은 기존 NFT 경고, 이번 변경과 무관) |

---

## 미결 항목

없음. frontend-validator 검증 대기.
