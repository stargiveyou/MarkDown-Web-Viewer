import { describe, expect, it } from 'vitest';

import { isLightFill } from './mermaid-contrast';

describe('isLightFill', () => {
  it('treats pastel node fills as light', () => {
    // 스크린샷에 나온 계열 — 분홍/노랑/연두 파스텔
    expect(isLightFill('#ffe0e0')).toBe(true);
    expect(isLightFill('#fff3cd')).toBe(true);
    expect(isLightFill('#d4f8d4')).toBe(true);
    expect(isLightFill('#ffffff')).toBe(true);
  });

  it('treats dark theme fills as not light', () => {
    expect(isLightFill('#1f2020')).toBe(false);
    expect(isLightFill('#000000')).toBe(false);
    expect(isLightFill('#333')).toBe(false);
  });

  it('understands shorthand hex', () => {
    expect(isLightFill('#fff')).toBe(true);
    expect(isLightFill('#111')).toBe(false);
  });

  it('understands rgb() and rgba()', () => {
    expect(isLightFill('rgb(255, 224, 224)')).toBe(true);
    expect(isLightFill('rgb(20, 20, 20)')).toBe(false);
    expect(isLightFill('rgba(255, 255, 255, 0.9)')).toBe(true);
  });

  it('ignores nearly transparent fills — 뒤의 어두운 배경이 비친다', () => {
    expect(isLightFill('rgba(255, 255, 255, 0.2)')).toBe(false);
    expect(isLightFill('#ffffff33')).toBe(false);
  });

  it('leaves the theme alone for values it cannot read', () => {
    expect(isLightFill('none')).toBe(false);
    expect(isLightFill('transparent')).toBe(false);
    expect(isLightFill('papayawhip')).toBe(false);
    expect(isLightFill('#12345')).toBe(false);
    expect(isLightFill('')).toBe(false);
    expect(isLightFill(null)).toBe(false);
    expect(isLightFill(undefined)).toBe(false);
  });

  it('reads the !important that mermaid appends to diagram styles', () => {
    // mermaid는 style/classDef로 지정한 값을 `fill:#ffe0e0 !important`로 내보낸다.
    expect(isLightFill('#ffe0e0 !important')).toBe(true);
    expect(isLightFill('#1f2020 !important')).toBe(false);
    expect(isLightFill('rgb(255, 224, 224) !important')).toBe(true);
  });

  it('weighs green most, matching what the eye sees', () => {
    // 순수 초록은 밝게, 같은 값의 순수 파랑은 어둡게 읽힌다.
    expect(isLightFill('#00ff00')).toBe(true);
    expect(isLightFill('#0000ff')).toBe(false);
  });
});
