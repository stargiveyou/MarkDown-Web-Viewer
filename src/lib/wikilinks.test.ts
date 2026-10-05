/**
 * 위키링크·마크다운 링크 추출과 해석 테스트 (순수 함수).
 */

import { describe, expect, it } from 'vitest';

import {
  buildWikiIndex,
  extractLinks,
  normalizeSubpath,
  resolveMarkdownHref,
  resolveWikiTarget,
  wikiKey,
} from '@/lib/wikilinks';

describe('extractLinks — 위키링크', () => {
  it('기본·별칭·소제목·폴더 형식을 대상 키로 뽑는다', () => {
    const md = [
      '[[설계 문서]] 참고',
      '[[설계 문서|설계]] 중복은 하나로',
      '[[배포#절차]] 소제목은 뗀다',
      '[[docs/Guide/README.md]] 폴더 경로',
      '[[UV Overlap]] 대소문자 무시',
    ].join('\n');
    const targets = extractLinks(md, 'a.md').map((l) => [l.kind, l.target]);
    expect(targets).toEqual([
      ['wiki', '설계 문서'],
      ['wiki', '배포'],
      ['wiki', 'docs/guide/readme'],
      ['wiki', 'uv overlap'],
    ]);
  });

  it('문맥 줄을 함께 남긴다', () => {
    const [link] = extractLinks('# 제목\n\n오늘 [[작업 기록]]을 정리했다\n', 'a.md');
    expect(link.context).toBe('오늘 [[작업 기록]]을 정리했다');
  });

  it('코드 블록·인라인 코드·frontmatter 안은 링크가 아니다', () => {
    const md = [
      '---',
      'related: "[[frontmatter 링크]]"',
      '---',
      '```',
      '[[코드 블록 안]]',
      '```',
      '`[[인라인 코드]]` 는 무시',
      '[[진짜 링크]]',
    ].join('\n');
    expect(extractLinks(md, 'a.md').map((l) => l.target)).toEqual(['진짜 링크']);
  });

  it('첨부 임베드는 빼고, 문서 임베드와 점이 든 이름은 남긴다', () => {
    const md = '![[그림.png]] ![[다른 문서]] [[보고서.pdf]] [[v1.2 릴리스]]';
    expect(extractLinks(md, 'a.md').map((l) => l.target)).toEqual(['다른 문서', 'v1.2 릴리스']);
  });
});

describe('extractLinks — 마크다운 링크', () => {
  it('상대 .md 링크를 원본 폴더 기준으로 해석한다', () => {
    const md = '[형제](./b.md) [상위](../c.md) [루트](/top.md) [인코딩](%ED%95%9C%EA%B8%80.md#x)';
    expect(extractLinks(md, 'p/q/a.md').map((l) => l.target)).toEqual([
      'p/q/b.md',
      'p/c.md',
      'top.md',
      'p/q/한글.md',
    ]);
  });

  it('외부 URL·앵커·이미지·비문서·루트 밖 링크는 버린다', () => {
    const md =
      '[웹](https://x.com/a.md) [메일](mailto:a@b.c) [앵커](#h) ![그림](a.md) [그림](a.png) [탈출](../../x.md)';
    expect(extractLinks(md, 'p/a.md')).toEqual([]);
  });
});

describe('경로 유틸', () => {
  it('normalizeSubpath는 루트 위로 올라가면 null', () => {
    expect(normalizeSubpath('a/./b/../c')).toBe('a/c');
    expect(normalizeSubpath('../x')).toBeNull();
  });

  it('resolveMarkdownHref는 스킴·프로토콜 상대 주소를 거른다', () => {
    expect(resolveMarkdownHref('//evil.com/a.md', 'a.md')).toBeNull();
    expect(resolveMarkdownHref('javascript:alert(1)//.md', 'a.md')).toBeNull();
  });

  it('wikiKey는 NFC·소문자·확장자 제거', () => {
    const nfd = '한글'.normalize('NFD');
    expect(wikiKey(`${nfd}.MD`)).toBe('한글');
  });
});

describe('resolveWikiTarget', () => {
  const index = buildWikiIndex([
    'notes/설계.md',
    'projectA/설계.md',
    'projectA/deep/x/설계.md',
    'docs/Guide/README.md',
    'other/Guide/README.md',
    '단독.md',
  ]);

  it('같은 폴더의 문서를 먼저 고른다', () => {
    expect(resolveWikiTarget('설계', 'projectA/작업.md', index)).toBe('projectA/설계.md');
  });

  it('같은 폴더가 없으면 경로가 짧은 문서', () => {
    expect(resolveWikiTarget('설계', 'zzz/작업.md', index)).toBe('notes/설계.md');
  });

  it('폴더가 든 대상은 경로 끝부분으로 찾는다', () => {
    expect(resolveWikiTarget('docs/guide/readme', 'a.md', index)).toBe('docs/Guide/README.md');
    expect(resolveWikiTarget('guide/readme', 'other/a.md', index)).toBe('other/Guide/README.md');
  });

  it('없는 문서는 null', () => {
    expect(resolveWikiTarget('없는 문서', 'a.md', index)).toBeNull();
    expect(resolveWikiTarget('../단독', 'a.md', index)).toBeNull();
  });
});
