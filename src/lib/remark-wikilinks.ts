/**
 * `[[문서명]]` 위키링크를 링크 노드로 바꾸는 remark 플러그인.
 *
 * 링크 대상을 여기서 해석하지 않는다 — 어떤 문서가 존재하는지는 서버 색인이 안다.
 * 대신 `data-wikilink` 속성에 대상 키(`wikiKey()`)를 실어 두고, 뷰어의 `a` 렌더러가
 * `/api/links` 결과로 실제 문서에 연결하거나 "아직 없는 문서"로 표시한다.
 *
 * `url`은 빈 문자열로 둔다. `wikilink:` 같은 임의 스킴은 react-markdown의 기본 URL 정화가
 * 지워 버리고, 정화를 끄는 것은 XSS 방어를 약하게 만든다.
 *
 * 코드(`code`, `inlineCode`)와 이미 링크인 노드 안은 건드리지 않는다.
 */

import type { Link, Parent, PhrasingContent, Root, RootContent, Text } from 'mdast';

import { WIKILINK_PATTERN, wikiKey } from './wikilinks';

/** 첨부 임베드(`![[그림.png]]`)는 링크로 만들지 않고 원문을 둔다. */
const ATTACHMENT_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|heic|pdf|mp4|mov|webm|mp3|wav|ogg|m4a|zip|csv|xlsx?|docx?|pptx?|canvas|excalidraw)$/i;

/** 텍스트 하나를 일반 텍스트와 위키링크 노드로 쪼갠다. 링크가 없으면 `null`. */
function splitText(node: Text): PhrasingContent[] | null {
  const value = node.value;
  const pattern = new RegExp(WIKILINK_PATTERN.source, 'g');
  const parts: PhrasingContent[] = [];
  let last = 0;
  let found = false;

  for (const m of value.matchAll(pattern)) {
    const [whole, , rawTarget, alias] = m;
    const target = rawTarget.trim();
    if (ATTACHMENT_EXT.test(target)) continue;

    const index = m.index ?? 0;
    if (index > last) parts.push({ type: 'text', value: value.slice(last, index) });

    // 보일 글자: 별칭 > 원문 대상(+#소제목). `[[a#b]]`는 "a › b"로 보여준다.
    const heading = /#([^|\]]*)/.exec(whole.slice(2, -2))?.[1]?.trim();
    const label = alias?.trim() || (heading ? `${target} › ${heading}` : target);

    const link: Link = {
      type: 'link',
      url: '',
      children: [{ type: 'text', value: label }],
      // hast 속성 이름 규약(camelCase). React로 렌더될 때 `data-wikilink` 속성이 된다.
      data: { hProperties: { dataWikilink: wikiKey(target) } },
    };
    parts.push(link);
    last = index + whole.length;
    found = true;
  }

  if (!found) return null;
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
  return parts;
}

function walk(parent: Parent): void {
  const children = parent.children as RootContent[];
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child.type === 'text') {
      const replaced = splitText(child);
      if (replaced) {
        children.splice(i, 1, ...(replaced as RootContent[]));
        i += replaced.length - 1;
      }
      continue;
    }
    // 이미 링크인 곳과 코드는 건드리지 않는다.
    if (child.type === 'link' || child.type === 'linkReference') continue;
    if ('children' in child) walk(child as Parent);
  }
}

export default function remarkWikilinks() {
  return (tree: Root) => {
    walk(tree);
  };
}
