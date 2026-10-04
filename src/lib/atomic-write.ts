/**
 * Atomic write (버전 보존) — 보안 불변식 4.
 *
 * 같은 디렉터리의 임시 파일에 전부 쓰고 `fsync`로 디스크에 확정한 뒤 `rename`한다.
 * 같은 파일시스템 안의 `rename`은 원자적이므로, 중간에 프로세스가 죽어도
 * 목적지에 **반쯤 쓰인 파일이 남지 않는다**. (직접 `writeFile(destination)` 금지)
 *
 * 같은 경로·같은 파일명이 이미 존재하면 기존 파일을 `name_YYYYMMDD-HHmmss.ext`로
 * 리네임하여 보존한 뒤, 새 파일을 원래 이름으로 저장한다.
 *
 * 서버 전용 — `fs/promises`에 의존한다.
 */

import 'server-only';

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { formatTimestamp } from '@/lib/format-utils';

export interface AtomicWriteOptions {
  /** 임시 파일 접두사 (디버깅용). 기본값 `'mdws'`. */
  tempPrefix?: string;
  /** 파일 권한 모드. 지정하지 않으면 OS 기본값. */
  mode?: number;
}

/**
 * `directory/safeName`에 `data`를 원자적으로 기록한다.
 *
 * 1. 임시 파일에 전량 기록 + fsync
 * 2. 기존 파일이 있으면 `name_YYYYMMDD-HHmmss.ext`로 백업
 * 3. 임시 파일 → 최종 경로 rename
 *
 * 경로 안전 검증(`assertRealPathUnderRoot`)은 **호출자 책임**이다.
 *
 * @returns 저장된 절대 경로
 */
export async function writeFileAtomically(
  directory: string,
  safeName: string,
  data: Buffer | string,
  options?: AtomicWriteOptions,
): Promise<string> {
  const prefix = options?.tempPrefix ?? 'mdws';
  const tempPath = path.join(
    directory,
    `.${prefix}-${randomBytes(12).toString('hex')}.tmp`,
  );
  const destination = path.join(directory, safeName);

  // 1) 임시 파일에 전량 기록 + fsync
  const openMode = options?.mode;
  const handle = await fs.open(
    tempPath,
    'wx',
    openMode,
  );
  try {
    if (typeof data === 'string') {
      await handle.writeFile(data, 'utf8');
    } else {
      await handle.writeFile(data);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    // 2) 기존 파일이 있으면 버전 백업으로 리네임
    try {
      const existingStat = await fs.stat(destination);
      if (existingStat.isFile()) {
        const ext = path.extname(safeName);
        const base = safeName.slice(0, safeName.length - ext.length);
        const timestamp = formatTimestamp(new Date(existingStat.mtimeMs));
        const backupName = `${base}_${timestamp}${ext}`;
        const backupPath = path.join(directory, backupName);
        await fs.rename(destination, backupPath);
      }
    } catch (err) {
      // ENOENT = 기존 파일 없음 → 정상 진행
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    // 3) 새 파일을 원래 이름으로 저장
    await fs.rename(tempPath, destination);
    return destination;
  } catch (error) {
    // 실패 시 잔여물을 남기지 않는다.
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
