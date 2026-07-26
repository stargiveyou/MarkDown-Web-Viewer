---
name: md-upload-to-server
description: 다른 Claude 세션이나 작업에서 생성한 마크다운(.md) 파일들을 정리해서 Husky Works MDs 서버(/api/upload)에 POST로 업로드할 때 사용. "이 md들 서버에 올려줘", "작업 결과 업로드", "MD 서버로 전송" 같은 요청에 사용한다.
---

# md-upload-to-server — 마크다운 파일을 Husky Works MDs 서버에 업로드

다른 세션/작업에서 만들어진 `.md`(및 첨부 이미지)를 **정리한 뒤** Husky Works MDs
서버의 `POST /api/upload`로 올린다. 서버는 세션 인증이 필요하므로 먼저 로그인해
쿠키를 받고, 그 쿠키로 파일을 업로드한다.

## 사전 준비 (자격증명 — 하드코딩 금지)

서버 주소와 패스워드는 **환경변수**로 받는다. 파일이나 채팅에 평문 패스워드를 절대
남기지 않는다.

| 변수 | 설명 | 예시 |
|------|------|------|
| `MDWS_URL` | 서버 베이스 URL | `https://xxxx.ngrok-free.app` 또는 `http://localhost:3000` |
| `MDWS_PASSWORD` | `SESSION_PASSWORD`에 대응하는 평문 패스워드 | (사용자에게 받음) |

값이 없으면 사용자에게 물어보고, 셸에서 그 turn에만 `export`해서 쓴다. 예:

```bash
export MDWS_URL="https://xxxx.ngrok-free.app"
export MDWS_PASSWORD="<사용자가 알려준 패스워드>"
```

## 절차

### 1. 업로드할 파일 수집
- 사용자가 경로/디렉터리를 지정하지 않으면 물어본다("어떤 .md 파일을 올릴까요?").
- 디렉터리를 받으면 그 안의 `*.md`(필요 시 참조 이미지)를 모은다.
- 서버 허용 확장자: `md, markdown, png, jpg, jpeg, gif, webp, svg`. 그 외는 415가 난다.
- 파일당 최대 20MB(초과 시 413).

### 2. 정리 (원본은 건드리지 않는다)
원본 파일을 직접 수정하지 말고 **스테이징 디렉터리로 복사**한 뒤 복사본만 손본다.

```bash
STAGE="$(mktemp -d)"
```

복사본에 대해 아래를 적용한다:
- **파일명 정규화**: 공백·특수문자를 정리(예: 소문자-하이픈). 서버도 새니타이즈하지만
  보기 좋은 이름을 위해 먼저 정리한다.
- **프론트매터 보강(선택, 권장)**: 앱은 frontmatter의 `title`/`tags`로 카드 제목·태그를
  보여준다. 프론트매터가 없으면 문서 첫 `# 제목`(없으면 파일명)으로 `title`을 만들고
  필요 시 `tags`를 추가한다. 예:
  ```markdown
  ---
  title: 회의록 2026-07-26
  tags: [notes]
  ---
  ```
- **대상 폴더(targetPath) 결정**: 주제/날짜로 폴더를 정한다(예: `2026-07/notes`).
  루트에 그대로 올리려면 빈 문자열을 쓴다. 폴더는 서버가 없으면 만든다.

### 3. 업로드 실행
아래 스크립트를 임시 파일로 저장해 실행한다. 첫 인자는 `targetPath`(루트면 `""`),
그다음이 파일 목록이다.

```bash
bash /root/.claude/skills/md-upload-to-server/upload.sh "2026-07/notes" "$STAGE"/*.md
```

스크립트 본문은 이 문서 맨 아래 "업로드 스크립트"에 있다. 처음 사용할 때 그 코드
블록을 `/root/.claude/skills/md-upload-to-server/upload.sh`로 저장하고 실행 권한을 준다:

```bash
# 최초 1회만: 아래 코드블록을 upload.sh로 저장했다면
chmod +x /root/.claude/skills/md-upload-to-server/upload.sh
```

### 4. 결과 보고
- 성공/실패 개수와, 성공한 파일의 서버 경로(`subpath`)를 사용자에게 보고한다.
- 조회 URL을 함께 안내한다: `"$MDWS_URL"/workspace/view?path=<subpath(URL 인코딩)>`

## 상태코드 대응

| 코드 | 의미 | 조치 |
|------|------|------|
| 200 | 성공 | `files[].subpath` 보고 |
| 401 | 인증 실패/만료 | 패스워드 확인 후 재로그인 |
| 413 | 파일 20MB 초과 | 파일 분할/축소 |
| 415 | 허용되지 않은 확장자 | md/이미지 화이트리스트만 |
| 429 | rate limit | 잠시 후 재시도(파일은 순차 전송됨) |
| 400 | 잘못된 폼/경로 | targetPath·multipart 확인 |
| 500/502 | 서버 내부/웹훅 실패 | 500=서버 디스크 확인, 502=재시도 |

## 주의사항
- 서버(dev `npm run dev` 또는 prod `npm start`)가 떠 있어야 한다.
- 패스워드를 파일/채팅/커밋에 남기지 않는다(환경변수만 사용).
- 원본 파일을 변형하지 않는다(항상 스테이징 복사본을 업로드).
- 업로드된 `.md`는 서버가 자동으로 검색 색인(FTS5)에 반영한다.

## 업로드 스크립트

> 이 코드블록을 `/root/.claude/skills/md-upload-to-server/upload.sh`로 저장해 사용한다.
> Node는 JSON 인코딩/파싱에만 쓰며, 대상 서버 프로젝트가 Node 기반이라 항상 존재한다.

```bash
#!/usr/bin/env bash
# 마크다운 파일을 Husky Works MDs 서버(/api/upload)에 업로드한다.
# 사용법: MDWS_URL=... MDWS_PASSWORD=... upload.sh "<targetPath>" file1.md [file2.md ...]
#   targetPath가 빈 문자열이면 저장소 루트에 업로드한다.
set -euo pipefail

: "${MDWS_URL:?환경변수 MDWS_URL 필요 (예: https://xxxx.ngrok-free.app)}"
: "${MDWS_PASSWORD:?환경변수 MDWS_PASSWORD 필요 (SESSION_PASSWORD 평문)}"

BASE_URL="${MDWS_URL%/}"
TARGET_PATH="${1-}"; shift || true
if [ "$#" -eq 0 ]; then echo "업로드할 파일이 없습니다." >&2; exit 2; fi

COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

# 패스워드를 JSON 문자열로 안전하게 인코딩(특수문자 대응)
PW_JSON="$(node -e 'process.stdout.write(JSON.stringify(process.env.MDWS_PASSWORD))')"

echo "▶ 로그인: $BASE_URL"
login_code="$(curl -sS -o /dev/null -w '%{http_code}' \
  -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -H "Origin: $BASE_URL" \
  -X POST "$BASE_URL/api/auth/login" \
  --data "{\"password\":$PW_JSON}")"
if [ "$login_code" != "200" ]; then
  echo "✗ 로그인 실패 (HTTP $login_code). MDWS_URL / MDWS_PASSWORD 확인." >&2
  exit 1
fi
echo "✓ 로그인 성공"

ok=0; fail=0
for f in "$@"; do
  if [ ! -f "$f" ]; then echo "✗ 파일 없음: $f" >&2; fail=$((fail+1)); continue; fi
  args=(-sS -w '\n%{http_code}' -b "$COOKIE_JAR" -H "Origin: $BASE_URL" -F "file=@${f}")
  [ -n "$TARGET_PATH" ] && args+=(-F "targetPath=${TARGET_PATH}")
  resp="$(curl "${args[@]}" -X POST "$BASE_URL/api/upload")"
  code="$(printf '%s' "$resp" | tail -n1)"
  body="$(printf '%s' "$resp" | sed '$d')"
  case "$code" in
    200)
      sub="$(printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log((j.files||[]).map(x=>x.subpath).join(", "))}catch{console.log("")}})')"
      echo "✓ 업로드: $(basename "$f") → ${sub:-저장됨}"; ok=$((ok+1)) ;;
    401) echo "✗ 인증 만료: $(basename "$f") (재로그인 필요)" >&2; fail=$((fail+1)) ;;
    413) echo "✗ 용량 초과(20MB): $(basename "$f")" >&2; fail=$((fail+1)) ;;
    415) echo "✗ 허용되지 않은 확장자: $(basename "$f")" >&2; fail=$((fail+1)) ;;
    429) echo "✗ 요청 과다(rate limit): $(basename "$f") — 잠시 후 재시도" >&2; fail=$((fail+1)) ;;
    *)   echo "✗ 실패(HTTP $code): $(basename "$f")" >&2; fail=$((fail+1)) ;;
  esac
done

echo "─────────────"
echo "완료: 성공 $ok / 실패 $fail"
[ "$fail" -eq 0 ]
```
