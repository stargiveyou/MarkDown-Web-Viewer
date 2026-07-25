/**
 * 패스워드 해시 원시 함수 — scrypt (Node 내장 crypto).
 *
 * 이 모듈은 **의도적으로 `server-only`를 import하지 않는다.**
 *   - `src/lib/session.ts`(서버 전용)와
 *   - `src/scripts/hash-password.mts`(CLI, Next 런타임 밖)가
 *   같은 구현을 공유해야 하기 때문이다. 해시 알고리즘이 두 벌로 갈라지면
 *   "로그인은 되는데 스크립트가 만든 해시는 안 먹는" 사고가 난다.
 *
 * 여기에는 시크릿도, 환경변수 접근도 없다. 순수 함수만 둔다.
 *
 * bcrypt/argon2 같은 네이티브 의존성은 추가하지 않는다(ADR-005 범위 밖 + 빌드 취약성).
 *
 * 담당: security-auth / Stage 1
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * 저장 포맷: `scrypt:<N>:<r>:<p>:<saltBase64>:<hashBase64>`
 *
 * 파라미터를 레코드에 함께 저장하므로, 나중에 비용을 올려도
 * 기존 해시를 그대로 검증할 수 있다(마이그레이션 없이 점진 상향 가능).
 *
 * ⚠️ 구분자가 관례적인 `$`(PHC 형식)가 아니라 `:`인 이유:
 *    이 값은 `.env.local`에 손으로 붙여 넣는다. 그런데 dotenv는 `$`를 변수 참조로 해석해
 *    **따옴표로 감싸도** 값을 잘라먹는다(작은따옴표·큰따옴표 모두 무력. `\$` 이스케이프만 통한다).
 *    실제로 `scrypt$32768$...`을 넣었더니 서버가 읽은 값은 `scrypt`였다.
 *    base64 알파벳에 `:`가 없으므로 모호함 없이 안전하고, 사용자가 이스케이프를 신경 쓸 필요가 없다.
 *
 * 파싱은 관대하게 `$` 형식도 받아 준다(다른 도구가 만든 값을 붙여 넣는 경우 대비).
 */
export const SCRYPT_PREFIX = 'scrypt';

/** 레코드 필드 구분자. 출력은 항상 `:`, 파싱은 `:`와 `$` 모두 허용. */
const FIELD_SEPARATOR = ':';
const FIELD_SEPARATOR_PATTERN = /[:$]/;

/** 기본 비용 파라미터. N=2^15 → 약 128 * N * r = 32MiB 메모리. */
export const DEFAULT_SCRYPT_PARAMS = {
  N: 32768,
  r: 8,
  p: 1,
  keylen: 64,
} as const;

/**
 * scrypt maxmem 상한(bytes).
 * Node 기본값 32MiB로는 N=2^15,r=8을 돌릴 수 없어 명시적으로 올린다.
 */
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

/** 신뢰 가능한 상한. 잘못된 설정값으로 프로세스가 메모리를 통째로 먹는 것을 막는다. */
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 16;
const MAX_KEYLEN = 128;

/** 입력 패스워드 길이 상한. 무의미하게 긴 입력으로 CPU를 태우지 못하게 한다. */
export const MAX_PASSWORD_LENGTH = 1024;

export interface ScryptRecord {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/** 해시 레코드 파싱 실패. 설정 오류이므로 사용자에게 노출하지 않는다. */
export class PasswordHashError extends Error {
  constructor(reason: string) {
    super(`invalid password hash record: ${reason}`);
    this.name = 'PasswordHashError';
  }
}

function deriveKey(
  password: string,
  salt: Buffer,
  params: { N: number; r: number; p: number; keylen: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      // 정규화(NFC)해 두지 않으면 macOS/브라우저 간 유니코드 표기 차이로
      // 같은 비밀번호가 다른 해시를 만든다.
      password.normalize('NFC'),
      salt,
      params.keylen,
      { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM },
      (err, derived) => (err ? reject(err) : resolve(derived)),
    );
  });
}

/** 평문 패스워드 → 저장용 해시 레코드 문자열. */
export async function hashPassword(
  password: string,
  params: { N: number; r: number; p: number; keylen: number } = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new PasswordHashError('empty password');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordHashError('password too long');
  }
  const salt = randomBytes(16);
  const hash = await deriveKey(password, salt, params);
  return [
    SCRYPT_PREFIX,
    params.N,
    params.r,
    params.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join(FIELD_SEPARATOR);
}

/** 해시 레코드 문자열 파싱. 형식이 어긋나면 throw한다. */
export function parseScryptRecord(record: string): ScryptRecord {
  const parts = record.split(FIELD_SEPARATOR_PATTERN);
  if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) {
    throw new PasswordHashError('unexpected format');
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || N < 2 || N > MAX_N || (N & (N - 1)) !== 0) {
    throw new PasswordHashError('bad N');
  }
  if (!Number.isInteger(r) || r < 1 || r > MAX_R) throw new PasswordHashError('bad r');
  if (!Number.isInteger(p) || p < 1 || p > MAX_P) throw new PasswordHashError('bad p');

  const salt = Buffer.from(parts[4], 'base64');
  const hash = Buffer.from(parts[5], 'base64');
  if (salt.length < 8) throw new PasswordHashError('salt too short');
  if (hash.length < 16 || hash.length > MAX_KEYLEN) throw new PasswordHashError('bad hash length');

  return { N, r, p, salt, hash };
}

/** 문자열이 유효한 scrypt 레코드인지. env 검증에서 부팅 시점에 사용한다. */
export function isScryptRecord(value: string): boolean {
  try {
    parseScryptRecord(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * 입력 패스워드를 저장된 레코드와 **timing-safe**하게 비교한다.
 *
 * 조기 반환하는 `===` 문자열 비교를 쓰지 않는다. 길이가 다른 경우에도
 * 분기 시점이 관측되지 않도록 항상 KDF를 끝까지 수행한 뒤 고정 길이 버퍼를 비교한다.
 */
export async function verifyPasswordAgainstRecord(
  password: string,
  record: ScryptRecord,
): Promise<boolean> {
  // 길이 상한을 넘긴 입력도 즉시 false로 빠지지 않는다. 빈 문자열로 대체해
  // KDF를 한 번 돌린 뒤 마지막에 기각한다 — "입력이 너무 길다"는 사실이
  // 응답 시간 차이로 새어 나가지 않게 하기 위해서다.
  const rejected = typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH;
  const candidate = rejected ? '' : password;

  const derived = await deriveKey(candidate, record.salt, {
    N: record.N,
    r: record.r,
    p: record.p,
    // keylen을 저장된 해시 길이에 맞춰야 timingSafeEqual이 길이 예외를 던지지 않는다.
    keylen: record.hash.length,
  });

  const ok = timingSafeEqual(derived, record.hash);
  return ok && !rejected;
}
