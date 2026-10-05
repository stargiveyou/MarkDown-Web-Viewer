#!/usr/bin/env bash
# Husky Works MDs 서버 보조 명령 — 문서 간 링크(위키링크)를 달 때 쓴다.
#
# 사용법 (자격증명은 환경변수로만):
#   MDWS_URL=... MDWS_PASSWORD=... mdws.sh search "<검색어>"        # 링크할 기존 문서 찾기
#   MDWS_URL=... MDWS_PASSWORD=... mdws.sh links  "<subpath>"       # 그 문서의 나가는 링크·백링크
#   MDWS_URL=... MDWS_PASSWORD=... mdws.sh get    "<subpath>" <out.md>   # 서버 문서 내려받기 (+ <out.md>.mtime)
#   MDWS_URL=... MDWS_PASSWORD=... mdws.sh put    "<subpath>" <in.md>    # 수정본 저장 (<in.md>.mtime 필요)
#
# 여러 번 호출할 때는 MDWS_COOKIE_JAR=<파일>을 함께 주면 세션을 재사용한다(로그인 rate limit 회피).
# 작업이 끝나면 그 파일을 지운다 — 세션 쿠키도 자격증명이다.
#
# put은 get 때 받은 mtime을 baseMtime으로 보낸다. 그사이 누가 고쳤으면 서버가 409로 거부하고
# 이 스크립트는 덮어쓰지 않고 실패한다 — 다시 get부터 하면 된다(보안 불변식 5, 무단 덮어쓰기 금지).
set -euo pipefail

: "${MDWS_URL:?환경변수 MDWS_URL 필요 (예: https://xxxx.ngrok-free.app)}"
: "${MDWS_PASSWORD:?환경변수 MDWS_PASSWORD 필요 (SESSION_PASSWORD 평문)}"

BASE_URL="${MDWS_URL%/}"
CMD="${1-}"; shift || true

# 세션 쿠키를 호출 사이에 재사용한다. 로그인은 5분에 10회로 제한되므로(rate limit)
# 문서 여러 건에 링크를 달다 보면 매번 로그인하는 방식은 금방 429에 걸린다.
# MDWS_COOKIE_JAR를 지정하면 그 파일에 세션을 보관하고, 없으면 이번 실행에만 쓴다.
if [ -n "${MDWS_COOKIE_JAR-}" ]; then
  COOKIE_JAR="$MDWS_COOKIE_JAR"
  touch "$COOKIE_JAR"; chmod 600 "$COOKIE_JAR"
else
  COOKIE_JAR="$(mktemp)"
  trap 'rm -f "$COOKIE_JAR"' EXIT
fi

login() {
  # 보관된 세션이 아직 유효하면 다시 로그인하지 않는다.
  if [ -s "$COOKIE_JAR" ] && [ "$(curl -sS -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" \
       "$BASE_URL/api/tags")" = "200" ]; then
    return 0
  fi
  local pw_json code
  pw_json="$(node -e 'process.stdout.write(JSON.stringify(process.env.MDWS_PASSWORD))')"
  code="$(curl -sS -o /dev/null -w '%{http_code}' -c "$COOKIE_JAR" \
    -H 'Content-Type: application/json' -H "Origin: $BASE_URL" \
    -X POST "$BASE_URL/api/auth/login" --data "{\"password\":$pw_json}")"
  if [ "$code" != "200" ]; then
    echo "✗ 로그인 실패 (HTTP $code). MDWS_URL / MDWS_PASSWORD 확인." >&2
    exit 1
  fi
}

urlencode() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }

# GET 요청. 본문은 표준출력, 실패하면 상태코드와 함께 종료.
api_get() {
  local resp code
  resp="$(curl -sS -w '\n%{http_code}' -b "$COOKIE_JAR" "$BASE_URL$1")"
  code="$(printf '%s' "$resp" | tail -n1)"
  if [ "$code" != "200" ]; then
    echo "✗ GET $1 실패 (HTTP $code)" >&2
    exit 1
  fi
  printf '%s' "$resp" | sed '$d'
}

case "$CMD" in
  search)
    q="${1:?검색어가 필요합니다 (2자 이상)}"
    login
    # 결과마다: 제목 / 경로 / 붙여 쓸 위키링크. 같은 파일명이 다른 폴더에도 있으면 폴더형을 쓴다.
    api_get "/api/search?q=$(urlencode "$q")" | node -e '
      let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        const { results = [] } = JSON.parse(s);
        if (results.length === 0) { console.log("(검색 결과 없음)"); return; }
        const base = p => p.split("/").pop().replace(/\.(md|markdown)$/i, "");
        const count = new Map();
        for (const r of results) count.set(base(r.subpath).toLowerCase(), (count.get(base(r.subpath).toLowerCase()) || 0) + 1);
        for (const r of results) {
          const name = base(r.subpath);
          const dup = count.get(name.toLowerCase()) > 1;
          const link = dup ? `[[${r.subpath.replace(/\.(md|markdown)$/i, "")}]]` : `[[${name}]]`;
          console.log(`${link}\t${r.title}\t${r.subpath}`);
        }
      });'
    ;;

  links)
    sub="${1:?subpath가 필요합니다}"
    login
    api_get "/api/links?path=$(urlencode "$sub")" | node -e '
      let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        const j = JSON.parse(s);
        console.log(`# ${j.path}${j.indexed ? "" : " (색인 전)"}`);
        console.log("## 나가는 링크");
        for (const l of j.outgoing) console.log(`- ${l.raw} → ${l.resolved ?? "(아직 없는 문서)"}`);
        console.log("## 백링크");
        for (const b of j.backlinks) console.log(`- ${b.title} (${b.source})`);
      });'
    ;;

  get)
    sub="${1:?subpath가 필요합니다}"; out="${2:?저장할 파일 경로가 필요합니다}"
    login
    api_get "/api/file-content?path=$(urlencode "$sub")" | OUT="$out" node -e '
      let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
        const j = JSON.parse(s);
        require("fs").writeFileSync(process.env.OUT, j.content);
        require("fs").writeFileSync(process.env.OUT + ".mtime", String(j.mtime));
      });'
    echo "✓ 내려받음: $sub → $out (mtime은 $out.mtime)"
    ;;

  put)
    sub="${1:?subpath가 필요합니다}"; in="${2:?올릴 파일 경로가 필요합니다}"
    [ -f "$in.mtime" ] || { echo "✗ $in.mtime 없음 — get으로 먼저 내려받으세요." >&2; exit 1; }
    login
    body="$(SUB="$sub" IN="$in" node -e '
      const fs = require("fs");
      process.stdout.write(JSON.stringify({
        path: process.env.SUB,
        content: fs.readFileSync(process.env.IN, "utf8"),
        baseMtime: Number(fs.readFileSync(process.env.IN + ".mtime", "utf8").trim()),
      }));')"
    resp="$(curl -sS -w '\n%{http_code}' -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
      -H "Origin: $BASE_URL" -X PUT "$BASE_URL/api/file-content" --data "$body")"
    code="$(printf '%s' "$resp" | tail -n1)"
    case "$code" in
      200)
        printf '%s' "$resp" | sed '$d' | IN="$in" node -e '
          let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
            require("fs").writeFileSync(process.env.IN + ".mtime", String(JSON.parse(s).mtime));
          });'
        echo "✓ 저장: $sub" ;;
      409) echo "✗ 충돌(409): 내려받은 뒤 서버에서 바뀌었습니다. 덮어쓰지 않았습니다 — get부터 다시 하세요." >&2; exit 1 ;;
      *)   echo "✗ 저장 실패 (HTTP $code): $sub" >&2; exit 1 ;;
    esac
    ;;

  *)
    echo "사용법: mdws.sh {search <검색어> | links <subpath> | get <subpath> <out.md> | put <subpath> <in.md>}" >&2
    exit 2
    ;;
esac
