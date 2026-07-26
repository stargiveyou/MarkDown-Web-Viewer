#!/usr/bin/env bash
# 마크다운(.md/.markdown)을 재귀 수집하여 폴더 구조를 보존한 채
# Husky Works MDs 서버(/api/upload)에 업로드한다.
#
# 사용법:
#   MDWS_URL=... MDWS_PASSWORD=... upload.sh "<base targetPath>" <파일|폴더> [<파일|폴더> ...]
#     - <base targetPath> 가 빈 문자열이면 저장소 루트를 기준으로 한다.
#     - 폴더를 주면 그 안의 .md/.markdown 를 **재귀 수집**하고, 폴더 내부의
#       하위 경로 구조를 base 아래에 그대로 **재현**한다.
#       (서버는 파일명을 평탄화하지만 targetPath 폴더는 존중하므로, 파일별
#        targetPath 를 지정해 구조를 복원한다.)
#     - 파일을 직접 주면 .md/.markdown 만 base 바로 아래로 올린다(그 외는 건너뜀).
#
# 예:
#   upload.sh "claude-notes" ./mydocs          # mydocs/**/*.md → claude-notes/<하위구조>/*.md
#   upload.sh "" a.md b.md                      # 루트에 두 파일
set -euo pipefail
shopt -s nocasematch

: "${MDWS_URL:?환경변수 MDWS_URL 필요 (예: https://xxxx.ngrok-free.app)}"
: "${MDWS_PASSWORD:?환경변수 MDWS_PASSWORD 필요 (SESSION_PASSWORD 평문)}"

BASE_URL="${MDWS_URL%/}"
BASE_TARGET="${1-}"; shift || true
BASE_TARGET="${BASE_TARGET#/}"; BASE_TARGET="${BASE_TARGET%/}"   # 앞뒤 슬래시 정리
if [ "$#" -eq 0 ]; then echo "업로드할 파일/폴더가 없습니다." >&2; exit 2; fi

# base 와 상대 디렉터리를 합쳐 targetPath 를 만든다(빈 값 허용).
join_tp() {
  local base="$1" reldir="$2"
  if [ "$reldir" = "." ] || [ -z "$reldir" ]; then printf '%s' "$base"
  elif [ -z "$base" ]; then printf '%s' "$reldir"
  else printf '%s/%s' "$base" "$reldir"; fi
}

# --- 1) 재귀 수집: (로컬파일, 서버 targetPath) 쌍 구성 -----------------------
FILES=(); TPATHS=()
for inp in "$@"; do
  if [ -d "$inp" ]; then
    root="${inp%/}"
    while IFS= read -r -d '' f; do
      rel="${f#"$root"/}"
      reldir="$(dirname "$rel")"
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

# --- 2) 로그인 --------------------------------------------------------------
COOKIE_JAR="$(mktemp)"; trap 'rm -f "$COOKIE_JAR"' EXIT
PW_JSON="$(node -e 'process.stdout.write(JSON.stringify(process.env.MDWS_PASSWORD))')"
echo "▶ 로그인: $BASE_URL"
login_code="$(curl -sS -o /dev/null -w '%{http_code}' -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' -H "Origin: $BASE_URL" \
  -X POST "$BASE_URL/api/auth/login" --data "{\"password\":$PW_JSON}")"
[ "$login_code" = "200" ] || { echo "✗ 로그인 실패 (HTTP $login_code). MDWS_URL/MDWS_PASSWORD 확인." >&2; exit 1; }
echo "✓ 로그인 성공"

# --- 3) 업로드 (파일별 targetPath 로 구조 보존) -----------------------------
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
    401) echo "✗ 인증 만료: $f (재로그인 필요)" >&2; fail=$((fail+1)) ;;
    413) echo "✗ 용량 초과(20MB): $f" >&2; fail=$((fail+1)) ;;
    415) echo "✗ 확장자 거부: $f" >&2; fail=$((fail+1)) ;;
    429) echo "✗ rate limit: $f — 잠시 후 재시도" >&2; fail=$((fail+1)) ;;
    *)   echo "✗ 실패(HTTP ${code:-?}): $f" >&2; fail=$((fail+1)) ;;
  esac
done
echo "─────────────"
echo "완료: 성공 $ok / 실패 $fail (수집 ${#FILES[@]})"
[ "$fail" -eq 0 ]
