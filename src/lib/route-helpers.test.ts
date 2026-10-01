/**
 * route-helpers.ts 유닛 테스트.
 *
 * `path-safety.ts`의 `getRoot()`는 아직 캐시하지 않으므로(backlog 10번
 * "getRoot()/realpath 캐싱" 미구현) 루트 캐시 리셋은 필요하지 않다.
 * 그 항목을 구현하면 `resetServerEnvCacheForTest()` 옆에 캐시 무효화를 함께 넣는다.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetServerEnvCacheForTest } from '@/lib/env';
import { PathSafetyError } from '@/lib/path-safety';
import { handleRouteError, isEnoent } from './route-helpers';

beforeAll(() => {
  process.env.MARKDOWN_ROOT = '/tmp/mdws-route-helpers-test';
  process.env.SESSION_PASSWORD = `scrypt:16384:8:1:c2FsdHNhbHRzYWx0c2FsdA==:${Buffer.alloc(64, 7).toString('base64')}`;
  process.env.SESSION_SECRET = 'c'.repeat(64);
  process.env.UPLOAD_MAX_BYTES = '20971520';
  process.env.ALLOWED_EXTENSIONS = 'md,png';
  process.env.RATE_LIMIT_MAX = '10';
  process.env.RATE_LIMIT_WINDOW_SEC = '60';
  resetServerEnvCacheForTest();
});

afterAll(() => {
  resetServerEnvCacheForTest();
});

describe('handleRouteError', () => {
  it('PathSafetyError를 400으로 변환한다', () => {
    const err = new PathSafetyError('traversal detected');
    const resp = handleRouteError('test-route', err);
    expect(resp.status).toBe(400);
  });

  it('일반 에러를 500으로 변환한다', () => {
    const err = new Error('disk full');
    const resp = handleRouteError('test-route', err);
    expect(resp.status).toBe(500);
  });
});

describe('isEnoent', () => {
  it('ENOENT 에러를 식별한다', () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
    expect(isEnoent(err)).toBe(true);
  });

  it('다른 에러 코드를 거부한다', () => {
    const err = Object.assign(new Error('permission'), { code: 'EPERM' });
    expect(isEnoent(err)).toBe(false);
  });

  it('null을 거부한다', () => {
    expect(isEnoent(null)).toBe(false);
  });

  it('문자열을 거부한다', () => {
    expect(isEnoent('ENOENT')).toBe(false);
  });

  it('code가 없는 에러를 거부한다', () => {
    expect(isEnoent(new Error('generic'))).toBe(false);
  });
});
