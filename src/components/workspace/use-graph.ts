'use client';

/**
 * `/api/graph` 조회 훅. 요청 URL을 키로 결과를 보관해, 조건(문서·깊이·태그)이 바뀌면
 * 이전 결과를 쓰지 않는다 — effect 안에서 상태를 리셋하지 않아도 된다.
 */

import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/fetcher';
import type { GraphResponse } from '@/types/api';

export interface GraphQuery {
  /** 중심 문서. 없으면 전체 그래프 */
  path?: string;
  depth?: number;
  tags?: boolean;
}

export function graphUrl({ path, depth, tags }: GraphQuery): string {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  if (path && depth) params.set('depth', String(depth));
  if (tags) params.set('tags', '1');
  const qs = params.toString();
  return qs ? `/api/graph?${qs}` : '/api/graph';
}

export function useGraph(query: GraphQuery, enabled = true) {
  const url = graphUrl(query);
  const [state, setState] = useState<{ url: string; data: GraphResponse | null; failed: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiFetch<GraphResponse>(url)
      .then((data) => {
        if (!cancelled) setState({ url, data, failed: false });
      })
      .catch(() => {
        // 401은 fetcher가 /login으로 보낸다. 그 밖의 실패는 그래프만 숨긴다.
        if (!cancelled) setState({ url, data: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [url, enabled]);

  const current = state?.url === url ? state : null;
  return { data: current?.data ?? null, failed: current?.failed ?? false, loading: enabled && current === null };
}
