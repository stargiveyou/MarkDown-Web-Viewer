import { describe, expect, it } from 'vitest';

import { graphUrl } from '@/components/workspace/use-graph';

describe('graphUrl', () => {
  it('전체 그래프는 쿼리 없이, 태그는 tags=1', () => {
    expect(graphUrl({})).toBe('/api/graph');
    expect(graphUrl({ tags: true })).toBe('/api/graph?tags=1');
  });

  it('로컬 그래프는 경로를 인코딩하고 깊이를 붙인다', () => {
    expect(graphUrl({ path: 'proj/작업 기록.md', depth: 2 })).toBe(
      '/api/graph?path=proj%2F%EC%9E%91%EC%97%85+%EA%B8%B0%EB%A1%9D.md&depth=2',
    );
  });

  it('깊이는 중심 문서가 있을 때만 보낸다', () => {
    expect(graphUrl({ depth: 2 })).toBe('/api/graph');
  });
});
