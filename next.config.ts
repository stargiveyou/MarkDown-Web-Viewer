import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
