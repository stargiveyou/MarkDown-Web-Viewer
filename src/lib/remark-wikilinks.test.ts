/**
 * remark-wikilinks — 실제 파서(remark-parse + remark-gfm)를 거친 트리에서 위키링크가
 * `data-wikilink` 속성을 가진 링크로 바뀌는지 확인한다.
 */

import type { Element, Root as HastRoot, RootContent } from 'hast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import remarkWikilinks from '@/lib/remark-wikilinks';

async function toHast(md: string): Promise<HastRoot> {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkWikilinks).use(remarkRehype);
  return (await processor.run(processor.parse(md))) as HastRoot;
}

function collect(node: HastRoot | RootContent, out: Element[] = []): Element[] {
  if (node.type === 'element') {
    if (node.tagName === 'a') out.push(node);
  }
  if ('children' in node) for (const c of node.children) collect(c as RootContent, out);
  return out;
}

function textOf(el: Element): string {
  return el.children.map((c) => (c.type === 'text' ? c.value : '')).join('');
}

describe('remarkWikilinks', () => {
  it('위키링크를 data-wikilink 링크로 바꾸고 별칭·소제목을 글자로 쓴다', async () => {
    const links = collect(await toHast('앞 [[설계 문서]] 중간 [[배포#절차]] 그리고 [[UV|유브이]] 끝'));
    expect(links.map((a) => [a.properties.dataWikilink, textOf(a)])).toEqual([
      ['설계 문서', '설계 문서'],
      ['배포', '배포 › 절차'],
      ['uv', '유브이'],
    ]);
    // 빈 href — 임의 스킴을 쓰지 않는다
    expect(links.every((a) => a.properties.href === '')).toBe(true);
  });

  it('코드·첨부 임베드는 그대로 둔다', async () => {
    const links = collect(await toHast('`[[코드]]`\n\n```\n[[블록]]\n```\n\n![[그림.png]]'));
    expect(links).toHaveLength(0);
  });

  it('일반 링크·GFM 표 안에서도 동작하고 기존 링크는 건드리지 않는다', async () => {
    const md = '| a | b |\n|---|---|\n| [[표 안]] | [보통](./x.md) |';
    const links = collect(await toHast(md));
    expect(links.map((a) => a.properties.dataWikilink ?? a.properties.href)).toEqual([
      '표 안',
      './x.md',
    ]);
  });
});
