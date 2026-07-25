# 프론트 클라이언트 계약 -- Stage 2

- 작성: `tech-lead` / 2026-07-24
- 상태: **확정** (frontend-dev는 이 계약에 따라 구현한다)
- 타입 기준: [src/types/api.ts](../../src/types/api.ts) -- **변경하지 않는다**
- API 계약: [backend-stage-2-contract.md](backend-stage-2-contract.md)
- 기존 인프라: [frontend-stage-1-client-contract.md](frontend-stage-1-client-contract.md)

---

## 0. 기존 인프라 (Stage 1에서 완성됨)

frontend-dev가 새로 만들 필요 없이 import해서 쓸 것:

| 모듈 | 함수/컴포넌트 | 용도 |
|------|---------------|------|
| `@/lib/fetcher` | `apiFetch<T>()` | 모든 API JSON 호출 (401 리다이렉트, 429 토스트 자동) |
| `@/lib/fetcher` | `ApiRequestError` | 에러 코드 분기 (`err.code === 409` 등) |
| `@/lib/fetcher` | `toApiRequestError()` | unknown -> ApiRequestError 변환 |
| `@/components/ui/toast-bus` | `emitToast()` | 토스트 발행 (비컴포넌트에서도 사용 가능) |
| `@/components/ui/Modal` | `<Modal>` | 모달 (포커스 트랩, Esc 닫기) |
| `@/components/ui/Toaster` | `<Toaster>` | layout.tsx에 이미 마운트됨 |
| `@/components/upload/UploadModal` | `<UploadModal>` | 업로드 모달 (Stage 1 완성) |
| `@/types/api` | 모든 타입 | 요청/응답 타입 |

---

## 1. 라우팅 구조

| URL | 페이지 파일 | 컴포넌트 | 용도 |
|-----|-------------|----------|------|
| `/workspace` | `src/app/workspace/page.tsx` | WorkspacePage (확장) | GridView |
| `/workspace?path=subfolder` | 같은 파일 | 같은 컴포넌트 | 하위 폴더 GridView |
| `/workspace/view?path=file.md` | `src/app/workspace/view/page.tsx` | ViewerPage (신규) | 마크다운 뷰어 |
| `/workspace/edit?path=file.md` | `src/app/workspace/edit/page.tsx` | EditorPage (신규) | Monaco 에디터 |

### 라우팅 규칙

- `/workspace`의 `path` 쿼리가 없으면 루트 (`""`)로 GET /api/files 호출
- 폴더 카드 클릭 -> `router.push('/workspace?path=' + encodeURIComponent(subpath))`
- 마크다운 카드 클릭 -> `router.push('/workspace/view?path=' + encodeURIComponent(subpath))`
- 뷰어의 "편집" 버튼 -> `router.push('/workspace/edit?path=' + encodeURIComponent(path))`
- 에디터에서 뒤로가기 -> 뷰어로 (`router.back()` 또는 명시적 뷰어 URL)

---

## 2. API 호출 패턴

### `GET /api/files`

```typescript
import { apiFetch } from '@/lib/fetcher';
import type { FilesResponse } from '@/types/api';

const data = await apiFetch<FilesResponse>(
  `/api/files?path=${encodeURIComponent(path)}&sort=${sort}`
);
// data.breadcrumb: string[]
// data.entries: FileEntry[]
```

tag 필터 추가 시:
```typescript
const url = `/api/files?path=${encodeURIComponent(path)}&sort=${sort}&tag=${encodeURIComponent(tag)}`;
```

### `GET /api/file-content`

```typescript
import type { FileContentResponse } from '@/types/api';

const data = await apiFetch<FileContentResponse>(
  `/api/file-content?path=${encodeURIComponent(path)}`
);
// data.content: string  (frontmatter 포함 원본)
// data.mtime: number    (baseMtime으로 보관)
```

### `PUT /api/file-content`

```typescript
import type { SaveFileRequest, SaveFileResponse, SaveConflictResponse } from '@/types/api';

const body: SaveFileRequest = { path, content, baseMtime };

try {
  const data = await apiFetch<SaveFileResponse>('/api/file-content', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  // 성공: data.mtime으로 baseMtime 갱신
  setBaseMtime(data.mtime);
} catch (err) {
  const error = toApiRequestError(err);
  if (error.code === 409) {
    // 충돌: ConflictWarning 표시
    // 409 응답 바디에 currentMtime이 있다 -- apiFetch는 throw하므로 바디 접근 불가
    // -> 별도 처리 필요 (아래 "409 처리" 참조)
  }
}
```

#### 409 처리 상세

`apiFetch`는 실패 시 `ApiRequestError`를 throw하므로 409 바디(`SaveConflictResponse`)에 직접 접근할 수 없다. 두 가지 접근법 중 하나를 선택한다:

**방법 A (권장)**: 409임을 코드로 감지하고, 사용자에게 "파일이 외부에서 변경되었습니다" 경고를 띄운다. `currentMtime`은 부가 정보이므로 없어도 경고는 동작한다.

**방법 B**: PUT 요청만 `apiFetch` 대신 raw fetch를 사용해 409 바디를 직접 읽는다. 이 경우 401 리다이렉트 처리를 직접 해야 한다. **비추천** -- 복잡도 대비 이득이 적다.

```typescript
// 방법 A 예시:
catch (err) {
  const error = toApiRequestError(err);
  if (error.code === 409) {
    setConflict(true);
    emitToast({ message: '파일이 외부에서 변경되었습니다.', variant: 'error' });
    return;
  }
  // 그 외 에러
  emitToast({ message: error.message, variant: 'error' });
}
```

---

## 3. 컴포넌트 명세

### 3.1 GridView (`src/components/workspace/GridView.tsx`)

**Props**:
```typescript
interface GridViewProps {
  entries: FileEntry[];
  onFolderClick: (subpath: string) => void;
  onFileClick: (entry: FileEntry) => void;
}
```

**레이아웃**:
- `grid grid-cols-2 md:grid-cols-4 gap-4`
- 빈 상태: "이 폴더는 비어 있습니다" 메시지

**카드 렌더링 (EntryType별)**:

| type | 아이콘/이미지 | 주 텍스트 | 부 텍스트 | 클릭 |
|------|---------------|-----------|-----------|------|
| `folder` | `lucide-react` `Folder` 아이콘 | `entry.name` | `${fileCount}개 항목` | `onFolderClick(subpath)` |
| `markdown` | `coverThumbUrl`이 있으면 `<img>`, 없으면 `lucide-react` `FileText` | `entry.title \|\| entry.name` | `entry.snippet` (최대 2줄) + 태그 칩 | `onFileClick(entry)` |
| `image` | `<img src={coverThumbUrl}>` | `entry.name` | 파일 크기 | `onFileClick(entry)` |
| `other` | `lucide-react` `File` 아이콘 | `entry.name` | 파일 크기 | 없음 |

**이미지 렌더링 규칙**:
- 모든 이미지는 `<img>` 태그로만 렌더한다 (D2-1: SVG XSS 방어)
- 썸네일 URL은 서버가 `coverThumbUrl`에 이미 `/api/thumbnail?...` 형태로 제공한다
- `<img>` 태그에 `loading="lazy"` 추가 (스크롤 시 지연 로딩)
- alt 속성에 파일명 설정

**태그 칩**:
- `entry.tags`가 있으면 카드 하단에 작은 뱃지로 표시
- 스타일: `inline-flex rounded-full bg-zinc-200 px-2 py-0.5 text-xs` (다크모드 대응)

### 3.2 Breadcrumb (`src/components/workspace/Breadcrumb.tsx`)

**Props**:
```typescript
interface BreadcrumbProps {
  segments: string[];  // FilesResponse.breadcrumb
  onNavigate: (pathUpTo: number) => void;  // 세그먼트 인덱스 클릭 시 호출
}
```

**렌더링**:
```
Home > 2026-Travel > Jeju
 ^        ^           ^
link     link       현재(텍스트)
```

- "Home" 클릭 -> `onNavigate(-1)` (루트로)
- 중간 세그먼트 클릭 -> `onNavigate(index)` -> path = segments.slice(0, index+1).join('/')
- 마지막 세그먼트는 일반 텍스트 (현재 위치)
- 구분자: `>` 또는 `lucide-react` `ChevronRight`
- 빈 배열이면 "Home"만 표시 (링크 아닌 텍스트)

### 3.3 WorkspacePage 확장 (`src/app/workspace/page.tsx`)

기존 Stage 1 골격을 유지하면서 확장한다.

**기존 유지 항목**:
- `uploadOpen`, `setUploadOpen` -- 업로드 모달
- `loggingOut`, `handleLogout` -- 로그아웃
- `<UploadModal>` -- 업로드 진입점

**추가 항목**:
- `const searchParams = useSearchParams()`
- `const currentPath = searchParams.get('path') || ''`
- `apiFetch<FilesResponse>('/api/files?path=...')` 호출 (useEffect 또는 useSWR 등)
- 로딩 상태 / 에러 상태 처리
- `<Breadcrumb>` + `<GridView>` 렌더링
- 정렬 드롭다운 (SortKey: mtime/name/size)
- `handleUploaded` 수정: 업로드 성공 후 파일 목록 **재조회** (TODO 해소)

**Stage 1의 "최근 업로드" 섹션**은 제거한다 -- GridView가 이를 대체한다.

**헤더 구성**:
```
[MD Workspace]                    [정렬: v] [업로드] [로그아웃]
Home > FolderA > FolderB
[카드 그리드 ...]
```

### 3.4 ViewerPage (`src/app/workspace/view/page.tsx`)

**`'use client'`**

```
[< 목록으로]                                    [편집]
---
# 마크다운 제목

본문 내용...

![이미지](./photo.jpg)  <-- /api/thumbnail?path=... 로 변환
---
```

**구현 지침**:

1. `useSearchParams`에서 `path` 읽기. 없으면 `/workspace`로 리다이렉트
2. `apiFetch<FileContentResponse>('/api/file-content?path=...')` 호출
3. `react-markdown` + `remark-gfm` + `rehype-highlight`로 렌더:
   ```typescript
   import ReactMarkdown from 'react-markdown';
   import remarkGfm from 'remark-gfm';
   import rehypeHighlight from 'rehype-highlight';
   ```
4. **이미지 참조 변환**: react-markdown의 `components.img` 커스텀 렌더러에서:
   - 외부 URL (http/https)은 그대로 `<img src={src}>`
   - 상대 경로 (`./photo.jpg`, `photo.jpg`)는 현재 파일의 디렉터리 기준으로 해석:
     ```typescript
     const dir = path.substring(0, path.lastIndexOf('/'));
     const imagePath = dir ? `${dir}/${src}` : src;
     const thumbnailUrl = `/api/thumbnail?path=${encodeURIComponent(imagePath)}&w=800`;
     ```
   - 변환된 URL을 `<img src={thumbnailUrl}>` 로 렌더
   - **`<img>` 태그만 사용** -- SVG도 img로 렌더되므로 XSS 무관
5. "목록으로" 버튼: 현재 파일의 부모 디렉터리로 이동
   ```typescript
   const parentPath = path.substring(0, path.lastIndexOf('/'));
   router.push(`/workspace?path=${encodeURIComponent(parentPath)}`);
   ```
6. "편집" 버튼: `/workspace/edit?path=...`으로 이동
7. 코드 하이라이트 CSS: `rehype-highlight`의 테마 CSS를 import (예: `highlight.js/styles/github.css`)

### 3.5 EditorPage (`src/app/workspace/edit/page.tsx`)

**`'use client'`**

```
[< 뷰어로]              [저장 (Cmd+S)]  [저장 중...]
+-------------------+-------------------+
|                   |                   |
|  Monaco Editor    |  react-markdown   |
|  (편집)            |  (미리보기)        |
|                   |                   |
+-------------------+-------------------+
```

**구현 지침**:

1. `useSearchParams`에서 `path` 읽기. 없으면 `/workspace`로 리다이렉트
2. 파일 로드: `apiFetch<FileContentResponse>('/api/file-content?path=...')`
3. 상태 관리:
   ```typescript
   const [content, setContent] = useState('');
   const [baseMtime, setBaseMtime] = useState(0);
   const [isDirty, setIsDirty] = useState(false);
   const [saving, setSaving] = useState(false);
   const [conflict, setConflict] = useState(false);
   ```
4. **Monaco 설정**:
   ```typescript
   import Editor from '@monaco-editor/react';

   <Editor
     language="markdown"
     value={content}
     onChange={(value) => {
       setContent(value ?? '');
       setIsDirty(true);
     }}
     options={{
       minimap: { enabled: false },
       wordWrap: 'on',
       lineNumbers: 'on',
       fontSize: 14,
     }}
   />
   ```
5. **미리보기**: 에디터 우측에 `react-markdown`으로 실시간 렌더 (동일한 이미지 변환 로직 적용)
6. **분할 레이아웃**: `flex` 또는 `grid grid-cols-2`로 좌우 50:50 분할
7. **Cmd+S 저장**:
   ```typescript
   useEffect(() => {
     const handler = (e: KeyboardEvent) => {
       if ((e.metaKey || e.ctrlKey) && e.key === 's') {
         e.preventDefault();
         handleSave();
       }
     };
     window.addEventListener('keydown', handler);
     return () => window.removeEventListener('keydown', handler);
   }, [handleSave]);
   ```
8. **저장 로직** (`handleSave`):
   - `saving`이 true면 무시 (중복 방지)
   - `setSaving(true)`
   - PUT 요청 -> 성공 시 `setBaseMtime(data.mtime)`, `setIsDirty(false)`, 성공 토스트
   - 409 시 `setConflict(true)` + 에러 토스트
   - 그 외 에러: 에러 토스트
   - finally: `setSaving(false)`
9. **미저장 이탈 경고**:
   ```typescript
   useEffect(() => {
     const handler = (e: BeforeUnloadEvent) => {
       if (isDirty) e.preventDefault();
     };
     window.addEventListener('beforeunload', handler);
     return () => window.removeEventListener('beforeunload', handler);
   }, [isDirty]);
   ```
10. "뷰어로" 버튼: `/workspace/view?path=...`으로 이동 (isDirty면 확인 대화상자)

### 3.6 ConflictWarning (`src/components/workspace/ConflictWarning.tsx`)

**Props**:
```typescript
interface ConflictWarningProps {
  visible: boolean;
  onDismiss: () => void;
}
```

**UI**:
- 노란색/주황색 경고 배너 (에디터 상단에 표시)
- 텍스트: "이 파일이 다른 곳에서 수정되었습니다. 현재 편집 내용을 복사한 뒤 페이지를 새로고침하세요."
- "내용 복사" 버튼: `navigator.clipboard.writeText(content)` -> 성공 토스트
- "새로고침" 버튼: `window.location.reload()`
- **덮어쓰기 버튼은 제공하지 않는다** (보안 불변식 5)
- "닫기" 버튼: `onDismiss()` -- 경고를 숨기되, 저장은 여전히 409로 실패한다

---

## 4. 결정 사항

| # | 결정 | 이유 |
|---|------|------|
| D2-1 | SVG는 `<img>`로만 렌더 | 저장형 XSS 차단. sanitize 의존성 불필요 |
| D2-3 | Monaco CDN 로딩 | ngrok으로 인터넷 접근 가능. 로컬 번들링은 빌드 비대 |
| D2-4 | 쿼리 파라미터 기반 라우팅 | 동적 세그먼트보다 단순. 폴더 구조와 URL이 분리됨 |
| D2-5 | 409 시 덮어쓰기 불허 | 보안 불변식 5 -- 비파괴적 경고만 |
| D2-6 | Stage 1 "최근 업로드" 섹션 제거 | GridView가 동일 역할을 수행 |
| D2-7 | 뷰어/에디터를 별도 페이지로 분리 | Monaco 번들을 GridView에서 로딩하지 않기 위함 |
| D2-8 | 방법 A (409 코드만 감지) 권장 | raw fetch 사용 시 401 처리 누락 위험 |

---

## 5. 프론트가 이 단계에서 만들지 않는 것

- 검색 바 / 태그 칩 UI -- Stage 3
- 공유 버튼 / Discord/Slack 공유 모달 -- Stage 4
- 업로드 완료 알림 -- Stage 5
- 파일 삭제 / 이름 변경 -- 현재 스코프 밖
- 다크모드 토글 -- 기존 `dark:` 클래스로 시스템 설정 따름

---

## 6. 파일 목록 (신규 생성 / 수정)

### 신규 생성

| 파일 | 용도 |
|------|------|
| `src/app/workspace/view/page.tsx` | 마크다운 뷰어 페이지 |
| `src/app/workspace/edit/page.tsx` | Monaco 에디터 페이지 |
| `src/components/workspace/GridView.tsx` | 카드 그리드 컴포넌트 |
| `src/components/workspace/Breadcrumb.tsx` | 브레드크럼 내비게이션 |
| `src/components/workspace/ConflictWarning.tsx` | 409 충돌 경고 UI |

### 수정

| 파일 | 변경 내용 |
|------|-----------|
| `src/app/workspace/page.tsx` | GridView/Breadcrumb 통합, 정렬 드롭다운, 목록 재조회 |

---

## 계약 변경 절차

이 문서의 내용을 변경해야 하는 상황이 생기면:
1. 이 문서를 먼저 갱신한다 (코드보다 문서가 먼저)
2. `tech-lead`에게 승인을 받는다
3. backend-dev에게 변경 사항을 전달한다
