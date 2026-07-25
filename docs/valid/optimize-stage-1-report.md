# 최적화/에러 리포트 -- Stage 1

- 점검 일시: 2026-07-24
- 점검 주체: `optimizer`
- 대상: Stage 1 (인증 + 웹 업로드) 전 범위
- 선행 리포트 확인: `frontend-stage-1-validation.md`(FAIL 2건 F1/F2), `backend-stage-1-validation.md`(PASS), `security-stage-1-validation.md`(PASS). 이미 FAIL로 잡힌 F1/F2는 중복 보고하지 않는다.

---

## 오류 (수정 필요)

| 심각도 | 위치(파일:라인) | 문제 | 재현/영향 | 제안 |
|--------|----------------|------|-----------|------|
| **중간** | `src/lib/fetcher.ts:162-163` | XHR 업로드에서 `withCredentials`를 설정하지 않는다. 현재는 same-origin이라 쿠키가 자동 전송되지만, ngrok 도메인(`*.ngrok-free.app`)을 앱 URL로 쓰면 브라우저가 이를 cross-origin으로 판단할 수 있다. 이 경우 세션 쿠키가 전송되지 않아 모든 업로드가 401로 실패한다. | ngrok 무료 도메인에서 브라우저 접속 시 upload 401. `fetch`(`apiFetch`)는 `credentials: 'same-origin'`을 명시하고 있어 동일 조건에서 동작 차이가 생긴다. | `xhr.withCredentials = true`를 `xhr.open()` 직후에 추가한다. same-origin에서도 해가 없고, 쿠키 `SameSite=Lax` + CSRF Origin 검사가 교차 사이트 남용을 이미 막고 있으므로 보안에 영향 없다. 단, `credentials: 'include'`에 해당하므로 tech-lead 확인 권장. |
| **낮음** | `src/components/ui/Toaster.tsx:56` | `useEffect` 의존성 배열이 빈 배열(`[]`)이다. 내부에서 `setToasts`를 콜백 형태로 사용하므로 기능상 문제는 없지만, React의 `eslint-plugin-react-hooks` 규칙(`exhaustive-deps`)이 이 패턴을 경고하지 않는 이유는 `setToasts`가 안정 참조이기 때문이다. 다만 `timerMap`은 `useRef`에서 가져온 값이라 StrictMode에서 cleanup/re-run 시 `timers.current`가 바뀔 수 있다. | React 19의 StrictMode에서 개발 중 effect가 두 번 실행되면 `timerMap`이 첫 번째 실행의 ref 값을 가리킨 채 cleanup된다. 프로덕션에서는 발생하지 않는다. | `timers.current`를 effect 내부가 아니라 cleanup에서 직접 참조하는 현재 구조가 안전하다. 다만 `const timerMap = timers.current;`를 cleanup 안으로 옮기면 StrictMode 이중 실행에서도 항상 최신 ref를 정리한다. |

---

## 성능 개선 (권장)

| 영향도 | 위치(파일:라인) | 현재 동작 | 비용 | 제안 |
|--------|----------------|-----------|------|------|
| **높음** | `src/lib/path-safety.ts:184-185` (`assertRealPathUnderRoot` 내부) | `MARKDOWN_ROOT`의 `fs.realpath(root)`를 호출할 때마다 매번 수행한다. 1파일 업로드 요청에서 `assertRealPathUnderRoot`가 4회 호출되므로 **`fs.realpath(root)`가 4회** 실행된다. root 경로는 프로세스 수명 동안 변하지 않는다. | 요청당 4회 불필요한 syscall (`lstat` 체인). 파일 수 N인 배치 업로드에서는 `2N+2`회로 증가한다. | `realRoot`를 모듈 수준에서 lazy-init 캐시한다 (예: `let cachedRealRoot: string \| null = null`). `getRoot()`가 이미 `getServerEnv()` 결과를 캐시하므로 동일 패턴을 적용하면 된다. 보안 참고: 운영 중 root를 심볼릭 링크로 바꿀 일은 없으므로(env 변경 = 재시작), 캐시가 보안을 약화시키지 않는다. |
| **높음** | `src/lib/path-safety.ts:63-65` (`getRoot()`) | `path.resolve(getServerEnv().MARKDOWN_ROOT)`를 매 호출마다 수행한다. 1파일 업로드에서 `getRoot()`가 약 8회 호출된다. `getServerEnv()`는 캐시하지만 `path.resolve()`는 매번 새로 실행한다. | 요청당 8회 `path.resolve()` (CPU-only이나 문자열 할당 반복). N 파일 배치에서 `~4N+4`회. | `getRoot()` 결과를 모듈 수준 변수에 캐시한다. `getServerEnv()`의 `MARKDOWN_ROOT`가 프로세스 수명 동안 변하지 않으므로 안전하다. `resetServerEnvCacheForTest()` 호출 시 함께 무효화하면 테스트 호환성도 유지된다. |
| **중간** | `src/app/api/upload/route.ts:231` | `Buffer.from(await file.arrayBuffer())`로 파일 데이터의 **복사본**을 만든다. `formData()`가 이미 파일 전체를 메모리에 올린 상태에서 `arrayBuffer()`가 또 다른 사본을 만들고, `Buffer.from()`이 세 번째 사본을 만든다. 20MB 파일 기준 최대 60MB 메모리 사용. | 20MB 파일 업로드 시 Node 힙에 ~60MB가 일시적으로 존재한다. `UPLOAD_MAX_BYTES` 기본값 20MB 기준. GC가 비동기적으로 회수하나 피크 사용량은 높다. | `Buffer.from(await file.arrayBuffer())`를 `new Uint8Array(await file.arrayBuffer())`로 대체하고 `temp.writeFile`에 전달하면 복사를 1회 줄인다. 또는 (Next 16 Node 런타임에서 가능하다면) `file.stream()`으로 파이프라인을 구성해 메모리 피크를 파일 크기 이하로 제한할 수 있다. 다만 atomic write와의 호환성(임시 파일에 전량 쓴 뒤 fsync)을 유지해야 하므로 스트리밍 전환은 신중히 검토한다. |
| **중간** | `src/app/api/upload/route.ts:219` | 선검증 단계에서 `toSubpath(targetDir)` + `resolveUnderRoot(join(...))` + `assertRealPathUnderRoot()`를 파일마다 호출한다. 그러나 `targetDir`은 루프 밖에서 이미 검증 완료되었고, 파일명만 `sanitizeFilename()`을 거쳤으므로 `safeName`에 경로 구분자가 올 수 없다. 즉 `path.join(targetDir, safeName)`은 반드시 `targetDir` 하위가 된다. | N파일 배치에서 불필요한 `resolveUnderRoot` N회 + `assertRealPathUnderRoot` N회(각각 2+ syscall 포함). 1파일 전송 기준으로는 미미하나, 50파일 드래그앤드롭 시 100+ syscall이 추가된다. | 이것은 **보안 중복 방어(defense in depth)**이므로 제거를 제안하지 않는다. 위의 `getRoot()`/`realRoot` 캐싱이 적용되면 syscall 비용이 대폭 줄어 실효적으로 해소된다. |
| **낮음** | `src/components/upload/UploadDropzone.tsx:152-153` | `items.filter()`를 렌더마다 2회 호출해 `doneCount`와 `errorCount`를 계산한다. `patch()` 콜백이 진행률 업데이트마다 `setItems`를 호출하므로 업로드 중 초당 수십 회 리렌더가 발생하고 매번 2회 필터링이 실행된다. | 100개 파일 큐에서 초당 ~20회 리렌더 x 2회 필터 = 초당 ~4000회 배열 순회. 실질적 프레임 드롭은 없을 수준이나 불필요한 연산이다. | `useMemo`로 `doneCount`/`errorCount`를 `items` 의존성으로 메모이즈한다. 또는 단일 `reduce`로 두 카운트를 한 번에 구한다. |
| **낮음** | `src/components/upload/UploadDropzone.tsx:74` | `normalizeTargetPath(targetPath)`를 매 렌더마다 호출한다. `normalizeTargetPath`는 순수 문자열 연산이라 비용은 무시할 수 있으나, `resolvedTargetPath`가 `runQueue`의 useCallback 의존성에 포함되어 `targetPath`가 바뀔 때마다 `runQueue` -> `accept` 콜백 체인 전체가 재생성된다. | 사용자가 폴더 입력란에 타이핑할 때마다 `runQueue`와 `accept` 함수가 새로 만들어진다. 업로드 중이 아니면 무해하다. 업로드 중에 `targetPath`가 바뀌는 것은 UI에서 불가능(입력란이 모달 밖)이므로 실제 문제가 되지 않는다. | 현 구조에서는 문제없다. Stage 2에서 입력란과 드롭존이 같은 화면에 있게 되면 `useRef`로 최신 값을 참조하는 방식으로 의존성을 끊는 것을 고려한다. |
| **정보** | `next.config.ts:21-25` (빌드 경고) | Turbopack 빌드 경고: "Encountered unexpected file in NFT list... the whole project was traced unintentionally". `next.config.ts`에서 `process.env.UPLOAD_MAX_BYTES`를 읽고 정수 연산하는 부분이 Turbopack의 파일 트레이싱을 혼란시킨다. | 빌드 산출물에 프로젝트 전체가 포함될 수 있어 배포 크기가 불필요하게 커진다. 동작에는 영향 없다. | Turbopack 주석 `/*turbopackIgnore: true*/`를 `process.env` 접근 앞에 추가한다. 예: `const configured = Number(/*turbopackIgnore: true*/ process.env.UPLOAD_MAX_BYTES)`. 또는 `env()` 헬퍼를 통해 간접 참조한다. 이미 backlog P2-6의 범위와 겹칠 수 있으므로 tech-lead 판단. |

---

## 빌드/린트 출력

### `npm run typecheck` (`tsc --noEmit`)

```
> web-md-viewer@0.1.0 typecheck
> tsc --noEmit
```

결과: 오류 0건, 경고 0건. **PASS**

### `npm run lint` (`eslint`)

```
> web-md-viewer@0.1.0 lint
> eslint
```

결과: 오류 0건, 경고 0건. **PASS**

### `npm run build` (`next build`)

```
> web-md-viewer@0.1.0 build
> next build

▲ Next.js 16.2.11 (Turbopack)
- Environments: .env.local
- Experiments (use with caution):
  · proxyClientMaxBodySize: 25165824

⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
  Creating an optimized production build ...
Turbopack build encountered 1 warnings:
./next.config.ts
Encountered unexpected file in NFT list
A file was traced that indicates that the whole project was traced unintentionally.
...
Import trace:
  App Route:
    ./next.config.ts
    ./src/app/api/upload/route.ts

✓ Compiled successfully in 19.6s
✓ Generating static pages using 3 workers (9/9) in 610ms
```

결과: 컴파일 성공. 경고 2건(middleware deprecated 1건, NFT tracing 1건). 오류 0건. **PASS**

경고 1: `middleware` -> `proxy` 컨벤션 변경은 backlog P2-6에 이미 등록됨.
경고 2: NFT tracing 경고는 위 성능 개선 "정보" 항목에서 다룸.

### `npm test` (`vitest run`)

```
> web-md-viewer@0.1.0 test
> vitest run

 RUN  v4.1.10

 Test Files  6 passed (6)
      Tests  106 passed (106)
   Duration  2.28s
```

결과: 106/106 테스트 통과. **PASS**

---

## 종합 소견

Stage 1 코드는 보안과 정확성 측면에서 견고하다. `await` 누락이나 처리되지 않은 Promise rejection은 발견되지 않았다. 모든 `fs`/`fetch` 호출이 try/catch로 감싸져 있고, 에러 경로에서 리소스 정리(임시 파일 삭제, 파일 핸들 close)가 올바르게 수행된다.

동기 fs 호출(`readFileSync` 등)은 요청 경로에 0건이다.

주요 성능 개선 기회는 `path-safety.ts`의 `getRoot()`와 `fs.realpath(root)` 반복 호출 캐싱이다. 1파일 업로드에서 `getRoot()` 8회, `fs.realpath(root)` 4회가 반복되며, 이 값들은 프로세스 수명 동안 변하지 않는다. 이 두 가지를 캐싱하면 업로드 요청의 syscall 횟수를 약 50% 줄일 수 있다.

클라이언트 측은 Stage 1 범위가 작아(로그인 + 업로드 모달) 번들 크기나 리렌더 병목이 의미 있는 수준이 아니다. `'use client'` 사용은 전부 상호작용(상태, 이벤트, useEffect)이 필요한 컴포넌트로 적절하다. Server Component로 옮길 수 있는 불필요한 `'use client'`는 없다.

backlog 반영 제안: 높음 심각도 항목 없음. XHR `withCredentials` 미설정(중간)은 ngrok 배포 시 반드시 확인해야 하므로 **P2로 등록을 제안**한다.
