import { describe, expect, it } from 'vitest';

import {
  buildMonthCells,
  byDayKey,
  cellsRange,
  currentMonth,
  dayTitle,
  monthLabel,
  shiftMonth,
} from './upload-calendar';
import type { UploadHistoryEntry } from '@/types/api';

function entry(id: string, at: number): UploadHistoryEntry {
  return { id, name: `${id}.md`, subpath: `${id}.md`, size: 10, at, source: 'web' };
}

/** 로컬 시간 기준 epoch ms — 테스트가 실행 지역과 무관하게 같은 날짜를 가리키도록. */
function at(y: number, m: number, d: number, h = 12): number {
  return new Date(y, m - 1, d, h).getTime();
}

describe('buildMonthCells', () => {
  it('starts on Sunday and ends on Saturday', () => {
    const cells = buildMonthCells({ year: 2026, month: 8 });

    expect(cells[0].weekday).toBe(0);
    expect(cells[cells.length - 1].weekday).toBe(6);
    expect(cells.length % 7).toBe(0);
  });

  it('covers every day of the month', () => {
    const cells = buildMonthCells({ year: 2026, month: 8 });
    const inMonth = cells.filter((cell) => cell.inMonth);

    expect(inMonth).toHaveLength(31);
    expect(inMonth[0].day).toBe(1);
    expect(inMonth[inMonth.length - 1].day).toBe(31);
  });

  it('marks leading and trailing days as outside the month', () => {
    // 2026-08-01은 토요일이라 앞에 일~금 6칸이 붙는다.
    const cells = buildMonthCells({ year: 2026, month: 8 });

    expect(cells.slice(0, 6).every((cell) => !cell.inMonth)).toBe(true);
    expect(cells[6]).toMatchObject({ day: 1, inMonth: true });
  });

  it('handles February in a leap year', () => {
    const cells = buildMonthCells({ year: 2028, month: 2 });

    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(29);
  });

  it('keys each cell by its local date', () => {
    const [, second] = buildMonthCells({ year: 2026, month: 8 });

    expect(second.key).toBe('2026-07-27');
  });
});

describe('shiftMonth', () => {
  it('moves forward across a year boundary', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('moves backward across a year boundary', () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('stays put for a zero shift', () => {
    expect(shiftMonth({ year: 2026, month: 8 }, 0)).toEqual({ year: 2026, month: 8 });
  });
});

describe('cellsRange', () => {
  it('spans from the first cell to the day after the last', () => {
    const cells = buildMonthCells({ year: 2026, month: 8 });
    const { from, to } = cellsRange(cells);

    expect(from).toBe(cells[0].startsAt);
    expect(to - cells[cells.length - 1].startsAt).toBe(24 * 60 * 60 * 1000);
  });

  it('is empty for an empty grid', () => {
    expect(cellsRange([])).toEqual({ from: 0, to: 0 });
  });
});

describe('byDayKey', () => {
  it('buckets entries by their local day', () => {
    const map = byDayKey([
      entry('c', at(2026, 8, 14, 16)),
      entry('b', at(2026, 8, 14, 9)),
      entry('a', at(2026, 8, 13, 21)),
    ]);

    expect([...map.keys()]).toEqual(['2026-08-14', '2026-08-13']);
    expect(map.get('2026-08-14')?.map((e) => e.id)).toEqual(['c', 'b']);
  });

  it('keeps a late-night upload on its local day', () => {
    const map = byDayKey([entry('a', at(2026, 8, 14, 23))]);

    expect(map.has('2026-08-14')).toBe(true);
  });
});

describe('labels', () => {
  it('formats the month header', () => {
    expect(monthLabel({ year: 2026, month: 8 })).toBe('2026년 8월');
  });

  it('formats a day title with its weekday', () => {
    // 2026-08-13은 목요일이다.
    expect(dayTitle(at(2026, 8, 13))).toBe('8월 13일 (목)');
  });

  it('derives the current month from a timestamp', () => {
    expect(currentMonth(at(2026, 8, 14))).toEqual({ year: 2026, month: 8 });
  });
});
