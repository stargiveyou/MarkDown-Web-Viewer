/**
 * format-utils.ts 유닛 테스트.
 */

import { describe, expect, it } from 'vitest';
import { formatBytes, formatRelativeTime, formatTimestamp } from './format-utils';

describe('formatBytes', () => {
  it('0바이트를 "0 B"로 포맷한다', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('1바이트를 정확히 포맷한다', () => {
    expect(formatBytes(1)).toBe('1.0 B');
  });

  it('KB 단위를 포맷한다', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('MB 단위를 포맷한다', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('GB 단위를 포맷한다', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
  });

  it('TB 단위를 포맷한다', () => {
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB');
  });

  it('10 이상 값은 반올림하여 소수점 없이 표시한다', () => {
    expect(formatBytes(15 * 1024)).toBe('15 KB');
    expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB');
  });
});

describe('formatRelativeTime', () => {
  it('미래 시간은 "방금"으로 표시한다', () => {
    expect(formatRelativeTime(Date.now() + 10000)).toBe('방금');
  });

  it('60초 미만은 "방금"으로 표시한다', () => {
    expect(formatRelativeTime(Date.now() - 30_000)).toBe('방금');
  });

  it('분 단위를 포맷한다', () => {
    expect(formatRelativeTime(Date.now() - 5 * 60_000)).toBe('5분 전');
  });

  it('시간 단위를 포맷한다', () => {
    expect(formatRelativeTime(Date.now() - 3 * 3600_000)).toBe('3시간 전');
  });

  it('일 단위를 포맷한다', () => {
    expect(formatRelativeTime(Date.now() - 2 * 86400_000)).toBe('2일 전');
  });

  it('30일 이상은 YYYY-MM-DD 형식으로 표시한다', () => {
    const result = formatRelativeTime(Date.now() - 60 * 86400_000);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('formatTimestamp', () => {
  it('YYYYMMDD-HHmmss 형식으로 포맷한다', () => {
    const date = new Date(2026, 0, 15, 9, 5, 3); // 2026-01-15 09:05:03
    expect(formatTimestamp(date)).toBe('20260115-090503');
  });

  it('월·일·시·분·초를 2자리로 패딩한다', () => {
    const date = new Date(2025, 2, 3, 4, 5, 6); // 2025-03-03 04:05:06
    expect(formatTimestamp(date)).toBe('20250303-040506');
  });
});
