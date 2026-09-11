/**
 * 경과 시간 표기 유틸 테스트.
 *
 * 분 경계 처리가 핵심이다 — 표시 단위로 반올림하기 전 원값으로 분기하면
 * 59.96초가 "60.0초", 119.96초가 "1분 60.0초"로 표시된다
 * (docs/valid/frontend-ai-panel-validation.md WARN-1).
 */

import { describe, expect, it } from 'vitest';

import { formatElapsed } from './format-elapsed';

describe('formatElapsed', () => {
  it('1분 미만은 0.1초 단위로 표기한다', () => {
    expect(formatElapsed(0)).toBe('0.0초');
    expect(formatElapsed(1_500)).toBe('1.5초');
    expect(formatElapsed(33_840)).toBe('33.8초');
    expect(formatElapsed(59_900)).toBe('59.9초');
  });

  it('반올림이 60초에 닿으면 "60.0초"가 아니라 "1분 0.0초"가 된다', () => {
    // 반올림 전 값(59.96)으로 분기하면 "60.0초"가 나왔다.
    expect(formatElapsed(59_960)).toBe('1분 0.0초');
    expect(formatElapsed(60_000)).toBe('1분 0.0초');
  });

  it('반올림이 다음 분에 닿으면 "1분 60.0초"가 아니라 "2분 0.0초"가 된다', () => {
    expect(formatElapsed(119_960)).toBe('2분 0.0초');
    expect(formatElapsed(120_000)).toBe('2분 0.0초');
  });

  it('1분 이상은 분과 초를 나눠 표기한다', () => {
    expect(formatElapsed(65_500)).toBe('1분 5.5초');
    expect(formatElapsed(125_300)).toBe('2분 5.3초');
    expect(formatElapsed(3_599_000)).toBe('59분 59.0초');
  });

  it('초 부분은 항상 60 미만이다', () => {
    // 0.05초 간격으로 훑어 "N분 60.0초" 같은 표기가 나오지 않는지 확인한다.
    // (클라이언트 타임아웃 150초를 넘는 구간까지 덮는다.)
    for (let ms = 0; ms <= 160_000; ms += 50) {
      const match = formatElapsed(ms).match(/^(?:(\d+)분 )?(\d+\.\d)초$/);
      expect(match).not.toBeNull();
      if (match) expect(Number(match[2])).toBeLessThan(60);
    }
  });

  it('음수·NaN·Infinity는 0으로 접는다', () => {
    expect(formatElapsed(-1)).toBe('0.0초');
    expect(formatElapsed(Number.NaN)).toBe('0.0초');
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe('0.0초');
  });
});
