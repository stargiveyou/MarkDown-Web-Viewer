import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  UPLOAD_LOG_CLEARED_KEY,
  entryDisplayName,
  folderOf,
  groupUploadsByDay,
  loadClearedBefore,
  saveClearedBefore,
  showsTitle,
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

/** 로컬 시간 기준 epoch ms — 테스트가 실행 지역과 무관하게 같은 날짜를 가리키도록. */
function at(y: number, m: number, d: number, h = 12, min = 0): number {
  return new Date(y, m - 1, d, h, min).getTime();
}

describe('groupUploadsByDay', () => {
  const now = at(2026, 8, 14, 18);

  it('groups consecutive entries from the same day', () => {
    const groups = groupUploadsByDay(
      [
        { ...entry('c', at(2026, 8, 14, 16)) },
        { ...entry('b', at(2026, 8, 14, 9)) },
        { ...entry('a', at(2026, 8, 13, 21)) },
      ],
      now,
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].entries.map((e) => e.id)).toEqual(['c', 'b']);
    expect(groups[1].entries.map((e) => e.id)).toEqual(['a']);
  });

  it('labels today and yesterday', () => {
    const groups = groupUploadsByDay(
      [entry('c', at(2026, 8, 14, 16)), entry('b', at(2026, 8, 13, 9))],
      now,
    );

    expect(groups.map((g) => g.label)).toEqual(['오늘', '어제']);
  });

  it('labels older days with month/day and weekday', () => {
    // 2026-08-12는 수요일이다.
    const [group] = groupUploadsByDay([entry('a', at(2026, 8, 12, 10))], now);

    expect(group.label).toBe('8/12 (수)');
  });

  it('keeps a late-night upload on its local day', () => {
    const [group] = groupUploadsByDay([entry('a', at(2026, 8, 14, 23, 50))], now);

    expect(group.key).toBe('2026-08-14');
    expect(group.label).toBe('오늘');
  });

  it('returns nothing for an empty log', () => {
    expect(groupUploadsByDay([], now)).toEqual([]);
  });
});

describe('entryDisplayName / showsTitle', () => {
  function md(name: string, title?: string): UploadHistoryEntry {
    return { id: '1', name, subpath: `docs/${name}`, size: 10, at: 1000, source: 'api', title };
  }

  it('shows the document title for markdown', () => {
    const entry = md('tupgrid-shader-analysis.md', 'TUpGrid.shader 분석');

    expect(entryDisplayName(entry)).toBe('TUpGrid.shader 분석');
    expect(showsTitle(entry)).toBe(true);
  });

  it('falls back to the filename when a document has no title', () => {
    const entry = md('no-title.md');

    expect(entryDisplayName(entry)).toBe('no-title.md');
    expect(showsTitle(entry)).toBe(false);
  });

  it('never titles a non-markdown file, even if one slipped in', () => {
    const entry = md('diagram.svg', '어쩌다 붙은 제목');

    expect(entryDisplayName(entry)).toBe('diagram.svg');
    expect(showsTitle(entry)).toBe(false);
  });
});

describe('folderOf', () => {
  it('returns the containing folder', () => {
    expect(folderOf('Trip/Jeju/note.md')).toBe('Trip/Jeju');
  });

  it('returns an empty string at the root', () => {
    expect(folderOf('note.md')).toBe('');
  });
});
