/**
 * "수정 전 / 수정 후" 비교를 2단 그리드로 배치하는 rehype 플러그인.
 *
 * 마크다운에서
 *
 *   **수정 전:**
 *   ```csharp ... ```
 *   **수정 후:**
 *   ```csharp ... ```
 *
 * 처럼 라벨 문단 + 코드 블록이 연달아 나오는 패턴을 감지해
 * 넓은 화면(lg 이상)에서 좌우로 나란히 보여준다. 좁은 화면에서는
 * 원래대로 세로로 쌓인다. 패턴이 어긋나면 아무것도 바꾸지 않는다.
 */

import type { Element, ElementContent, Root, RootContent } from 'hast';

const BEFORE_LABEL = /^(수정\s*전|before)\s*:?$/i;
const AFTER_LABEL = /^(수정\s*후|after)\s*:?$/i;

/** 라벨이 될 수 있는 태그 — 문단(굵은 글씨) 또는 소제목. */
const LABEL_TAGS = new Set(['p', 'h2', 'h3', 'h4', 'h5', 'h6']);

function textOf(node: RootContent | ElementContent): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(textOf).join('');
  return '';
}

function isLabel(node: RootContent, pattern: RegExp): node is Element {
  return (
    node.type === 'element' &&
    LABEL_TAGS.has(node.tagName) &&
    pattern.test(textOf(node).trim())
  );
}

function isCodeBlock(node: RootContent): node is Element {
  return node.type === 'element' && node.tagName === 'pre';
}

/** index부터 공백 텍스트 노드를 건너뛴 다음 노드의 인덱스. 없으면 -1. */
function nextIndex(children: RootContent[], index: number): number {
  for (let i = index; i < children.length; i += 1) {
    const node = children[i];
    if (node.type === 'text' && node.value.trim() === '') continue;
    return i;
  }
  return -1;
}

function column(label: Element, code: Element): Element {
  return {
    type: 'element',
    tagName: 'div',
    properties: { className: ['min-w-0'] },
    children: [label, code],
  };
}

export default function rehypeBeforeAfter() {
  return (tree: Root) => {
    const children = tree.children;
    const out: RootContent[] = [];

    let i = 0;
    while (i < children.length) {
      const beforeIdx = nextIndex(children, i);
      if (beforeIdx === -1) {
        out.push(...children.slice(i));
        break;
      }

      // 패턴 시작점이 아니면 현재 노드까지 그대로 흘려보낸다.
      if (!isLabel(children[beforeIdx], BEFORE_LABEL)) {
        out.push(...children.slice(i, beforeIdx + 1));
        i = beforeIdx + 1;
        continue;
      }

      const beforeCodeIdx = nextIndex(children, beforeIdx + 1);
      const afterIdx = beforeCodeIdx === -1 ? -1 : nextIndex(children, beforeCodeIdx + 1);
      const afterCodeIdx = afterIdx === -1 ? -1 : nextIndex(children, afterIdx + 1);

      const matched =
        beforeCodeIdx !== -1 &&
        afterCodeIdx !== -1 &&
        isCodeBlock(children[beforeCodeIdx]) &&
        isLabel(children[afterIdx], AFTER_LABEL) &&
        isCodeBlock(children[afterCodeIdx]);

      if (!matched) {
        out.push(...children.slice(i, beforeIdx + 1));
        i = beforeIdx + 1;
        continue;
      }

      out.push(...children.slice(i, beforeIdx));
      out.push({
        type: 'element',
        tagName: 'div',
        properties: { className: ['grid', 'items-start', 'gap-x-6', 'lg:grid-cols-2'] },
        children: [
          column(children[beforeIdx] as Element, children[beforeCodeIdx] as Element),
          column(children[afterIdx] as Element, children[afterCodeIdx] as Element),
        ],
      });
      i = afterCodeIdx + 1;
    }

    tree.children = out;
  };
}
