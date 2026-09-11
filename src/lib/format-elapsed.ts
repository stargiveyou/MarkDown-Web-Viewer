/**
 * 경과 시간 표기 유틸. 클라이언트/서버 양쪽에서 쓸 수 있는 순수 함수다.
 *
 * AI 패널이 "질문 전송 → 답변 표시"까지 걸린 왕복 시간을 보여주는 데 쓴다.
 */

/**
 * 경과 시간을 사람이 읽는 형태로. 1분 미만은 `12.3초`, 이상은 `1분 5.2초`.
 *
 * 표시 단위(0.1초)로 **먼저** 반올림한 뒤 분 경계를 판단한다.
 * 원값으로 분기하면 59.96초가 `60.0초`, 119.96초가 `1분 60.0초`로 표시된다.
 *
 * 음수·NaN은 `0.0초`로 접는다 — 시간 표기가 계산 오류를 드러내는 자리는 아니다.
 */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0.0초';

  const totalSeconds = Math.round(ms / 100) / 10;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}초`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}분 ${seconds.toFixed(1)}초`;
}
