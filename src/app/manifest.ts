import type { MetadataRoute } from 'next';

/**
 * PWA 매니페스트 — `/manifest.webmanifest`로 제공된다(Next 내장 규약).
 *
 * iOS는 `display: standalone`인 웹 앱을 **홈 화면에 추가했을 때만** Web Push를 허용한다(16.4+).
 * 로그인 전에도 받아야 하므로 미들웨어 매처에서 이 경로를 정확히 제외한다(`src/middleware.ts`).
 * 시크릿·사용자 데이터를 넣지 않는다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Husky Works MDs',
    short_name: 'Husky MDs',
    description: '마크다운·미디어 업로드/조회/편집 워크스페이스',
    start_url: '/workspace',
    scope: '/',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    lang: 'ko',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
