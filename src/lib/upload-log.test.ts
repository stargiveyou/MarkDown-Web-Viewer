import { describe, expect, it } from 'vitest';

import { appendUploadLog, UPLOAD_LOG_MAX, type UploadLogEntry } from './upload-log';
import type { UploadedFileInfo } from '@/types/api';

function file(name: string, subpath = name): UploadedFileInfo {
  return { name, subpath, size: 1024, mtime: 0 };
}

describe('appendUploadLog', () => {
  it('puts the newest upload first', () => {
    const first = appendUploadLog([], [file('a.md')], 1000);
    const second = appendUploadLog(first, [file('b.md')], 2000);

    expect(second.map((e) => e.name)).toEqual(['b.md', 'a.md']);
  });

  it('orders a multi-file batch with the last finished file on top', () => {
    const log = appendUploadLog([], [file('a.md'), file('b.md'), file('c.md')], 1000);

    expect(log.map((e) => e.name)).toEqual(['c.md', 'b.md', 'a.md']);
  });

  it('keeps subpath, size and timestamp', () => {
    const [entry] = appendUploadLog([], [file('a.md', 'Trip/a.md')], 1700);

    expect(entry).toMatchObject({ name: 'a.md', subpath: 'Trip/a.md', size: 1024, at: 1700 });
  });

  it('gives distinct ids to files uploaded in the same batch', () => {
    const log = appendUploadLog([], [file('a.md'), file('b.md')], 1000);

    expect(new Set(log.map((e) => e.id)).size).toBe(2);
  });

  it('drops the oldest entries beyond the cap', () => {
    const existing: UploadLogEntry[] = Array.from({ length: UPLOAD_LOG_MAX }, (_, i) => ({
      id: `old-${i}`,
      name: `old-${i}.md`,
      subpath: `old-${i}.md`,
      size: 10,
      at: i,
    }));

    const log = appendUploadLog(existing, [file('new.md')], 9999);

    expect(log).toHaveLength(UPLOAD_LOG_MAX);
    expect(log[0].name).toBe('new.md');
    expect(log.some((e) => e.id === `old-${UPLOAD_LOG_MAX - 1}`)).toBe(false);
  });

  it('returns the previous log unchanged when nothing was uploaded', () => {
    const prev = appendUploadLog([], [file('a.md')], 1000);

    expect(appendUploadLog(prev, [], 2000)).toEqual(prev);
  });
});
