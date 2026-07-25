# Stage 1 — frontend-dev 완료 기록

- 담당: `frontend-dev` (model: opus)
- 완료일: 2026-07-23
- 근거 계약: [docs/agent-work/contract-stage-0.md](../agent-work/contract-stage-0.md) · [src/types/api.ts](../../src/types/api.ts)
- 결정·요청 사항: [docs/agent-work/frontend-stage-1-client-contract.md](../agent-work/frontend-stage-1-client-contract.md)

## 구현 범위 (Wave 1-B 5개 항목 전부)

1. `fetcher.ts` — 401 리다이렉트 / 429 토스트 / `ApiRequestError` 정규화, XHR 기반 진행률 업로드
2. `/login` 페이지 — Enter 제출, 실패 메시지, 로딩 상태, `?next=` 복귀(오픈 리다이렉트 차단)
3. 업로드 드롭존 — 드래그앤드롭 + 파일 선택, 파일별 진행률, 413/415/429 구분 표시
4. 토스트 — 외부 라이브러리 없이 pub/sub + `<Toaster />` 최소 구현
5. `/workspace` 골격 — 업로드 진입점(모달) + 로그아웃. GridView는 Stage 2이므로 미구현

## 변경/생성 파일

| 파일 | 내용 |
|------|------|
| `src/lib/fetcher.ts` | **구현.** `apiFetch`/`apiUpload`/`toApiRequestError`, 상태 코드 정규화, `LOGIN_PATH`·`NEXT_PARAM` export |
| `src/components/ui/toast-bus.ts` | 신규. React 비의존 토스트 pub/sub (fetcher가 여기로 발행) |
| `src/components/ui/Toaster.tsx` | 신규. `aria-live` 토스트 영역, 자동 소멸, Esc로 최근 항목 닫기 |
| `src/components/ui/Modal.tsx` | 신규. 공용 모달 — Esc 닫기 / 배경 클릭 / 포커스 트랩 / 포커스 복원 |
| `src/components/upload/upload-errors.ts` | 신규. 상태 코드 → 한글 문구 매핑 (413/415/429 구분) |
| `src/components/upload/UploadDropzone.tsx` | 신규. DnD + 파일 선택, 파일별 진행률·상태, 429 시 큐 중단 |
| `src/components/upload/UploadModal.tsx` | 신규. 대상 폴더 입력 + 드롭존을 모달로 묶음 |
| `src/app/login/page.tsx` | 신규. 로그인 폼 (`Suspense`로 `useSearchParams` 감쌈) |
| `src/app/workspace/page.tsx` | 신규. 헤더(업로드/로그아웃) + 최근 업로드 목록 + 빈 상태 |
| `src/app/layout.tsx` | 수정. `<Toaster />` 마운트, `lang="ko"`, 메타데이터 실제 값으로 교체 |
| `src/app/page.tsx` | 수정. Next 템플릿 제거 → `/workspace`로 redirect |
| `src/app/globals.css` | 수정. body 폰트를 Arial 하드코딩 → `--font-geist-sans`. **Tailwind config 파일은 만들지 않음** |

보안 파일(`env.ts`/`path-safety.ts`/`session.ts`/`rate-limit.ts`/`middleware.ts`), `.env.local`,
`src/app/api/**`는 **건드리지 않았다.**

## 계약 준수 확인 (자체 점검)

| 항목 | 확인 |
|------|------|
| 모든 API 호출이 `apiFetch`/`apiUpload` 경유 (raw fetch 0건) | ☑ |
| 401 → `/login` 리다이렉트 | ☑ (`/login`에서는 루프 방지로 생략) |
| 429 → rate limited 토스트 | ☑ (`apiFetch`) / 업로드는 인라인 표시 |
| 타입은 `@/types/api`에서만 import, 로컬 중복 정의 없음 | ☑ |
| `UPLOAD_FIELD` 상수 사용 (문자열 리터럴 금지) | ☑ |
| 413/415/429 구분 표시 | ☑ |
| Node `fs`/FTP/카카오 코드 없음 | ☑ |
| 로딩 / 빈 상태 / 에러 상태 | ☑ 로그인·업로드·워크스페이스 전 지점 |
| 키보드 접근성 (Enter 제출, Esc 모달·토스트 닫기, 포커스 링, 포커스 트랩/복원) | ☑ |
| 모든 코드가 `src/` 아래 | ☑ |

## 검증 결과 (직접 실행)

```
$ npm run typecheck   → 통과 (에러 0)
$ npm run build       → ✓ Compiled successfully / 6 static pages (/, /login, /workspace, /_not-found)
$ npm run lint        → 0 errors, 7 warnings (전부 security-auth 담당 스텁: path-safety/session/rate-limit)
                        fetcher.ts 스텁 경고 5건은 구현으로 해소됨 (12건 → 7건)
$ npm test            → 1 file / 2 tests passed
```

## 의존성 추가

없음. 토스트·모달·진행률 모두 외부 라이브러리 없이 구현했다.

## 미결 / 다음 단계로 넘긴 항목

- 업로드 성공 후 `GET /api/files` 재조회 — Stage 2. 훅 지점은 `handleUploaded`에 `TODO(Stage 2)`로 표시
- GridView / 브레드크럼 / 검색·정렬·태그 — Stage 2·3
- Monaco 에디터 + 409 충돌 UI — Stage 2 (`fetcher`는 이미 409를 코드로 올린다)
- 업로드 취소(abort) 버튼 — 미구현. 필요해지면 backlog로

## 검증 요청

> TO: `frontend-validator` — 검증 범위: `src/lib/fetcher.ts`, `src/components/ui/**`,
> `src/components/upload/**`, `src/app/login/page.tsx`, `src/app/workspace/page.tsx`,
> `src/app/layout.tsx`, `src/app/page.tsx`.
> 백엔드 라우트가 아직 없으므로 런타임 통합 검증은 Wave 4(`qa-integration`)에서 수행한다.
