# 가능성 검토 — MD 뷰어 PWA화 + iPhone 푸시 알림

> 상태: **가능성 검토만 완료 (구현 없음)** · 작성 2026-10-05
> 성격: PLAN v1.0 로드맵 밖의 부가 기능. 착수 시 `tech-lead` 범위 확정 + `security-auth` 검토 필요.

---

## 1. 결론

**가능하다.** iOS/iPadOS 16.4부터 **홈 화면에 추가한 웹 앱(PWA)** 은 Web Push 알림을 받을 수 있다.
앱스토어 등록·네이티브 앱 없이 현재 Next.js 앱에 매니페스트 + 서비스 워커 + 푸시 발송을 더하면 된다.

다만 이 앱 고유의 걸림돌이 3개 있다 (§3): **미들웨어가 매니페스트·서비스 워커를 로그인으로 막는다**,
**ngrok 도메인이 고정돼야 한다**, **세션 12시간 만료**.

## 2. iOS Web Push 조건

| 조건 | 내용 |
|---|---|
| iOS 버전 | 16.4 이상 |
| 설치 | Safari → 공유 → **홈 화면에 추가** 해야만 푸시 가능. Safari 탭에서는 불가 |
| 매니페스트 | `display: "standalone"`(또는 `fullscreen`) 필수 |
| HTTPS | 필수 (ngrok이 제공) |
| 권한 요청 | 반드시 **사용자 탭(제스처) 안에서** `Notification.requestPermission()` 호출 |
| 프로토콜 | 표준 Web Push + VAPID. Apple 푸시 서비스가 전달 (서버는 아웃바운드만 필요) |
| 제약 | 무음(silent) 푸시 불가 — 받으면 반드시 알림을 띄워야 한다. 집중 모드·알림 설정의 영향을 받음 |
| 저장소 | 홈 화면 앱은 Safari와 **쿠키·저장소가 분리** — 앱에서 한 번 따로 로그인해야 한다 |

## 3. 이 앱에서의 걸림돌

### 3-1. 미들웨어가 매니페스트·서비스 워커를 막는다 (필수 수정)

`src/middleware.ts:150` matcher는 `svg|png|jpg|…|txt|xml|woff` 정적 파일만 인증에서 제외한다.
`/manifest.webmanifest`, `/sw.js`는 제외 목록에 없으므로 **비로그인 요청이 `/login`으로 리다이렉트**되어
홈 화면 설치·서비스 워커 등록이 실패할 수 있다.

- 조치: matcher 제외 목록에 `manifest.webmanifest`, `sw.js`를 **정확한 경로로** 추가.
  두 파일 모두 사용자 데이터·시크릿이 없는 정적 자산으로, 기존 `monaco/`·아이콘 제외와 같은 성격이다.
- 보안 불변식 1(모든 페이지·API 세션 보호)의 범위 해석이 필요하므로 **`security-auth` 승인 항목**.
- 서비스 워커는 **API 응답을 캐시하지 않도록** 작성한다 (인증된 문서가 기기 캐시에 남지 않게). 푸시 수신·클릭 처리만 담당.

### 3-2. ngrok 고정 도메인 필요

푸시 구독과 홈 화면 앱은 **origin(도메인)에 묶인다.** 무료 ngrok의 랜덤 URL이 바뀌면 설치·구독이 모두 무효가 된다.
→ backlog P2-3의 **정적 도메인 예약**이 선행 조건.

ngrok Edge **Basic Auth**를 켜면(같은 P2-3) 홈 화면 앱에서 매니페스트·서비스 워커 요청에 Basic Auth가
어떻게 동작하는지 **미확인** — 실기기 검증 필요. 문제 시 Basic Auth 없이 앱 세션 인증만 쓰는 방안 검토.

### 3-3. 세션 12시간 만료

`src/lib/session.ts:33` `SESSION_TTL_SEC = 12h`. 홈 화면 앱은 하루 두 번가량 다시 로그인해야 한다.
- **푸시 수신 자체는 세션과 무관**하다 (Apple → 기기 직접 전달).
- 알림을 탭하면 세션이 만료된 경우 `/login?next=…`으로 간다 — 기존 리다이렉트 흐름으로 처리된다.
- TTL 연장은 보안 트레이드오프이므로 이번 범위에서 바꾸지 않는다.

## 4. 구현 범위 (착수 시)

| 구분 | 내용 | 비고 |
|---|---|---|
| 매니페스트 | `src/app/manifest.ts` (Next 내장) — 이름, 아이콘 180/192/512, `display: standalone`, `start_url: /workspace` | `apple-touch-icon` 별도 지정 |
| 서비스 워커 | `public/sw.js` — `push` → `showNotification`, `notificationclick` → 해당 문서 열기 | 응답 캐시 금지 |
| 권한·구독 UI | 설정 메뉴에 "이 기기에서 알림 받기" 버튼 (탭 제스처 안에서 권한 요청) | 홈 화면 앱이 아니면 "홈 화면에 추가 필요" 안내 |
| API | `POST /api/push/subscribe`, `DELETE /api/push/subscribe` | 세션 보호 + rate limit, `runtime = "nodejs"` |
| 저장 | 구독 정보 SQLite 테이블 (기존 `better-sqlite3`) | 만료 구독(404/410) 자동 삭제 |
| 발송 | `web-push` 패키지 (신규 의존성) | VAPID **개인키는 `.env.local` 전용** (불변식 6). 공개키만 클라이언트로 |
| 트리거 | ① 업로드 완료 — Stage 5 알림 지점(`upload/route.ts`)에 webhook과 나란히 best-effort<br>② 아침 브리핑 — Todoist 워커([plan-todoist-daily-briefing.md](plan-todoist-daily-briefing.md))가 로컬에서 발송 요청 | ②의 호출 방식은 워커 설계 시 결정 |
| 공유 타입 | 요청/응답 타입을 `src/types/api.ts`에 추가 | API 계약 단일 모듈 원칙 |

신규 환경변수: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`(mailto:).

알림 문구는 잠금 화면에 보이므로 **파일명·제목 수준까지만** 싣고 본문 내용은 넣지 않는다.
(Web Push 페이로드는 종단간 암호화되어 Apple이 읽을 수 없지만, 잠금 화면 노출은 별개 문제다.)

## 5. 대안과 판단

| 수단 | iPhone 알림 | 추가 개발 |
|---|---|---|
| Discord 앱 | ✅ 이미 webhook 알림이 있으므로 Discord 앱 알림으로 즉시 가능 | 없음 |
| Todoist 앱 | ✅ 할 일 마감·리마인더 알림 | 없음 (워커 기획에 포함) |
| **PWA 푸시** | ✅ MD 뷰어 자체 알림 + 탭하면 해당 문서로 바로 이동 | §4 범위 |

PWA 푸시의 고유 가치는 **알림 → 해당 문서 바로 열기**와 **Discord 없이 알림 받기**다.
Discord 알림으로 충분하다면 우선순위를 낮춰도 된다.

## 6. 실기기 확인 목록 (착수 시)

| # | 항목 | 기대 결과 |
|---|---|---|
| P-1 | 홈 화면 추가 후 standalone으로 열림 | 주소창 없이 실행 |
| P-2 | 비로그인 상태에서 `/manifest.webmanifest`, `/sw.js` 접근 | 200 (리다이렉트 아님) |
| P-3 | 비로그인 상태에서 `/api/push/subscribe` | 401 (불변식 1) |
| P-4 | "알림 받기" 탭 → 권한 허용 → 테스트 푸시 | 잠금 화면 알림 수신 |
| P-5 | 알림 탭 | 해당 문서 열림 / 세션 만료 시 로그인 후 복귀 |
| P-6 | ngrok Basic Auth 켠 상태에서 P-1~P-5 | **미확인** — 결과에 따라 3-2 결정 |
| P-7 | 앱 삭제 후 발송 | 410 응답 → 구독 자동 삭제 |
| P-8 | 클라이언트 번들에 VAPID 개인키 없음 | `grep` 0건 (불변식 6) |

## 7. 선행 조건

1. ngrok **정적 도메인** 확보 (backlog P2-3)
2. 미들웨어 예외 추가에 대한 `security-auth` 승인
3. `web-push` 의존성 추가 승인
