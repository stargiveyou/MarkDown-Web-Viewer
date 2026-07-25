# Frontend Stage 4 계약 -- 소셜 공유 UI (Discord / Slack)

- 작성: `tech-lead` / 2026-07-25
- 상태: **확정**
- 타입 기준: [src/types/api.ts](../../src/types/api.ts)
- 결정 참조: [stage-4-tasks.md](../plan/stage-4-tasks.md) D4-1 ~ D4-7

---

## 1. ShareModal 컴포넌트

**파일**: `src/components/workspace/ShareModal.tsx`

### Props

```typescript
interface ShareModalProps {
  /** 공유할 파일의 MARKDOWN_ROOT 기준 상대 경로. */
  filePath: string;
  /** 표시할 파일명 (헤더에 사용). */
  fileName: string;
  /** 모달 열림 상태. */
  open: boolean;
  /** 모달 닫기 콜백. */
  onClose: () => void;
}
```

### 동작

1. 기존 `src/components/ui/Modal.tsx`를 재사용한다.
2. 모달 타이틀: "공유하기"
3. 세 가지 액션 버튼을 세로로 배치한다:
   - **Discord로 공유**: `POST /api/share/notify` with `{ target: 'discord', filePath }`
   - **Slack으로 공유**: `POST /api/share/notify` with `{ target: 'slack', filePath }`
   - **링크 복사**: `navigator.clipboard.writeText(window.location.href)`
4. 각 버튼은 아이콘 + 텍스트 구성.
5. Discord/Slack 버튼 클릭 시:
   - 버튼을 비활성화하고 아이콘을 `Loader2` 스피너로 교체.
   - API 호출 완료 후 상태 복원.
   - 성공: `emitToast({ message: 'Discord에 공유되었습니다.', variant: 'success' })` (또는 Slack).
   - 실패(400): 서버 메시지를 토스트로 표시.
   - 실패(429): fetcher가 자동 처리 (rate limit 토스트).
   - 실패(502): `emitToast({ message: '전송에 실패했습니다. 잠시 후 재시도해 주세요.', variant: 'error' })`.
   - 성공 후 모달을 닫지 않는다 -- 사용자가 다른 플랫폼에도 공유할 수 있다.
6. "링크 복사" 버튼 클릭 시:
   - 클립보드 복사 후 `emitToast({ message: '링크가 복사되었습니다.', variant: 'success' })`.
   - 클립보드 API 실패 시 에러 토스트.
7. 모달 하단에 안내 텍스트: "공유 링크를 받은 사람도 로그인이 필요합니다." (ADR-004)

### API 호출

```typescript
import { apiFetch, toApiRequestError } from '@/lib/fetcher';
import type { ShareNotifyResponse, ShareTarget } from '@/types/api';

async function handleShare(target: ShareTarget) {
  setSending(target);  // 어떤 버튼이 로딩 중인지 추적

  try {
    await apiFetch<ShareNotifyResponse>('/api/share/notify', {
      method: 'POST',
      body: JSON.stringify({ target, filePath }),
    });

    const label = target === 'discord' ? 'Discord' : 'Slack';
    emitToast({ message: `${label}에 공유되었습니다.`, variant: 'success' });
  } catch (caught) {
    const err = toApiRequestError(caught);

    if (err.code === 502) {
      emitToast({ message: '전송에 실패했습니다. 잠시 후 재시도해 주세요.', variant: 'error' });
    } else if (err.code !== 401 && err.code !== 429) {
      // 401/429는 fetcher가 자동 처리
      emitToast({ message: err.message, variant: 'error' });
    }
  } finally {
    setSending(null);
  }
}
```

### UI 레이아웃

```
┌───────────────────────────┐
│  공유하기              [X] │
│                           │
│  📄 파일명.md              │
│                           │
│  ┌───────────────────────┐│
│  │ 💬 Discord로 공유      ││
│  └───────────────────────┘│
│  ┌───────────────────────┐│
│  │ # Slack으로 공유       ││
│  └───────────────────────┘│
│  ┌───────────────────────┐│
│  │ 🔗 링크 복사           ││
│  └───────────────────────┘│
│                           │
│  ℹ 공유 링크를 받은 사람도 │
│    로그인이 필요합니다.    │
└───────────────────────────┘
```

### 스타일 (Tailwind)

버튼 공통:
```
w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium
transition-colors focus-visible:outline-2 focus-visible:outline-offset-2
```

Discord 버튼:
```
border-indigo-200 text-indigo-700 hover:bg-indigo-50
dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/50
disabled:cursor-not-allowed disabled:opacity-60
```

Slack 버튼:
```
border-emerald-200 text-emerald-700 hover:bg-emerald-50
dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/50
disabled:cursor-not-allowed disabled:opacity-60
```

링크 복사 버튼:
```
border-zinc-200 text-zinc-700 hover:bg-zinc-50
dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800
```

아이콘 크기: `h-5 w-5`.

안내 텍스트:
```
mt-4 text-xs text-zinc-500 dark:text-zinc-400 text-center
```

### 아이콘

lucide-react에서 가져온다:
- Discord: `MessageCircle` (lucide에 공식 Discord 아이콘이 없으므로 가장 유사한 것 사용)
- Slack: `Hash`
- 링크 복사: `Link`
- 로딩: `Loader2`

---

## 2. 뷰어 페이지 공유 버튼 추가

**파일**: `src/app/workspace/view/page.tsx` (수정)

### 변경 사항

헤더의 "편집" 버튼 왼쪽에 "공유" 아이콘 버튼을 추가한다.

```tsx
import { useState } from 'react';  // 기존에 있음
import { Share2 } from 'lucide-react';  // 추가
import { ShareModal } from '@/components/workspace/ShareModal';  // 추가

// ViewerPageInner 내부
const [shareOpen, setShareOpen] = useState(false);

// 헤더 JSX (편집 버튼 왼쪽에 추가)
<div className="flex items-center gap-2">
  <button
    type="button"
    onClick={() => setShareOpen(true)}
    className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    title="공유하기"
  >
    <Share2 className="h-3.5 w-3.5" />
    공유
  </button>

  <button type="button" onClick={handleEdit} ...>  {/* 기존 편집 버튼 */}
    <Pencil className="h-3.5 w-3.5" />
    편집
  </button>
</div>

{/* 공유 모달 -- 헤더 바깥, 컴포넌트 최상위에 배치 */}
<ShareModal
  filePath={path}
  fileName={fileName}
  open={shareOpen}
  onClose={() => setShareOpen(false)}
/>
```

### 기존 레이아웃 변경

현재 편집 버튼이 단독으로 있으므로, 공유 버튼과 편집 버튼을 `flex gap-2`로 묶는다.

변경 전:
```tsx
<button type="button" onClick={handleEdit} ...>
  <Pencil /> 편집
</button>
```

변경 후:
```tsx
<div className="flex items-center gap-2">
  <button type="button" onClick={() => setShareOpen(true)} ...>
    <Share2 /> 공유
  </button>
  <button type="button" onClick={handleEdit} ...>
    <Pencil /> 편집
  </button>
</div>
```

---

## 3. 편집 페이지 공유 버튼 추가

**파일**: `src/app/workspace/edit/page.tsx` (수정)

### 변경 사항

헤더의 "저장" 버튼 왼쪽에 "공유" 아이콘 버튼을 추가한다.

```tsx
import { Share2 } from 'lucide-react';  // 추가
import { ShareModal } from '@/components/workspace/ShareModal';  // 추가

// EditorPageInner 내부
const [shareOpen, setShareOpen] = useState(false);

// 헤더 JSX (저장 버튼 왼쪽에 추가)
<div className="flex items-center gap-2">
  <button
    type="button"
    onClick={() => setShareOpen(true)}
    className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    title="공유하기"
  >
    <Share2 className="h-3.5 w-3.5" />
    공유
  </button>

  <button type="button" onClick={handleSave} disabled={saving || !isDirty} ...>
    {/* 기존 저장 버튼 */}
  </button>
</div>

{/* 공유 모달 -- 헤더 바깥, ConflictWarning 아래에 배치 */}
<ShareModal
  filePath={path}
  fileName={fileName}
  open={shareOpen}
  onClose={() => setShareOpen(false)}
/>
```

---

## 4. API 호출 요약

| API | 사용 시점 | 컴포넌트 |
|-----|-----------|----------|
| `POST /api/share/notify` | ShareModal에서 Discord/Slack 버튼 클릭 시 | ShareModal |

---

## 5. 스타일 가이드라인

- 기존 Stage 2-3 UI와 일관된 디자인 언어 유지.
- Tailwind 클래스만 사용 (인라인 스타일 금지).
- Dark mode 대응 (`dark:` prefix).
- lucide-react 아이콘 사용 (`Share2`, `MessageCircle`, `Hash`, `Link`, `Loader2`).
- 반응형: 모바일에서 모달이 전폭 (`w-full max-w-lg`).
- 공유 버튼은 뷰어/편집 헤더의 우측 액션 영역에 배치.

---

## 6. 프론트엔드 보안 체크리스트

| # | 항목 | 확인 사항 |
|---|------|-----------|
| 1 | API 경유 | 모든 호출이 `apiFetch` 경유 (401 자동 리다이렉트) |
| 2 | 타입 안전 | `ShareNotifyResponse`, `ShareTarget` 등 공유 타입 import |
| 3 | ADR-004 | "링크 복사" 시 인증 필요 안내 포함, 카카오 없음 |
| 4 | 보안 불변식 6 | Webhook URL이 클라이언트 코드에 참조되지 않음 |
| 5 | 502 처리 | 재시도 안내 (사용자가 취할 행동이 다름) |
| 6 | 에러 분류 | 400(사용자 조치), 429(자동), 502(재시도) 각각 다른 UI 대응 |

---

## 7. 접근성

| 항목 | 구현 |
|------|------|
| 모달 포커스 트랩 | 기존 Modal 컴포넌트가 처리 |
| 포커스 복원 | 기존 Modal 컴포넌트가 처리 |
| Esc 닫기 | 기존 Modal 컴포넌트가 처리 |
| 버튼 title | 공유 버튼에 `title="공유하기"` 속성 |
| disabled 상태 | 전송 중 `disabled` + `aria-disabled` 암시 |
| 로딩 상태 | 스피너 아이콘으로 시각적 표시 |
