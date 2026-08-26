import { describe, expect, it } from 'vitest';

import { landedAt } from './upload-history';

const NOW = 1_787_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe('landedAt', () => {
  it('keeps the upload date when the file was edited later', () => {
    expect(landedAt({ birthtimeMs: NOW - 30 * DAY, mtimeMs: NOW - DAY }, NOW)).toBe(NOW - 30 * DAY);
  });

  it('uses the preserved mtime when a copy reset the creation time', () => {
    // 폴더째 복사하면 birthtime이 복사 시각으로 바뀌어 전부 같은 날에 몰린다.
    expect(landedAt({ birthtimeMs: NOW - DAY, mtimeMs: NOW - 30 * DAY }, NOW)).toBe(NOW - 30 * DAY);
  });

  it('falls back to mtime when the filesystem has no creation time', () => {
    expect(landedAt({ birthtimeMs: 0, mtimeMs: NOW - DAY }, NOW)).toBe(NOW - DAY);
  });

  it('ignores a creation time in the future (clock skew)', () => {
    expect(landedAt({ birthtimeMs: NOW + DAY, mtimeMs: NOW - DAY }, NOW)).toBe(NOW - DAY);
  });

  it('still returns mtime when every timestamp is untrustworthy', () => {
    expect(landedAt({ birthtimeMs: NOW + DAY, mtimeMs: NOW + 2 * DAY }, NOW)).toBe(NOW + 2 * DAY);
  });

  it('rounds fractional milliseconds', () => {
    expect(landedAt({ birthtimeMs: NOW + 0.6, mtimeMs: NOW + 0.6 }, NOW + DAY)).toBe(NOW + 1);
  });
});
