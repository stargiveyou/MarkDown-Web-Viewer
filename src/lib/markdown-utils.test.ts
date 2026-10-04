/**
 * markdown-utils.ts 유닛 테스트.
 */

import { describe, expect, it } from 'vitest';
import { isExternalUrl, resolveImageSrc } from './markdown-utils';

describe('isExternalUrl', () => {
  it('http URL을 외부로 판별한다', () => {
    expect(isExternalUrl('http://example.com/img.png')).toBe(true);
  });

  it('https URL을 외부로 판별한다', () => {
    expect(isExternalUrl('https://cdn.example.com/photo.jpg')).toBe(true);
  });

  it('대소문자를 구분하지 않는다', () => {
    expect(isExternalUrl('HTTPS://EXAMPLE.COM')).toBe(true);
    expect(isExternalUrl('Http://example.com')).toBe(true);
  });

  it('상대 경로를 내부로 판별한다', () => {
    expect(isExternalUrl('images/photo.png')).toBe(false);
    expect(isExternalUrl('./photo.png')).toBe(false);
  });

  it('절대 경로를 내부로 판별한다', () => {
    expect(isExternalUrl('/api/thumbnail?path=img.png')).toBe(false);
  });
});

describe('resolveImageSrc', () => {
  it('외부 URL은 그대로 반환한다', () => {
    const url = 'https://example.com/img.png';
    expect(resolveImageSrc(url, 'docs/readme.md')).toBe(url);
  });

  it('상대 경로를 파일 디렉터리 기준으로 해석한다', () => {
    const result = resolveImageSrc('photo.png', 'travel/jeju/readme.md');
    expect(result).toBe('/api/thumbnail?path=travel%2Fjeju%2Fphoto.png&w=800');
  });

  it('./ 접두어를 제거한다', () => {
    const result = resolveImageSrc('./photo.png', 'docs/readme.md');
    expect(result).toBe('/api/thumbnail?path=docs%2Fphoto.png&w=800');
  });

  it('루트 레벨 파일의 상대 경로를 올바르게 해석한다', () => {
    const result = resolveImageSrc('photo.png', 'readme.md');
    expect(result).toBe('/api/thumbnail?path=photo.png&w=800');
  });
});
