import { describe, expect, it } from 'vitest';

// `@` 별칭 + `server-only` alias 치환이 함께 걸려야 통과한다.
// path-safety는 'server-only'를 import하므로, 스텁 치환이 없으면 이 import 자체가 실패한다.
import { PathSafetyError } from '@/lib/path-safety';

describe('테스트 환경 스모크', () => {
  it('@ 경로 별칭이 해석된다', () => {
    expect(PathSafetyError).toBeTypeOf('function');
  });

  it('server-only 모듈이 테스트에서 스텁으로 치환된다', () => {
    const err = new PathSafetyError('traversal');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PathSafetyError');
  });
});
