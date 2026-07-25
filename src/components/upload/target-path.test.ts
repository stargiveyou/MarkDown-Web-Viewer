import { describe, expect, it } from 'vitest';

import { normalizeTargetPath } from './target-path';

/**
 * frontend-validator F1 회귀 방지.
 *
 * 정규화는 **전송 시점 규칙**이다. 키 입력마다 적용하면 후행 `/`가 즉시 지워져
 * `2026-Travel/Jeju` 같은 하위 폴더 경로를 타이핑할 수 없게 된다.
 */
describe('normalizeTargetPath', () => {
  it('선행/후행 슬래시와 공백을 제거한다', () => {
    expect(normalizeTargetPath('  /2026-Travel/Jeju/  ')).toBe('2026-Travel/Jeju');
    expect(normalizeTargetPath('///a///')).toBe('a');
  });

  it('중간 구분자는 보존한다', () => {
    expect(normalizeTargetPath('2026-Travel/Jeju')).toBe('2026-Travel/Jeju');
  });

  it('루트(빈 값)는 빈 문자열로 남는다 — 이때 targetPath 필드를 보내지 않는다', () => {
    expect(normalizeTargetPath('')).toBe('');
    expect(normalizeTargetPath('   ')).toBe('');
    expect(normalizeTargetPath('/')).toBe('');
  });

  it('타이핑 도중 값(후행 슬래시 포함)이 입력 상태에서 소실되지 않아야 한다', () => {
    // 입력 상태는 원문을 그대로 보관한다 = 각 중간 단계가 다음 글자의 접두사로 유지된다.
    const target = '2026-Travel/Jeju';
    const typed: string[] = [];
    for (let i = 1; i <= target.length; i += 1) typed.push(target.slice(0, i));

    // 중간 단계 '2026-Travel/'은 그대로 유지되어야 다음 글자가 이어 붙는다.
    expect(typed).toContain('2026-Travel/');
    for (let i = 1; i < typed.length; i += 1) {
      expect(typed[i].startsWith(typed[i - 1])).toBe(true);
    }

    // 반면 정규화를 매 입력에 걸면 '/'가 사라져 접두사 관계가 깨진다(회귀 시 이 단언이 실패).
    const normalizedWhileTyping = typed.map(normalizeTargetPath);
    expect(normalizedWhileTyping).toContain('2026-Travel');
    expect(normalizedWhileTyping).not.toContain('2026-Travel/');

    // 최종 전송 값은 정규화해도 동일하다.
    expect(normalizeTargetPath(typed[typed.length - 1])).toBe(target);
  });
});
