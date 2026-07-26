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
