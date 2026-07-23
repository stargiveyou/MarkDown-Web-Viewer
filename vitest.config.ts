import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  test: {
    // 첫 테스트 대상은 경로 안전 유틸(보안 불변식 2)이라 node 환경이 기본이다.
    // 컴포넌트 테스트를 추가할 때 해당 파일에 // @vitest-environment jsdom 을 붙인다.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': srcDir,
      // `server-only`는 React Server Components 조건부 export라 일반 Node에서 import하면 throw한다.
      // 서버 유틸을 유닛 테스트하려면 빈 모듈로 대체해야 한다.
      'server-only': fileURLToPath(new URL('./src/test/server-only-stub.ts', import.meta.url)),
    },
  },
});
