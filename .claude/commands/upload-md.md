# 마크다운 파일을 서버에 업로드

작업 결과물인 마크다운 파일을 **관련 문서와 `[[위키링크]]`로 연결한 뒤** Husky Works MDs 서버에 업로드합니다.
링크는 서버 뷰어의 문서 간 이동·백링크·문서 그래프의 재료입니다.

## 사용법

`/upload-md` 커맨드를 실행하면 지정된 마크다운 파일들을 서버에 POST로 업로드합니다.

## 자격증명 (하드코딩 금지)

서버 주소와 패스워드는 **환경변수**로만 전달합니다. 평문 패스워드를 이 파일이나
채팅·커밋에 절대 남기지 않습니다.

| 변수 | 설명 |
|------|------|
| `MDWS_URL` | 서버 베이스 URL (예: `https://xxxx.ngrok-free.app` 또는 `http://localhost:3000`) |
| `MDWS_PASSWORD` | `.env.local`의 `SESSION_PASSWORD`에 대응하는 평문 |

값이 없으면 사용자에게 물어보고 그 turn에만 `export`해서 사용합니다.

## 실행 절차

1. 사용자에게 다음을 확인합니다:
   - 업로드할 파일 경로(또는 방금 생성한 마크다운 파일)
   - 서버 저장 폴더명(targetPath, 비우면 루트)
   - `MDWS_URL` / `MDWS_PASSWORD` (미설정 시)

2. **링크를 답니다** (원본이 아닌 스테이징 복사본에, 파일명 정리 후):
   - 서버의 관련 문서를 찾습니다. 검색어는 3자 이상, 결과 첫 열이 붙여 쓸 링크입니다.
     ```bash
     export MDWS_COOKIE_JAR="$(mktemp)"     # 세션 재사용 (로그인은 5분에 10회 제한)
     bash Example/mdws.sh search "<키워드>"
     ```
   - 본문의 언급 자리와 문서 끝 `## 관련 문서`에 `[[문서명]]`을 넣습니다.
     작업 기록이면 같은 프로젝트의 설계·할 일·직전 작업 기록을 우선 연결합니다.
   - 같이 올리는 문서끼리도 연결합니다. 추측으로 없는 문서를 링크하지 않습니다.
   - 규칙 전문: [Example/SKILL.md](../../Example/SKILL.md) §2-1

3. 업로드 스크립트를 실행합니다(레포의 예시 스크립트 사용):

```bash
export MDWS_URL="<서버 URL>"
export MDWS_PASSWORD="<사용자에게 받은 패스워드>"
bash Example/upload.sh "<targetPath>" <파일1> <파일2> ...
```

4. 결과(성공/실패, 저장된 subpath, 조회 URL, **추가한 링크 목록**)를 사용자에게 보고합니다.
   `bash Example/mdws.sh links "<subpath>"`로 링크가 실제 문서에 연결됐는지 확인하고,
   끝나면 `rm -f "$MDWS_COOKIE_JAR"`.

## 이미 올린 문서에 링크 달기

"기존 문서에도 링크 달아줘"라는 요청이면 `mdws.sh get` → 링크 추가 → `mdws.sh put`으로 고칩니다.
서버에서 그사이 바뀐 문서는 409로 거부되어 덮어쓰지 않습니다. 여러 문서를 고칠 때는
**바꿀 목록을 먼저 보여주고 승인**을 받고, 문장은 고치지 않고 링크만 더합니다.
절차: [Example/SKILL.md](../../Example/SKILL.md) "이미 서버에 있는 문서에 링크 달기"

## 참고

- 스킬 전체 절차와 정리(파일명 정규화·프론트매터 보강·링크 규칙)는 [Example/SKILL.md](../../Example/SKILL.md) 참조.
- 보조 명령: `Example/mdws.sh {search|links|get|put}`
- 허용 확장자: md, markdown, png, jpg, jpeg, gif, webp, svg (그 외 415)
- 파일 크기 20MB 이하 (초과 시 413)
- 서버(dev `npm run dev` 또는 prod `npm start`)가 실행 중이어야 합니다.
