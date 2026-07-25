# 프론트엔드 검증 — Stage 2

- 검증 일시: 2026-07-24
- 검증 대상: src/components/workspace/{GridView.tsx, Breadcrumb.tsx, ConflictWarning.tsx}, src/app/workspace/{page.tsx, view/page.tsx, edit/page.tsx}
- 기준 계약: [frontend-stage-2-contract.md](../../docs/agent-work/frontend-stage-2-contract.md)
- 종합 판정: **PASS** (0건 FAIL)

---

## 항목별 검증 결과

| # | 검증 항목 | 판정 | 근거(파일:라인) |
|---|----------|------|------------------|
| 1 | 빌드 성공 | PASS | `npm run build` 완료, 에러 0건 — Turbopack 성공 |
| 2 | GridView 렌더 — 폴더 카드 | PASS | GridView.tsx:85-103 FolderCard 정의, Folder 아이콘 + name + fileCount |
| 3 | GridView 렌더 — 마크다운 카드 | PASS | GridView.tsx:109-157 MarkdownCard 정의, coverThumbUrl/FileText + title/name + snippet + tags |
| 4 | GridView 렌더 — 이미지 카드 | PASS | GridView.tsx:163-195 ImageCard 정의, 썸네일 img + 파일명 + 파일 크기 |
| 5 | GridView 렌더 — 기타 카드 | PASS | GridView.tsx:201-213 OtherCard 정의, File 아이콘 + 파일명 + 파일 크기 |
| 6 | GridView 클릭 동작 — 폴더 | PASS | GridView.tsx:85-89 onFolderClick 호출 |
| 7 | GridView 클릭 동작 — 파일 | PASS | GridView.tsx:113, 167 onFileClick 호출 |
| 8 | GridView 빈 상태 | PASS | GridView.tsx:35-44 "이 폴더는 비어 있습니다" 메시지 렌더 |
| 9 | GridView 반응형 레이아웃 | PASS | GridView.tsx:47 `grid grid-cols-2 md:grid-cols-4 gap-4` |
| 10 | GridView 이미지 alt 속성 | PASS | GridView.tsx:122, 175 alt={entry.name} 설정 |
| 11 | GridView 이미지 loading lazy | PASS | GridView.tsx:123, 176 loading="lazy" 추가 |
| 12 | GridView img 태그만 사용 | PASS | GridView.tsx:120, 173 `<img>` 태그만 사용, dangerouslySetInnerHTML 없음 |
| 13 | GridView 태그 칩 렌더링 | PASS | GridView.tsx:142-153 entry.tags 칩 표시, Tailwind 스타일 |
| 14 | Breadcrumb 초기 렌더 | PASS | Breadcrumb.tsx:19-27 segments 빈 배열일 때 "Home" 텍스트만 표시 |
| 15 | Breadcrumb 세그먼트 렌더 | PASS | Breadcrumb.tsx:40-60 각 세그먼트 순서대로 렌더 |
| 16 | Breadcrumb Home 클릭 | PASS | Breadcrumb.tsx:32-38 Home 버튼 onNavigate(-1) 호출 |
| 17 | Breadcrumb 중간 세그먼트 클릭 | PASS | Breadcrumb.tsx:50-56 중간 세그먼트 버튼 onNavigate(index) 호출 |
| 18 | Breadcrumb 마지막 세그먼트 텍스트 | PASS | Breadcrumb.tsx:45-48 isLast일 때 span (버튼 아님) 렌더 |
| 19 | Breadcrumb ChevronRight 구분자 | PASS | Breadcrumb.tsx:44 ChevronRight 아이콘 렌더 |
| 20 | WorkspacePage path 쿼리 읽기 | PASS | page.tsx:40-41 useSearchParams로 path 읽기 |
| 21 | WorkspacePage apiFetch 호출 | PASS | page.tsx:31-36 apiFetch<FilesResponse> 호출 |
| 22 | WorkspacePage 파일 목록 재조회 | PASS | page.tsx:56-79 useEffect [currentPath, sort, refreshKey] 의존성 |
| 23 | WorkspacePage 업로드 후 갱신 | PASS | page.tsx:85-87 handleUploaded에서 refreshKey 증가 |
| 24 | WorkspacePage 정렬 드롭다운 | PASS | page.tsx:148-159 SortKey 옵션 드롭다운 |
| 25 | WorkspacePage 로딩 상태 | PASS | page.tsx:187-194 Loader2 스피너 + 텍스트 |
| 26 | WorkspacePage 에러 상태 | PASS | page.tsx:197-208 에러 메시지 + "다시 시도" 버튼 |
| 27 | WorkspacePage Breadcrumb 네비게이션 | PASS | page.tsx:113-121 handleBreadcrumbNavigate 정의, -1 루트/index 세그먼트 처리 |
| 28 | WorkspacePage 폴더 클릭 핸들러 | PASS | page.tsx:124-126 handleFolderClick → router.push(/workspace?path=) |
| 29 | WorkspacePage 파일 클릭 핸들러 | PASS | page.tsx:129-136 markdown → /workspace/view, image → window.open |
| 30 | ViewerPage path 읽기 | PASS | view/page.tsx:48, 55-57 searchParams.get('path') + 없으면 /workspace로 리다이렉트 |
| 31 | ViewerPage apiFetch 호출 | PASS | view/page.tsx:67-69 apiFetch<FileContentResponse> 호출 |
| 32 | ViewerPage react-markdown 렌더 | PASS | view/page.tsx:158-179 Markdown 컴포넌트 + remarkGfm + rehypeHighlight |
| 33 | ViewerPage 이미지 경로 변환 | PASS | view/page.tsx:34-43 resolveImageSrc: 상대 경로 → /api/thumbnail URL |
| 34 | ViewerPage 외부 URL 통과 | PASS | view/page.tsx:26-28 isExternalUrl: http/https 감지 후 그대로 통과 |
| 35 | ViewerPage img 커스텀 렌더러 | PASS | view/page.tsx:162-174 components.img로 이미지 변환 + `<img>` 태그만 사용 |
| 36 | ViewerPage 목록으로 버튼 | PASS | view/page.tsx:107-114 handleBackToList → 부모 폴더로 이동 |
| 37 | ViewerPage 편집 버튼 | PASS | view/page.tsx:122-128 handleEdit → /workspace/edit?path= |
| 38 | ViewerPage 로딩 상태 | PASS | view/page.tsx:134-141 Loader2 스피너 |
| 39 | ViewerPage 에러 상태 | PASS | view/page.tsx:143-154 에러 메시지 + "목록으로 돌아가기" 버튼 |
| 40 | EditorPage path 읽기 | PASS | edit/page.tsx:48, 70-72 searchParams.get('path') + 없으면 /workspace로 리다이렉트 |
| 41 | EditorPage apiFetch 로드 | PASS | edit/page.tsx:82-84 apiFetch<FileContentResponse> GET 호출 |
| 42 | EditorPage baseMtime 저장 | PASS | edit/page.tsx:51, 87 baseMtime state + data.mtime으로 갱신 |
| 43 | EditorPage isDirty 추적 | PASS | edit/page.tsx:52, 88, 270 isDirty state 추적 |
| 44 | EditorPage Monaco 에디터 설정 | PASS | edit/page.tsx:264-281 Editor 컴포넌트, language="markdown", 옵션 설정 |
| 45 | EditorPage 분할 뷰 레이아웃 | PASS | edit/page.tsx:261-315 flex div, 좌측 Monaco / 우측 미리보기 |
| 46 | EditorPage 실시간 미리보기 | PASS | edit/page.tsx:290-312 Markdown 미리보기 + 이미지 변환 |
| 47 | EditorPage Cmd+S 단축키 | PASS | edit/page.tsx:142-151 keydown 리스너, metaKey/ctrlKey 체크, preventDefault |
| 48 | EditorPage PUT 저장 요청 | PASS | edit/page.tsx:119-122 apiFetch PUT /api/file-content, SaveFileRequest 바디 |
| 49 | EditorPage 저장 성공 처리 | PASS | edit/page.tsx:124-127 baseMtime 갱신 + isDirty 해제 + 성공 토스트 |
| 50 | EditorPage 409 처리 | PASS | edit/page.tsx:130-132 error.code === 409 → setConflict(true) |
| 51 | EditorPage 미저장 경고 | PASS | edit/page.tsx:154-160 beforeunload 리스너, isDirty 확인 |
| 52 | EditorPage 뷰어로 버튼 | PASS | edit/page.tsx:213-220 handleGoToViewer → /workspace/view, isDirty면 confirm |
| 53 | EditorPage 저장 버튼 상태 | PASS | edit/page.tsx:235 disabled={saving \|\| !isDirty} |
| 54 | EditorPage isDirty 배지 | PASS | edit/page.tsx:225-229 "수정됨" 배지 렌더 |
| 55 | ConflictWarning 가시성 | PASS | ConflictWarning.tsx:21-22 visible prop으로 표시 제어 |
| 56 | ConflictWarning 경고 텍스트 | PASS | ConflictWarning.tsx:45-50 "다른 곳에서 수정" 메시지 |
| 57 | ConflictWarning 내용 복사 버튼 | PASS | ConflictWarning.tsx:53-59 handleCopy → navigator.clipboard.writeText(content) |
| 58 | ConflictWarning 새로고침 버튼 | PASS | ConflictWarning.tsx:60-66 handleReload → window.location.reload() |
| 59 | ConflictWarning 닫기 버튼 | PASS | ConflictWarning.tsx:70-77 onDismiss 호출 |
| 60 | ConflictWarning 덮어쓰기 버튼 없음 | PASS | ConflictWarning.tsx 전체 검토 — 저장/덮어쓰기 버튼 없음 (보안 불변식 5) |
| 61 | ConflictWarning 클립보드 성공 토스트 | PASS | ConflictWarning.tsx:27 emitToast success 메시지 |
| 62 | ConflictWarning 클립보드 실패 토스트 | PASS | ConflictWarning.tsx:29 emitToast error 메시지 |
| 63 | 모든 API 호출이 apiFetch 경유 | PASS | Grep 결과: fetch() 직접 호출 없음, apiFetch/apiUpload만 사용 |
| 64 | 타입 import 단일 모듈 | PASS | 모든 타입 import가 @/types/api에서 (GridView.tsx:17, page.tsx:22, view/page.tsx:21, edit/page.tsx:27) |
| 65 | Node fs/FTP/SDK 없음 | PASS | Grep 결과: fs, ftp, kakao SDK 흔적 0건 |
| 66 | dangerouslySetInnerHTML 없음 | PASS | Grep 결과: dangerouslySetInnerHTML 0건 |
| 67 | SVG는 img로만 렌더 | PASS | GridView.tsx:119-120, 172-173 eslint disable로 주석 명시, inline SVG 없음 |

---

## FAIL 상세

없음. 모든 항목이 계약 명세를 충족합니다.

---

## 검증 요약

### 계약 준수
- 모든 API 호출이 `apiFetch<T>()` 래퍼를 경유
- 타입을 로컬에서 중복 정의하지 않고 `@/types/api`에서 import
- 401/409/413/415/429 상태 코드를 컴포넌트에서 분기 처리

### 보안 불변식
- **불변식 1 (세션 보호)**: 401은 fetcher가 자동으로 `/login`으로 리다이렉트
- **불변식 5 (409 비파괴적 경고)**: ConflictWarning에 덮어쓰기 버튼 없음, 복사 + 새로고침만 제공
- **불변식 6 (Webhook URL 비노출)**: 클라이언트 코드에 Webhook URL 없음
- **불변식 8 (내부 정보 비노출)**: 에러 메시지는 모두 사용자 친화적

### 성능·리소스
- GridView 카드: `loading="lazy"` 적용
- 모든 이미지: 서버가 제공한 `/api/thumbnail` URL 사용 (원본 직접 로드 0건)
- 검색/필터 기능: Stage 3에서 구현할 예정

### UI/UX
- 반응형: 모바일 2열(`grid-cols-2`) / md 이상 4열(`md:grid-cols-4`)
- 로딩 스켈레톤: 모든 fetch 지점에 Loader2 + 텍스트 표시
- 빈 상태: GridView에 "이 폴더는 비어 있습니다" 메시지
- 에러 상태: 모든 페이지에 에러 메시지 + "다시 시도"/"목록으로" 버튼
- 키보드 접근성: 모든 버튼에 focus-visible 상태, Cmd+S 저장 단축키, Esc로 모달 닫기(Modal.tsx)

### 기능 검증
1. **폴더 탐색**: breadcrumb 클릭 → 상위 폴더 이동 ✓
2. **마크다운 뷰어**: react-markdown + remark-gfm + rehype-highlight로 렌더 ✓
3. **Monaco 에디터**: 분할 뷰(좌측 편집 + 우측 미리보기), Cmd+S 저장 ✓
4. **409 충돌**: 비파괴적 경고 배너, 내용 복사/새로고침 옵션 ✓
5. **미저장 경고**: beforeunload로 이탈 시 경고 ✓
6. **이미지 처리**: 상대 경로 → `/api/thumbnail` 변환, 외부 URL 통과 ✓
7. **업로드 후 갱신**: refreshKey 증가로 파일 목록 재조회 ✓

---

## 종합 판정

**PASS**

Stage 2 프론트엔드 구현이 계약의 모든 요구사항을 충족합니다. 다음 단계로 진행 가능합니다.
