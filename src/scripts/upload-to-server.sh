#!/bin/bash
# upload-to-server.sh — 로컬 파일/폴더를 마크다운 서버에 업로드하는 스크립트
#
# 사용법:
#   ./upload-to-server.sh <서버URL> --pw-file <패스워드파일> <타겟폴더> <파일들...>
#   ./upload-to-server.sh <서버URL> <패스워드> <타겟폴더> <파일들...>
#
# 예시:
#   ./upload-to-server.sh http://localhost:3000 --pw-file /tmp/pw.txt my-folder ./doc.md
#   ./upload-to-server.sh http://localhost:3000 'mypassword' '' ./file.md
#
# --pw-file 옵션: 패스워드를 파일에서 읽는다 (zsh ! 이스케이프 문제 회피).
# 파일 내용은 패스워드 평문 한 줄이어야 한다.

set -euo pipefail

# --- 인자 검증 ---
if [ $# -lt 4 ]; then
  echo "Usage: $0 <server-url> [--pw-file <file> | <password>] <target-path> <file1> [file2] ..."
  echo ""
  echo "Examples:"
  echo "  $0 http://localhost:3000 --pw-file /tmp/pw.txt 'my-folder' ./doc.md"
  echo "  $0 http://localhost:3000 'mypassword' 'my-folder' ./doc.md"
  echo "  $0 http://192.168.45.136:3000 --pw-file pw.txt '' ./a.md ./b.md"
  exit 1
fi

SERVER_URL="${1%/}"
shift

# 패스워드 읽기: --pw-file 또는 직접 인자
if [ "$1" = "--pw-file" ]; then
  shift
  PW_PATH="$1"
  shift
  if [ ! -f "$PW_PATH" ]; then
    echo "Error: password file not found: $PW_PATH"
    exit 1
  fi
  PASSWORD=$(head -1 "$PW_PATH")
else
  PASSWORD="$1"
  shift
fi

TARGET_PATH="$1"
shift
FILES=("$@")

if [ ${#FILES[@]} -eq 0 ]; then
  echo "Error: no files specified"
  exit 1
fi

COOKIE_FILE=$(mktemp)
PASS_FILE=$(mktemp)
trap 'rm -f "$COOKIE_FILE" "$PASS_FILE"' EXIT

# --- 색상 ---
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}[1/3] 로그인 중...${NC} $SERVER_URL"

# JSON 생성: python3으로 특수문자를 안전하게 처리
python3 << PYEOF
import json
pw = open("$PASS_FILE", "w")
json.dump({"password": """$PASSWORD"""}, pw)
pw.close()
PYEOF

# 위 heredoc도 쉘 이스케이프에 취약하므로, 패스워드를 파이프로 전달
echo -n "$PASSWORD" > "${PASS_FILE}.raw"
python3 -c "
import json
with open('${PASS_FILE}.raw') as r:
    pw = r.read()
with open('${PASS_FILE}', 'w') as w:
    json.dump({'password': pw}, w)
"
rm -f "${PASS_FILE}.raw"

LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -c "$COOKIE_FILE" \
  -X POST "$SERVER_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d @"$PASS_FILE" 2>&1)

LOGIN_STATUS=$(echo "$LOGIN_RESPONSE" | tail -1)
LOGIN_BODY=$(echo "$LOGIN_RESPONSE" | sed '$d')

if [ "$LOGIN_STATUS" != "200" ]; then
  echo -e "${RED}[ERROR] 로그인 실패 (HTTP $LOGIN_STATUS)${NC}"
  echo "$LOGIN_BODY"
  exit 1
fi

echo -e "${GREEN}[OK] 로그인 성공${NC}"

# --- 파일 업로드 ---
echo -e "${YELLOW}[2/3] 파일 업로드 중...${NC} (${#FILES[@]}개 파일 → ${TARGET_PATH:-루트})"

UPLOAD_SUCCESS=0
UPLOAD_FAIL=0

for FILE in "${FILES[@]}"; do
  if [ ! -f "$FILE" ]; then
    echo -e "  ${RED}[SKIP] $FILE — 파일이 존재하지 않습니다${NC}"
    ((UPLOAD_FAIL++))
    continue
  fi

  FILENAME=$(basename "$FILE")

  UPLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -b "$COOKIE_FILE" \
    -X POST "$SERVER_URL/api/upload" \
    -F "file=@$FILE" \
    -F "targetPath=$TARGET_PATH" 2>&1)

  UPLOAD_STATUS=$(echo "$UPLOAD_RESPONSE" | tail -1)
  UPLOAD_BODY=$(echo "$UPLOAD_RESPONSE" | sed '$d')

  if [ "$UPLOAD_STATUS" = "200" ]; then
    echo -e "  ${GREEN}[OK] $FILENAME${NC}"
    ((UPLOAD_SUCCESS++))
  else
    echo -e "  ${RED}[FAIL] $FILENAME (HTTP $UPLOAD_STATUS)${NC} $UPLOAD_BODY"
    ((UPLOAD_FAIL++))
  fi
done

# --- 결과 ---
echo ""
echo -e "${YELLOW}[3/3] 결과${NC}"
echo -e "  성공: ${GREEN}${UPLOAD_SUCCESS}${NC}개"
if [ "$UPLOAD_FAIL" -gt 0 ]; then
  echo -e "  실패: ${RED}${UPLOAD_FAIL}${NC}개"
fi

if [ "$UPLOAD_FAIL" -gt 0 ]; then
  exit 1
fi

echo -e "${GREEN}완료!${NC}"
