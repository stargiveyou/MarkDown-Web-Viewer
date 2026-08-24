import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  UPLOAD_LOG_CLEARED_KEY,
  loadClearedBefore,
  saveClearedBefore,
  visibleEntries,
} from './upload-log';
import type { UploadHistoryEntry } from '@/types/api';

function entry(id: string, at: number): UploadHistoryEntry {
  return { id, name: `${id}.md`, subpath: `${id}.md`, size: 1024, at, source: 'web' };
}

describe('visibleEntries', () => {
  const log = [entry('c', 3000), entry('b', 2000), entry('a', 1000)];

  it('keeps every entry when nothing has been cleared', () => {
    expect(visibleEntries(log, 0)).toBe(log);
  });

  it('hides entries uploaded at or before the clear point', () => {
    expect(visibleEntries(log, 2000).map((e) => e.id)).toEqual(['c']);
  });

  it('hides everything when cleared after the newest upload', () => {
    expect(visibleEntries(log, 9999)).toEqual([]);
  });

  it('shows uploads that arrive after the clear point', () => {
    const afterClear = [entry('d', 5000), ...log];

    expect(visibleEntries(afterClear, 4000).map((e) => e.id)).toEqual(['d']);
  });
});

/** 테스트 환경은 node라 window가 없다 — localStorage만 흉내 내 붙인다. */
function installFakeWindow(): Map<string, string> {
  const store = new Map<string, string>();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    },
  });

  return store;
}

describe('clear marker persistence', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installFakeWindow();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('reads back a saved timestamp', () => {
    saveClearedBefore(1234);

    expect(loadClearedBefore()).toBe(1234);
  });

  it('treats a missing marker as "nothing cleared"', () => {
    expect(loadClearedBefore()).toBe(0);
  });

  it('ignores a corrupted marker', () => {
    store.set(UPLOAD_LOG_CLEARED_KEY, 'not-a-number');

    expect(loadClearedBefore()).toBe(0);
  });

  it('ignores a non-positive marker', () => {
    store.set(UPLOAD_LOG_CLEARED_KEY, '-5');

    expect(loadClearedBefore()).toBe(0);
  });
});
