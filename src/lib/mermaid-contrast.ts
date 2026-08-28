/**
 * Mermaid 노드 라벨 대비 보정 — 색 판정 부분(순수 로직).
 *
 * 다이어그램은 다크 테마로 렌더하므로 글자 기본색이 밝은 회색이다.
 * 그런데 다이어그램 안에서 `style`/`classDef`로 밝은 배경색을 지정한 노드는
 * 밝은 배경 + 밝은 글자가 되어 거의 읽히지 않는다.
 * 배경이 밝은 노드만 골라 글자를 검은색으로 바꾸기 위한 판정을 여기에 둔다.
 */

/** 밝은 배경 위에 올릴 글자색. 순검정보다 살짝 부드러운 값. */
export const DARK_LABEL_COLOR = '#111827';

/**
 * 밝기 임계값(0~255). 이 값을 넘으면 "밝은 배경"으로 본다.
 *
 * 파스텔 계열(#ffe0e0 등)은 200을 훌쩍 넘고, 다크 테마 기본 노드색(#1f2020 등)은
 * 50 미만이라 그 사이 어디를 잡아도 되지만, 순초록(#00ff00 → 149.7)처럼
 * 검은 글자가 확실히 나은 색이 경계 바로 아래에 있어 그보다 낮게 잡았다.
 */
const BRIGHTNESS_THRESHOLD = 140;

/** `#abc` / `#aabbcc` / `#aabbccdd` → [r, g, b, a]. 형식이 아니면 null. */
function parseHex(value: string): [number, number, number, number] | null {
  const hex = value.slice(1);
  const valid = /^[0-9a-f]+$/i.test(hex);
  if (!valid) return null;

  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b, a] = [...hex].map((char) => parseInt(char + char, 16));
    return [r, g, b, hex.length === 4 ? a / 255 : 1];
  }
  if (hex.length === 6 || hex.length === 8) {
    const pairs = hex.match(/../g) as string[];
    const [r, g, b, a] = pairs.map((pair) => parseInt(pair, 16));
    return [r, g, b, hex.length === 8 ? a / 255 : 1];
  }
  return null;
}

/** `rgb(1,2,3)` / `rgba(1,2,3,.5)` → [r, g, b, a]. 형식이 아니면 null. */
function parseRgb(value: string): [number, number, number, number] | null {
  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return null;

  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;

  const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
  return [parts[0], parts[1], parts[2], alpha];
}

/**
 * 채움색이 "밝은 배경"인지 판정한다.
 *
 * 판정할 수 없는 값(색 이름, `none`, 빈 값)은 **false**로 둔다 —
 * 확신이 없을 때 글자색을 건드리지 않는 편이 안전하다(원래 테마 색을 유지).
 * 거의 투명한 색도 뒤의 어두운 배경이 비치므로 밝다고 보지 않는다.
 */
export function isLightFill(fill: string | null | undefined): boolean {
  if (!fill) return false;

  // mermaid는 다이어그램이 지정한 스타일에 `!important`를 붙여 내보낸다.
  const value = fill.replace(/!\s*important/i, '').trim().toLowerCase();
  if (value === '' || value === 'none' || value === 'transparent') return false;

  const parsed = value.startsWith('#') ? parseHex(value) : parseRgb(value);
  if (!parsed) return false;

  const [r, g, b, alpha] = parsed;
  if (alpha < 0.5) return false;

  // 눈이 느끼는 밝기(ITU-R BT.601) — 초록에 가장 크게 반응한다.
  const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
  return brightness > BRIGHTNESS_THRESHOLD;
}
