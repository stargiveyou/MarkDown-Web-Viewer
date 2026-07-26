# 마크다운 파일을 서버에 업로드

작업 결과물인 마크다운 파일을 Husky Works MDs 서버에 업로드합니다.

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

2. 업로드 스크립트를 실행합니다(레포의 예시 스크립트 사용):

```bash
export MDWS_URL="<서버 URL>"
export MDWS_PASSWORD="<사용자에게 받은 패스워드>"
bash Example/upload.sh "<targetPath>" <파일1> <파일2> ...
```

3. 결과(성공/실패, 저장된 subpath, 조회 URL)를 사용자에게 보고합니다.

## 참고

- 스킬 전체 절차와 정리(파일명 정규화·프론트매터 보강)는 `Example/SKILL.md` 참조.
- 허용 확장자: md, markdown, png, jpg, jpeg, gif, webp, svg (그 외 415)
- 파일 크기 20MB 이하 (초과 시 413)
- 서버(dev `npm run dev` 또는 prod `npm start`)가 실행 중이어야 합니다.
