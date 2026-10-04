/**
 * http-utils.ts 유닛 테스트.
 */

import { describe, expect, it } from 'vitest';
import { sanitizeProto } from './http-utils';

describe('sanitizeProto', () => {
  it('http를 허용한다', () => {
    expect(sanitizeProto('http')).toBe('http');
  });

  it('https를 허용한다', () => {
    expect(sanitizeProto('https')).toBe('https');
  });

  it('대소문자를 정규화한다', () => {
    expect(sanitizeProto('HTTP')).toBe('http');
    expect(sanitizeProto('HTTPS')).toBe('https');
  });

  it('공백을 트리밍한다', () => {
    expect(sanitizeProto('  https  ')).toBe('https');
  });

  it('null을 https로 대체한다', () => {
    expect(sanitizeProto(null)).toBe('https');
  });

  it('빈 문자열을 https로 대체한다', () => {
    expect(sanitizeProto('')).toBe('https');
  });

  it('javascript: 프로토콜을 거부하고 https로 대체한다', () => {
    expect(sanitizeProto('javascript:')).toBe('https');
  });

  it('ftp를 거부하고 https로 대체한다', () => {
    expect(sanitizeProto('ftp')).toBe('https');
  });
});
