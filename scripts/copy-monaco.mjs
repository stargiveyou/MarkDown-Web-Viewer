// Monaco 에디터의 정적 자산을 public/monaco/vs로 복사한다.
//
// @monaco-editor/react는 기본적으로 Monaco를 jsdelivr CDN에서 불러온다.
// 폐쇄망/오프라인(ngrok 뒤 맥미니 상주 등) 환경에서도 에디터가 동작하도록
// node_modules의 min 빌드를 public 하위로 복사해 같은 오리진에서 서빙한다.
// (loader 설정은 src/lib/monaco-config.ts에서 `/monaco/vs`로 지정한다.)
//
// public/monaco는 gitignore 대상이며 이 스크립트가 postinstall/prebuild에서
// 재생성한다 — 14MB 상당의 라이브러리 파일을 리포에 커밋하지 않기 위함이다.

import { cp, mkdir, access, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
const destDir = join(root, 'public', 'monaco');
const dest = join(destDir, 'vs');

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(src))) {
    // monaco-editor 미설치(예: --ignore-scripts) 시 빌드를 막지 않고 경고만 남긴다.
    console.warn('[copy-monaco] monaco-editor min/vs를 찾지 못해 건너뜁니다:', src);
    return;
  }

  // 이미 복사돼 있으면(loader.js 존재) 재복사를 생략해 dev/build 시작을 빠르게 유지한다.
  if (await exists(join(dest, 'loader.js'))) {
    console.log('[copy-monaco] public/monaco/vs 이미 존재 — 건너뜀');
    return;
  }

  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  await cp(src, dest, { recursive: true });
  console.log('[copy-monaco] Monaco 자산 복사 완료 → public/monaco/vs');
}

main().catch((err) => {
  console.error('[copy-monaco] 복사 실패:', err);
  process.exit(1);
});
