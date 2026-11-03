// pdf.js(pdfjs-dist)의 정적 자산을 public/pdfjs로 복사한다.
//
// 뷰어 본체는 번들에 들어가지만, 아래 네 가지는 **런타임에 URL로 받아 가는** 자산이라
// 같은 오리진에서 서빙해야 한다(폐쇄망/오프라인 맥미니 상주 환경 기준 — CDN을 쓰지 않는다).
//
//   pdf.worker.min.mjs  파싱·렌더를 담당하는 워커. 없으면 문서가 아예 열리지 않는다.
//                       **legacy 빌드**를 쓴다 — 기본 빌드는 `Promise.try` 같은 최신 문법을
//                       그대로 쓰므로 조금 옛 iOS Safari에서 문서가 열리지 않는다.
//                       뷰어 쪽 import 경로(PdfViewer.tsx)와 짝이 맞아야 한다.
//   cmaps/              Adobe CMap. **한글·CJK PDF에서 폰트가 임베드되지 않은 경우** 글자가 깨진다.
//   standard_fonts/     Helvetica 등 표준 14종 대체 폰트.
//   wasm/ · iccs/       JBIG2/JPEG2000 디코더와 ICC 프로파일. 스캔 PDF·인쇄용 PDF에서 쓰인다.
//
// public/pdfjs는 gitignore 대상이며 이 스크립트가 postinstall/prebuild에서 재생성한다
// — 5MB 상당의 라이브러리 파일을 리포에 커밋하지 않기 위함이다(copy-monaco.mjs와 같은 방식).

import { cp, mkdir, access, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'node_modules', 'pdfjs-dist');
const destDir = join(root, 'public', 'pdfjs');

/** [원본, public/pdfjs 하위 목적지] */
const ASSETS = [
  [join(pkg, 'legacy', 'build', 'pdf.worker.min.mjs'), 'pdf.worker.min.mjs'],
  [join(pkg, 'cmaps'), 'cmaps'],
  [join(pkg, 'standard_fonts'), 'standard_fonts'],
  [join(pkg, 'wasm'), 'wasm'],
  [join(pkg, 'iccs'), 'iccs'],
];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(pkg))) {
    // pdfjs-dist 미설치(예: --ignore-scripts) 시 빌드를 막지 않고 경고만 남긴다.
    console.warn('[copy-pdfjs] pdfjs-dist를 찾지 못해 건너뜁니다:', pkg);
    return;
  }

  // 이미 복사돼 있으면(워커 존재) 재복사를 생략해 dev/build 시작을 빠르게 유지한다.
  if (await exists(join(destDir, 'pdf.worker.min.mjs'))) {
    console.log('[copy-pdfjs] public/pdfjs 이미 존재 — 건너뜀');
    return;
  }

  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });

  for (const [src, name] of ASSETS) {
    if (!(await exists(src))) {
      console.warn('[copy-pdfjs] 자산을 찾지 못해 건너뜁니다:', src);
      continue;
    }
    await cp(src, join(destDir, name), { recursive: true });
  }

  console.log('[copy-pdfjs] pdf.js 자산 복사 완료 → public/pdfjs');
}

main().catch((err) => {
  console.error('[copy-pdfjs] 복사 실패:', err);
  process.exit(1);
});
