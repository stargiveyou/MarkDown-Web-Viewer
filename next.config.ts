import type { NextConfig } from 'next';

/**
 * 프록시(구 middleware) 계층이 버퍼링할 요청 바디 상한.
 *
 * **왜 필요한가 (backend-dev / Stage 1)**
 * `src/middleware.ts`의 매처가 `/api/upload`를 포함하므로, Next는 프록시 단계에서 요청 바디를
 * 버퍼링한다. 이때 기본 상한이 **10MB**라서 그보다 큰 업로드는 바디가 **잘린 채** 라우트에 도달하고,
 * `formData()` 파싱이 깨져 413 대신 "Invalid form data"(400)가 나갔다(실서버 curl로 재현·확인).
 * `UPLOAD_MAX_BYTES`가 10MB를 넘는 순간 업로드 정책이 조용히 무력화되는 셈이다.
 *
 * 그래서 `UPLOAD_MAX_BYTES`에 연동해 계산한다. 여유분은 멀티파트 경계·헤더 몫이며,
 * 라우트 자신의 총량 상한(`UPLOAD_MAX_BYTES` + 1MiB)보다 넉넉해야
 * **413 판정이 라우트에서** 나온다(프록시가 먼저 자르면 400이 되어 버린다).
 *
 * env를 읽을 수 없는 환경(CI 등)에서는 기본값으로 떨어진다 — 설정 검증은 `src/lib/env.ts` 책임이다.
 */
const PROXY_BODY_OVERHEAD_BYTES = 4 * 1024 * 1024;
const DEFAULT_PROXY_BODY_LIMIT_BYTES = 24 * 1024 * 1024;

function proxyClientMaxBodySize(): number {
  const configured = Number(process.env.UPLOAD_MAX_BYTES);
  if (!Number.isInteger(configured) || configured <= 0) return DEFAULT_PROXY_BODY_LIMIT_BYTES;
  return configured + PROXY_BODY_OVERHEAD_BYTES;
}

const nextConfig: NextConfig = {
  /**
   * 같은 LAN에서 다른 IP로 접속할 때 Next.js 개발 리소스(HMR, JS 번들)가
   * cross-origin으로 차단되지 않도록 허용한다.
   * 프로덕션에서는 영향 없다(dev server 전용 설정).
   */
  allowedDevOrigins: ['192.168.45.136', '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'],
  experimental: {
    proxyClientMaxBodySize: proxyClientMaxBodySize(),
  },
  images: {
    /**
     * next/image의 내장 최적화를 끈다.
     *
     * 이유 1 (설계): 모든 카드 이미지는 `GET /api/thumbnail`(sharp + 디스크 캐시)로 처리한다.
     *                next의 별도 최적화 계층은 중복이다.
     * 이유 2 (보안): next 16.2.11은 sharp@0.34.5를 번들하는데 여기에 libvips CVE가 있다
     *                (GHSA-f88m-g3jw-g9cj, high). 우리가 직접 설치한 sharp는 0.35.3으로 안전하다.
     *                이 옵션이 신뢰할 수 없는 업로드 이미지가 취약한 번들 sharp를 타는 경로를 차단한다.
     *
     * 추적: docs/plan/backlog.md P1 — next가 sharp를 0.35+로 올리면 재검토.
     */
    unoptimized: true,
  },
};

export default nextConfig;
