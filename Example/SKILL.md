---
name: md-upload-to-server
description: 다른 Claude 세션이나 작업에서 생성한 마크다운(.md/.markdown)을 재귀 수집해 폴더 구조를 보존한 채 Husky Works MDs 서버(/api/upload)에 POST로 업로드할 때 사용. "이 md들 서버에 올려줘", "이 폴더 통째로 업로드", "작업 결과 MD 서버로 전송" 같은 요청에 사용한다.
---

# md-upload-to-server — 마크다운을 구조 보존하며 서버에 업로드

다른 세션/작업에서 만들어진 `.md`/`.markdown`을 **재귀 수집 → md만 필터 → 폴더 구조
보존**한 채 Husky Works MDs 서버의 `POST /api/upload`로 올린다. 서버는 세션 인증이
필요하므로 먼저 로그인해 쿠키를 받고, 그 쿠키로 파일을 업로드한다.

## 동작 요약 (중요)
- **재귀 수집**: 폴더를 주면 하위 폴더까지 훑어 `.md`/`.markdown`만 모은다.
- **md만**: 그 외 확장자는 자동 제외(직접 지정해도 건너뜀).
- **구조 보존**: 서버는 파일명을 평탄화하지만 `targetPath` 폴더는 존중한다. 그래서
  **파일별 `targetPath`를 원본 상대 경로로 지정**해 하위 폴더 구조를 그대로 재현한다.

## 사전 준비 (자격증명 — 하드코딩 금지)

서버 주소와 패스워드는 **환경변수**로 받는다. 파일·채팅·커밋에 평문 패스워드를 절대
남기지 않는다.

| 변수 | 설명 | 예시 |
|------|------|------|
| `MDWS_URL` | 서버 베이스 URL | `https://xxxx.ngrok-free.app` 또는 `http://localhost:3000` |
| `MDWS_PASSWORD` | `SESSION_PASSWORD`에 대응하는 평문 | (사용자에게 받음) |

값이 없으면 사용자에게 물어보고, 셸에서 그 turn에만 `export`해서 쓴다.

```bash
export MDWS_URL="https://xxxx.ngrok-free.app"
export MDWS_PASSWORD="<사용자가 알려준 패스워드>"
```

## 사용법

```bash
bash upload.sh "<base targetPath>" <파일|폴더> [<파일|폴더> ...]
```
- `<base targetPath>`: 서버 저장소에서의 기준 폴더. 빈 문자열(`""`)이면 루트.
- 인자로 **폴더**를 주면 그 안의 `.md`/`.markdown`를 재귀 수집하고, **폴더 내부의
  하위 경로 구조를 base 아래에 그대로 재현**한다(폴더 자신의 이름은 포함하지 않음).
- 인자로 **파일**을 주면 `.md`/`.markdown`만 base 바로 아래로 올린다.

예:
```bash
# ./mydocs/**/*.md → 서버 claude-notes/<mydocs 내부 구조>/*.md
bash upload.sh "claude-notes" ./mydocs

# 개별 파일 두 개를 루트에
bash upload.sh "" a.md b.md
```
설치 위치에서 실행하려면(스킬로 설치된 경우):
```bash
bash /root/.claude/skills/md-upload-to-server/upload.sh "claude-notes" ./mydocs
```

## 절차

### 1. 대상 확인
- 업로드할 폴더/파일 경로와 `<base targetPath>`를 사용자에게 확인한다.
- `MDWS_URL`/`MDWS_PASSWORD` 미설정 시 물어본다.

### 2. (선택) 정리 — 원본은 건드리지 않는다
스크립트는 **읽기만** 하므로 원본을 그대로 넘겨도 안전하다. 다만 파일명 정규화나
프론트매터 보강(앱이 `title`/`tags`로 카드 제목·태그를 표시)을 하려면, 트리를
스테이징으로 복사해 복사본만 손본 뒤 그 폴더를 업로드한다:
```bash
STAGE="$(mktemp -d)"; cp -R ./mydocs/. "$STAGE"/   # 구조째 복사
# STAGE 안에서 파일명/프론트매터 정리 후
bash upload.sh "claude-notes" "$STAGE"
```
프론트매터 예:
```markdown
---
title: 회의록 2026-07-26
tags: [notes]
---
```

### 3. 업로드 실행
`upload.sh`를 실행한다. 스크립트가 재귀 수집·구조 보존·순차 업로드를 처리한다.
(처음 쓰는 환경이면 아래 "업로드 스크립트" 코드블록을 `upload.sh`로 저장하고
`chmod +x upload.sh`.)

### 4. 결과 보고
- 스크립트가 각 파일의 `로컬경로 → 서버경로` 매핑과 성공/실패 수를 출력한다.
- 조회 URL 안내: `"$MDWS_URL"/workspace/view?path=<subpath(URL 인코딩)>`

## 상태코드 대응

| 코드 | 의미 | 조치 |
|------|------|------|
| 200 | 성공 | 서버 경로 보고 |
| 401 | 인증 실패/만료 | 패스워드 확인 후 재로그인 |
| 413 | 파일 20MB 초과 | 파일 분할/축소 |
| 415 | 허용되지 않은 확장자 | md 화이트리스트만 |
| 429 | rate limit | 잠시 후 재시도(파일은 순차 전송됨) |
| 400 | 잘못된 폼/경로 | targetPath·multipart 확인 |
| 500/502 | 서버 내부/웹훅 실패 | 500=서버 디스크 확인, 502=재시도 |

## 주의사항
- 서버(dev `npm run dev` 또는 prod `npm start`)가 떠 있어야 한다.
- 패스워드를 파일/채팅/커밋에 남기지 않는다(환경변수만 사용).
- 스크립트는 원본을 변형하지 않는다(정리하려면 스테이징 복사 후 진행).
- 업로드된 `.md`는 서버가 자동으로 검색 색인(FTS5)에 반영한다.

## 업로드 스크립트

> 이 코드블록을 `upload.sh`로 저장해 사용한다(스킬 설치 시
> `/root/.claude/skills/md-upload-to-server/upload.sh`).
> Node는 JSON 인코딩에만 쓰며, 대상 서버 프로젝트가 Node 기반이라 항상 존재한다.

```bash
#!/usr/bin/env bash
# 마크다운(.md/.markdown)을 재귀 수집하여 폴더 구조를 보존한 채
# Husky Works MDs 서버(/api/upload)에 업로드한다.
#   사용법: MDWS_URL=... MDWS_PASSWORD=... upload.sh "<base targetPath>" <파일|폴더> ...
set -euo pipefail
shopt -s nocasematch

: "${MDWS_URL:?환경변수 MDWS_URL 필요 (예: https://xxxx.ngrok-free.app)}"
: "${MDWS_PASSWORD:?환경변수 MDWS_PASSWORD 필요 (SESSION_PASSWORD 평문)}"

BASE_URL="${MDWS_URL%/}"
BASE_TARGET="${1-}"; shift || true
BASE_TARGET="${BASE_TARGET#/}"; BASE_TARGET="${BASE_TARGET%/}"
if [ "$#" -eq 0 ]; then echo "업로드할 파일/폴더가 없습니다." >&2; exit 2; fi

join_tp() {
  local base="$1" reldir="$2"
  if [ "$reldir" = "." ] || [ -z "$reldir" ]; then printf '%s' "$base"
  elif [ -z "$base" ]; then printf '%s' "$reldir"
  else printf '%s/%s' "$base" "$reldir"; fi
}

FILES=(); TPATHS=()
for inp in "$@"; do
  if [ -d "$inp" ]; then
    root="${inp%/}"
    while IFS= read -r -d '' f; do
      rel="${f#"$root"/}"; reldir="$(dirname "$rel")"
      FILES+=("$f"); TPATHS+=("$(join_tp "$BASE_TARGET" "$reldir")")
    done < <(find "$root" -type f \( -iname '*.md' -o -iname '*.markdown' \) -print0)
  elif [ -f "$inp" ]; then
    case "$inp" in
      *.md|*.markdown) FILES+=("$inp"); TPATHS+=("$BASE_TARGET") ;;
      *) echo "· md 아님, 건너뜀: $inp" >&2 ;;
    esac
  else
    echo "✗ 경로 없음: $inp" >&2
  fi
done

if [ "${#FILES[@]}" -eq 0 ]; then echo "업로드할 .md 파일을 찾지 못했습니다." >&2; exit 2; fi
echo "수집된 .md 파일: ${#FILES[@]}개"

COOKIE_JAR="$(mktemp)"; trap 'rm -f "$COOKIE_JAR"' EXIT
PW_JSON="$(node -e 'process.stdout.write(JSON.stringify(process.env.MDWS_PASSWORD))')"
echo "▶ 로그인: $BASE_URL"
login_code="$(curl -sS -o /dev/null -w '%{http_code}' -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' -H "Origin: $BASE_URL" \
  -X POST "$BASE_URL/api/auth/login" --data "{\"password\":$PW_JSON}")"
[ "$login_code" = "200" ] || { echo "✗ 로그인 실패 (HTTP $login_code)." >&2; exit 1; }
echo "✓ 로그인 성공"

ok=0; fail=0
for i in "${!FILES[@]}"; do
  f="${FILES[$i]}"; tp="${TPATHS[$i]}"
  args=(-sS -w '\n%{http_code}' -b "$COOKIE_JAR" -H "Origin: $BASE_URL" -F "file=@${f}")
  if [ -n "$tp" ]; then args+=(-F "targetPath=${tp}"); fi
  resp="$(curl "${args[@]}" -X POST "$BASE_URL/api/upload" || true)"
  code="$(printf '%s' "$resp" | tail -n1)"
  dest="${tp:+$tp/}$(basename "$f")"
  case "$code" in
    200) echo "✓ ${f}  →  ${dest}"; ok=$((ok+1)) ;;
    401) echo "✗ 인증 만료: $f" >&2; fail=$((fail+1)) ;;
    413) echo "✗ 용량 초과(20MB): $f" >&2; fail=$((fail+1)) ;;
    415) echo "✗ 확장자 거부: $f" >&2; fail=$((fail+1)) ;;
    429) echo "✗ rate limit: $f — 잠시 후 재시도" >&2; fail=$((fail+1)) ;;
    *)   echo "✗ 실패(HTTP ${code:-?}): $f" >&2; fail=$((fail+1)) ;;
  esac
done
echo "─────────────"
echo "완료: 성공 $ok / 실패 $fail (수집 ${#FILES[@]})"
[ "$fail" -eq 0 ]
```
