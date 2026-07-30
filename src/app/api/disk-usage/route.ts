/**
 * `GET /api/disk-usage` — MARKDOWN_ROOT가 위치한 디스크의 용량 정보를 반환한다.
 *
 * 응답: `{ total, free, used }` (bytes)
 *
 * `node:fs/promises.statfs()`로 파일시스템 통계를 조회한다.
 * 보안 불변식 8이 적용된다 (절대 경로 미노출).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { internalError } from '@/lib/api-response';
import { getServerEnv } from '@/lib/env';
import type { DiskUsageResponse } from '@/types/api';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const root = path.resolve(getServerEnv().MARKDOWN_ROOT);
    const stats = await fs.statfs(root);

    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    const used = total - free;

    const response: DiskUsageResponse = { total, free, used };
    return NextResponse.json(response);
  } catch (error) {
    return internalError('disk-usage', error);
  }
}
