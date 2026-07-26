// Monaco 로더를 로컬 자산(public/monaco/vs)으로 향하게 한다.
//
// @monaco-editor/react의 기본 동작은 Monaco를 jsdelivr CDN에서 내려받는 것이라
// 인터넷이 없는 환경에서는 에디터가 "Loading..."에서 멈춘다. 여기서 loader를
// 같은 오리진의 정적 경로로 설정해 CDN 의존을 제거한다.
//
// 자산 자체는 scripts/copy-monaco.mjs가 node_modules → public/monaco/vs로 복사한다.
// 이 모듈은 side-effect import로 사용한다: `import '@/lib/monaco-config';`
// (에디터가 처음 마운트되기 전에 한 번 실행되면 된다.)

import { loader } from '@monaco-editor/react';

loader.config({ paths: { vs: '/monaco/vs' } });
