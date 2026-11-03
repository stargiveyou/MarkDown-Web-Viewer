# PDF 지원 — 맥미니 실행 목록

> **이 문서의 용도**: 브랜치 `feat/pdf-viewer`(PDF 업로드·다운로드·뷰어)는
> **Windows 개발기에서만 검증됐다.** lint·typecheck·build와 실서버 curl 시나리오는 통과했지만,
> 브라우저가 없어 **실제 canvas 렌더를 한 번도 보지 못했고**, 테스트 32건은 Windows 환경 제약으로
> 실행되지 못했다. 아래를 맥미니에서 위에서부터 순서대로 실행한다.
>
> 변경 내역과 설계 근거: [progress.md](progress.md) 2026-11-03 항목
>
> ⚠️ **§1을 건너뛰면 PDF 업로드가 415로 막힌다.** 뷰어를 추가해도 업로드 허용은
> `ALLOWED_EXTENSIONS`가 단독으로 정한다(보안 불변식 3).
>
> 실패 항목은 [backlog.md](backlog.md)로 되돌리고, 고친 뒤 이 목록을 처음부터 다시 돌린다.

---

## 0. 준비

```bash
cd ~/<프로젝트경로>/MarkDown-Web-Viewer
git fetch origin
git checkout feat/pdf-viewer
git pull

node -v          # → v22.23.1 (시스템 v19가 잡히면 PATH를 먼저 고친다)

npm ci           # postinstall이 monaco + pdf.js 자산을 public/으로 복사한다
```

`npm ci`에서 `pdfjs-dist`와 함께 **`@napi-rs/canvas`(약 45MB)** 가 설치된다.
pdfjs-dist의 optional 의존성이며 Node 측 렌더용이다 — 브라우저 뷰어는 쓰지 않지만,
빼면 `npm ci`가 optional 전체를 건너뛰어 `sharp` 플랫폼 바이너리까지 사라지므로 **그대로 둔다**.

---

## 1. `.env.local` 수정 (필수)

```bash
# 변경 전 값 확인
grep -E 'ALLOWED_EXTENSIONS|UPLOAD_MAX_BYTES' .env.local
```

| | 항목 | 내용 |
|---|---|---|
| [ ] | **E-1** | `ALLOWED_EXTENSIONS` 끝에 `,pdf` 추가 → `md,markdown,png,jpg,jpeg,gif,webp,svg,pdf` |
| [ ] | **E-2** | `UPLOAD_MAX_BYTES` 재검토 — 스캔 PDF는 20MB를 쉽게 넘긴다. 올릴 경우 **`npm run build`를 다시 해야** 한다([next.config.ts](../../next.config.ts)의 `proxyClientMaxBodySize`가 이 값에서 계산된다) |

> `MARKDOWN_ROOT`·`SESSION_*`·VAPID는 그대로다. 이번 변경이 새로 읽는 환경변수는 **없다.**

---

## 2. G — 실행 게이트

```bash
npm run typecheck    # G-1
npm run lint         # G-2
npm test             # G-3 + G-4
npm run build        # G-5
```

| | 항목 | 통과 기준 | 비고 |
|---|---|---|---|
| [ ] | **G-1** `typecheck` | 오류 0 | Windows에서 통과 |
| [ ] | **G-2** `lint` | **오류 0**, 경고 0 | Windows에서 통과. `public/pdfjs/`는 [eslint.config.mjs](../../eslint.config.mjs)에서 제외했다 — 경고가 수천 건 뜨면 그 제외가 빠진 것이다 |
| [ ] | **G-3** 신규 테스트 | `viewer-nav.test.ts` 7건 + `file-utils.test.ts`의 PDF 3건 green | |
| [ ] | **G-4** 기존 테스트 회귀 0 | **실패 0** | 아래 주의 |
| [ ] | **G-5** `build` | 성공 | 경고 1건(`next.config.ts` NFT)은 **변경 전에도 있던 기존 경고**다 |

> ⚠️ **G-4가 맥미니에서 사실상 첫 실행이다.**
> Windows에서는 `MARKDOWN_ROOT`가 POSIX 절대경로(`/`로 시작)여야 한다는 검증 때문에
> 임시 디렉터리를 쓰는 테스트 **32건이 실패**하고, `path-safety.test.ts`의 **53건(경로 탈출·심볼릭 링크)은 skip**된다.
> 변경 전후 실패 수가 32로 동일한 것은 확인했지만, 이 85건은 맥미니에서 처음 돌아간다.
> **깨지면 테스트가 틀렸는지 구현이 틀렸는지 먼저 구분한다** — 무조건 테스트를 고쳐 맞추지 않는다.

```bash
# G-3 단독 실행
npx vitest run src/lib/viewer-nav.test.ts src/lib/file-utils.test.ts
```

---

## 3. A — 자산 확인

pdf.js는 워커·CMap·폰트를 **런타임에 URL로** 받아 간다. 하나라도 없으면 문서가 안 열리거나
한글이 깨지므로, 서버를 띄우기 전에 파일 존재를 먼저 본다.

```bash
ls -la public/pdfjs/                       # pdf.worker.min.mjs + cmaps/ standard_fonts/ wasm/ iccs/
du -sh public/pdfjs                        # → 약 5MB
cmp public/pdfjs/pdf.worker.min.mjs \
    node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs && echo "legacy 워커 OK"
```

| | 항목 | 통과 기준 | 실패 시 |
|---|---|---|---|
| [ ] | **A-1** | 위 5개 항목이 모두 있다 | `rm -rf public/pdfjs && npm run copy-pdfjs` (복사 스크립트는 워커가 이미 있으면 **건너뛴다**) |
| [ ] | **A-2** | 워커가 **legacy** 빌드와 일치 | 기본 빌드가 복사됐다면 옛 iOS Safari에서 문서가 안 열린다([copy-pdfjs.mjs](../../scripts/copy-pdfjs.mjs)의 경로 확인) |

---

## 4. S — 보안 실측

```bash
npm start        # ngrok은 내려둔 채 http://localhost:3000 으로만 접속
```

```bash
# S-1 — 쿠키 없이
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/api/pdf?path=sample.pdf'
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/workspace/pdf?path=sample.pdf'

# S-2 — 로그인 쿠키로 (브라우저 개발자도구에서 mdws_session 값 복사)
C='mdws_session=<값>'
for p in '../../etc/passwd' '/etc/passwd' 'note.md' 'nope.pdf' '%2e%2e%2f%2e%2e%2fetc%2fpasswd.pdf'; do
  curl -s -b "$C" -o /dev/null -w "$p → %{http_code}\n" "http://localhost:3000/api/pdf?path=$p"
done

# S-3 — rate limit (61번째가 429)
for i in $(seq 1 62); do
  curl -s -b "$C" -o /dev/null -w '%{http_code} ' "http://localhost:3000/api/pdf?path=sample.pdf"
done; echo
```

| | 항목 | 통과 기준 |
|---|---|---|
| [ ] | **S-1** | `/api/pdf` **401**, `/workspace/pdf` **307**(→ `/login?next=...`) |
| [ ] | **S-2** | 5가지 전부 **400**. 특히 `/etc/passwd`·인코딩 우회가 200이면 **즉시 P0** |
| [ ] | **S-3** | 분당 60회를 넘기면 **429** + `Retry-After` |
| [ ] | **S-4** | 응답 헤더에 서버 절대경로·스택트레이스가 없다 (불변식 8) |

---

## 5. F — 기능 확인 (브라우저 — 이번 검증의 핵심)

먼저 한글 본문이 든 PDF와 여러 페이지짜리 PDF를 하나씩 준비한다.

| | 항목 | 방법 | 통과 기준 |
|---|---|---|---|
| [ ] | **F-1** | 웹 UI에서 PDF 업로드 | 200. 카드가 즉시 나타나고 **빨간 PDF 아이콘** |
| [ ] | **F-2** | 허용 밖 확장자(`.zip` 등) 업로드 | **415** + "허용되지 않는 형식입니다" |
| [ ] | **F-3** | PDF 카드 클릭 | **새 창**에서 `/workspace/pdf?path=...` — 보고 있던 폴더 목록이 남는다 |
| [ ] | **F-4** | 페이지가 **실제로 그려지는지** | 흰 자리표시자(페이지 번호)가 아니라 내용이 보인다. 콘솔 오류 0 |
| [ ] | **F-5** | **한글 PDF** | 글자가 깨지거나 빈 칸으로 나오지 않는다 (깨지면 A-1의 `cmaps/` 확인) |
| [ ] | **F-6** | 여러 페이지 문서 스크롤 | 아래로 내릴 때 페이지가 이어서 그려진다. 위로 되돌아가도 다시 그려진다 |
| [ ] | **F-7** | 툴바 | 확대·축소(배율 % 갱신), **폭 맞춤**, 이전/다음 페이지, `n / 총쪽수` 표시가 스크롤에 따라 갱신 |
| [ ] | **F-8** | 키보드 | 뷰어 클릭 후 `+` `-` `0`(폭 맞춤) |
| [ ] | **F-9** | **다운로드** 버튼 | 원래 파일명으로 저장된다(한글 파일명 포함) |
| [ ] | **F-10** | **원본** 버튼 | 새 탭에서 브라우저 기본 PDF 뷰어로 열린다 |
| [ ] | **F-11** | **공유** → Discord/Slack | 받은 링크가 `/workspace/pdf?path=...`다 (`/workspace/view`면 FAIL) |
| [ ] | **F-12** | 업로드 푸시 알림 탭 | PDF면 **PDF 뷰어**가 열린다 (VAPID 설정 시) |
| [ ] | **F-13** | 캘린더에서 PDF 항목 클릭 | PDF 뷰어가 새 창으로 열린다 |
| [ ] | **F-14** | 손상된 파일(`mv a.txt a.pdf`) 열기 | "손상되었거나 PDF 형식이 아닌 파일입니다" — 빈 화면이 아니라 안내 |
| [ ] | **F-15** | 암호 걸린 PDF 열기 | "암호로 보호된 PDF입니다" 안내 (암호 입력은 미지원) |

### iPhone (홈 화면 설치 PWA) — 이번 변경이 가장 불확실한 지점

| | 항목 | 통과 기준 |
|---|---|---|
| [ ] | **M-1** | ngrok 고정 도메인으로 접속 → PDF 열기 → **첫 페이지 말고 전체가** 보인다 |
| [ ] | **M-2** | 핀치 줌·스크롤이 먹는다. 페이지가 흰색으로 날아가지 않는다(캔버스 상한 보호가 걸린 지점) |
| [ ] | **M-3** | 390px 폭에서 툴바·헤더 가로 넘침 0 |
| [ ] | **M-4** | 20MB급 문서를 ngrok 회선으로 열 때 로딩 표시가 나오고 끝까지 열린다 |

### 메모리 거동 (여유 있을 때)

| | 항목 | 통과 기준 |
|---|---|---|
| [ ] | **P-1** | 100페이지 이상 문서를 끝까지 스크롤 → 탭 메모리가 선형으로 치솟지 않는다 (보이는 범위 ±1.5화면만 캔버스를 유지하도록 만들었다) |
| [ ] | **P-2** | 뷰어 탭을 닫은 뒤 `pdf.worker` 프로세스/워커가 남지 않는다 |

---

## 6. 실패 시 되돌리기

| 상황 | 조치 |
|------|------|
| 업로드만 막고 싶다 | `.env.local`의 `ALLOWED_EXTENSIONS`에서 `,pdf` 제거 → 재기동. 뷰어와 기존 PDF 열람은 그대로 남는다 |
| 뷰어가 전혀 안 열린다 | §3 A-1·A-2를 먼저 본다(워커 누락이 가장 흔하다). 그다음 브라우저 콘솔의 404 경로 |
| 경로 봉쇄가 뚫렸다(S-2 실패) | **즉시 P0.** 브랜치를 되돌리고(`git checkout main`) [backlog.md](backlog.md)에 올린다 |
| 전부 되돌린다 | `git checkout main && npm ci && npm run build && npm start`. `public/pdfjs/`는 추적 대상이 아니므로 남아도 무해하다 |

---

## 7. D — 문서 마무리

| | 항목 | 내용 |
|---|---|---|
| [ ] | **D-1** | `docs/complete-work/pdf-viewer-complete.md` 작성 (G/S/F/M 실측 결과) |
| [ ] | **D-2** | [progress.md](progress.md) 2026-11-03 항목의 "미확인" 줄을 실측 결과로 교체 |
| [ ] | **D-3** | 남은 개선은 [backlog.md](backlog.md)로 — 텍스트 선택·본문 검색(현재 canvas 전용이라 복사·검색 불가), PDF 카드 썸네일(sharp는 PDF를 못 읽는다), 큰 문서 Range 요청 |
| [ ] | **D-4** | 전부 통과하면 main에 병합 |
