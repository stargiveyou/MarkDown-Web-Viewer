# Stage 2 프론트엔드 완료 기록

- 작성: `frontend-dev` / 2026-07-24
- 계약 기준: [frontend-stage-2-contract.md](../agent-work/frontend-stage-2-contract.md)
- 타입 기준: `src/types/api.ts` (변경 없음)

---

## 구현 범위

### 신규 파일 (5건)

| 파일 | 용도 |
|------|------|
| `src/components/workspace/Breadcrumb.tsx` | 브레드크럼 내비게이션 컴포넌트 |
| `src/components/workspace/GridView.tsx` | 폴더/파일 카드 그리드 컴포넌트 |
| `src/components/workspace/ConflictWarning.tsx` | 409 충돌 경고 배너 컴포넌트 |
| `src/app/workspace/view/page.tsx` | 마크다운 뷰어 페이지 |
| `src/app/workspace/edit/page.tsx` | Monaco 에디터 페이지 (분할 뷰) |

### 수정 파일 (1건)

| 파일 | 변경 내용 |
|------|-----------|
| `src/app/workspace/page.tsx` | GridView/Breadcrumb 통합, 정렬 드롭다운, 파일 목록 조회/재조회, Suspense 래핑 |

---

## 주요 구현 사항

### Breadcrumb (`Breadcrumb.tsx`)
- `FilesResponse.breadcrumb` 세그먼트를 순서대로 렌더
- "Home" 클릭으로 루트 이동, 중간 세그먼트 클릭으로 해당 경로 이동
- 마지막 세그먼트는 텍스트(현재 위치), 빈 배열이면 "Home"만 텍스트
- lucide-react `ChevronRight`로 구분자 표시

### GridView (`GridView.tsx`)
- `grid grid-cols-2 md:grid-cols-4 gap-4` 반응형 레이아웃
- EntryType별 카드 렌더링:
  - `folder`: Folder 아이콘 + 이름 + fileCount, amber 계열 스타일
  - `markdown`: coverThumbUrl img 또는 FileText 아이콘 + title/name + snippet(2줄) + tag 칩
  - `image`: 썸네일 img + 파일명 + 크기
  - `other`: File 아이콘 + 파일명 + 크기 (클릭 불가)
- 빈 폴더 상태: "이 폴더는 비어 있습니다" 메시지
- 모든 이미지는 `<img>` 태그만 사용 (D2-1: SVG XSS 방어)
- `loading="lazy"` 설정, alt 속성에 파일명

### ConflictWarning (`ConflictWarning.tsx`)
- 노란/주황 경고 배너 (에디터 상단)
- "이 파일이 다른 곳에서 수정되었습니다" 안내 텍스트
- "내용 복사" 버튼: `navigator.clipboard.writeText()` + 성공 토스트
- "새로고침" 버튼: `window.location.reload()`
- "닫기" 버튼: 경고 숨기기 (저장은 여전히 409)
- 덮어쓰기 버튼 없음 (보안 불변식 5 준수)

### ViewerPage (`view/page.tsx`)
- `apiFetch<FileContentResponse>`로 파일 내용 로드
- `react-markdown` + `remark-gfm` + `rehype-highlight`로 렌더
- 이미지 참조 변환: 상대 경로를 `/api/thumbnail?path=...&w=800`으로 변환
- 외부 URL (http/https)은 그대로 통과
- `MarkdownHooks` 사용 (rehype-highlight 호환)
- 코드 하이라이트: `highlight.js/styles/github.css` import
- "목록으로" 버튼: 부모 디렉터리 GridView로 이동
- "편집" 버튼: `/workspace/edit?path=...`으로 이동
- Suspense 래핑 (useSearchParams 요구사항)
- 로딩/에러 상태 처리

### EditorPage (`edit/page.tsx`)
- 좌우 분할: 좌측 Monaco 에디터 + 우측 react-markdown 실시간 미리보기
- Monaco 설정: `language="markdown"`, `theme="vs-dark"`, wordWrap on, minimap 비활성화
- 상태 관리: content, baseMtime, isDirty, saving, conflict
- Cmd+S / Ctrl+S 저장 단축키
- 저장: `PUT /api/file-content` via `apiFetch`
  - 성공: baseMtime 갱신, isDirty 해제, 성공 토스트
  - 409: ConflictWarning 표시, 에러 토스트
  - 기타 에러: 에러 토스트
- 저장 중 중복 요청 방지 (savingRef)
- beforeunload 경고 (isDirty일 때)
- "뷰어로" 버튼: isDirty면 confirm 대화상자 후 이동
- "수정됨" 뱃지 표시
- Suspense 래핑

### WorkspacePage 확장 (`page.tsx`)
- `useSearchParams`로 `path` 쿼리 읽기
- `loadFiles()` 함수로 `GET /api/files?path=...&sort=...` 호출
- `refreshKey` 카운터로 재조회 트리거 (lint 규칙 준수)
- Breadcrumb + GridView 렌더링
- 정렬 드롭다운: 수정일(기본), 이름 A-Z, 파일 크기
- 업로드 성공 후 `refreshKey++`로 목록 재조회 (Stage 1 TODO 해소)
- Stage 1의 "최근 업로드" 섹션 제거 (D2-6: GridView가 대체)
- 업로드 모달에 `initialTargetPath={currentPath}` 전달
- 로딩/에러 상태 UI
- Suspense 래핑

---

## 설계 결정

| # | 결정 | 이유 |
|---|------|------|
| D2-1 | 모든 이미지를 `<img>` 태그로만 렌더 | SVG XSS 방어. eslint-disable 주석으로 `@next/next/no-img-element` 경고 억제 |
| D2-3 | Monaco CDN 로딩 (기본) | ngrok으로 인터넷 접근 가능. 로컬 번들링 비대 회피 |
| D2-4 | 쿼리 파라미터 기반 라우팅 | 동적 세그먼트보다 단순. URL과 폴더 구조 분리 |
| D2-5 | 409 시 덮어쓰기 불허 | 보안 불변식 5 준수 |
| D2-6 | "최근 업로드" 섹션 제거 | GridView가 동일 역할 수행 |
| D2-7 | 뷰어/에디터를 별도 페이지로 분리 | Monaco 번들을 GridView에서 로딩하지 않기 위함 |
| D2-8 | 방법 A (409 코드만 감지) | raw fetch 사용 시 401 처리 누락 위험 |
| -- | `MarkdownHooks` 사용 | 린터가 `Markdown` 대신 `MarkdownHooks`로 변환 (rehype-highlight 비동기 호환) |
| -- | `Suspense` 래핑 | Next.js App Router에서 `useSearchParams` 사용 시 필수 |
| -- | `refreshKey` 카운터 패턴 | `react-hooks/set-state-in-effect` lint 규칙 준수를 위해 effect 내 직접 setState 대신 IIFE + 카운터 트리거 |

---

## 검증 결과

```
npm run typecheck  -> 통과 (에러 0)
npm run lint       -> 통과 (에러 0, 경고 0)
npm run build      -> 통과 (성공)
```

---

## 미결 항목

- 검색 바 / 태그 칩 UI -> Stage 3
- 공유 버튼 / Discord/Slack 공유 모달 -> Stage 4
- 업로드 완료 알림 -> Stage 5
- 다크모드 토글 -> 기존 `dark:` 클래스로 시스템 설정 따름 (별도 구현 불필요)

---

## API 의존성

| API | 사용처 |
|-----|--------|
| `GET /api/files?path=&sort=` | WorkspacePage |
| `GET /api/file-content?path=` | ViewerPage, EditorPage |
| `PUT /api/file-content` | EditorPage |
| `GET /api/thumbnail?path=&w=` | GridView (coverThumbUrl), ViewerPage/EditorPage (이미지 참조 변환) |
