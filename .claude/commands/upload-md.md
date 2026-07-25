# 마크다운 파일을 서버에 업로드

작업 결과물인 마크다운 파일을 Web-MD-Viewer 서버에 업로드합니다.

## 사용법

`/upload-md` 커맨드를 실행하면 지정된 마크다운 파일들을 서버에 POST로 업로드합니다.

## 실행 절차

1. 사용자에게 다음을 확인합니다:
   - 업로드할 파일 경로 (또는 방금 생성한 마크다운 파일)
   - 서버 저장 폴더명 (targetPath)
   - 서버 URL (기본값: `http://localhost:3000`)

2. 업로드 스크립트를 실행합니다:

```bash
/Users/husky/Desktop/Project/Claude/Web-MD-Viewer/src/scripts/upload-to-server.sh \
  "<서버URL>" \
  '***REMOVED***' \
  "<targetPath>" \
  <파일1> <파일2> ...
```

3. 결과를 사용자에게 보고합니다.

## 기본값

- **서버 URL**: `http://localhost:3000` (개발 서버가 실행 중인 경우)
- **패스워드**: `.env.local`의 `SESSION_PASSWORD`에 대응하는 평문
- **허용 확장자**: md, markdown, png, jpg, jpeg, gif, webp, svg

## 예시

마크다운 파일 2개를 "project-notes" 폴더에 업로드:
```bash
./src/scripts/upload-to-server.sh http://localhost:3000 '***REMOVED***' 'project-notes' ./note1.md ./note2.md
```

## 주의사항

- 서버(dev 또는 production)가 실행 중이어야 합니다
- 파일 크기는 20MB 이하여야 합니다
- 허용되지 않는 확장자는 415 에러가 발생합니다
