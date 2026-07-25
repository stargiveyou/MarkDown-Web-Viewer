/**
 * `SESSION_PASSWORD` 해시 생성 CLI.
 *
 *   npm run hash-password                 # 대화형 입력(화면에 표시되지 않음)
 *   npm run hash-password -- '평문'        # 인자로 전달 (셸 히스토리에 남으니 주의)
 *   echo '평문' | npm run hash-password    # 표준입력
 *
 * 출력된 `scrypt:...` 한 줄을 `.env.local`의 `SESSION_PASSWORD=`에 붙여 넣는다.
 * **평문은 어디에도 저장하지 않는다.**
 *
 * `.mts` 확장자인 이유: Node 22의 타입 스트리핑으로 빌드 없이 바로 실행하기 위함이다
 * (ESM 고정). `server-only`를 import하는 모듈에는 의존하지 않는다 — Next 런타임 밖이라서다.
 *
 * 담당: security-auth / Stage 1
 */

import { DEFAULT_SCRYPT_PARAMS, hashPassword } from '../lib/password-hash.ts';

/** 최소 길이. 인터넷에 노출된 앱의 유일한 자격증명이므로 짧으면 곤란하다. */
const MIN_LENGTH = 12;

/** 파이프로 들어온 입력의 첫 줄. */
async function readPiped(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').split('\n')[0].trim();
}

/** 터미널에서 입력을 에코하지 않고 한 줄 받는다. */
function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';

    const finish = (fn: () => void): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stdout.write('\n');
      fn();
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') {
          finish(() => resolve(value));
          return;
        }
        if (char === '\u0003') {
          // Ctrl+C
          finish(() => reject(new Error('취소되었습니다.')));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const fromArgv = process.argv[2];
  let password: string;

  if (fromArgv !== undefined) {
    password = fromArgv;
  } else if (process.stdin.isTTY === true) {
    password = (await promptHidden('새 비밀번호: ')).trim();
  } else {
    password = await readPiped();
  }

  if (password.length === 0) {
    console.error('비밀번호가 비어 있습니다.');
    process.exitCode = 1;
    return;
  }
  if (password.length < MIN_LENGTH) {
    console.error(`비밀번호는 ${MIN_LENGTH}자 이상이어야 합니다. (입력: ${password.length}자)`);
    process.exitCode = 1;
    return;
  }

  const record = await hashPassword(password);

  console.log('');
  console.log('.env.local에 아래 한 줄을 넣으세요 (기존 값은 대체):');
  console.log('');
  console.log(`SESSION_PASSWORD=${record}`);
  console.log('');
  console.log(
    `(scrypt N=${DEFAULT_SCRYPT_PARAMS.N} r=${DEFAULT_SCRYPT_PARAMS.r} p=${DEFAULT_SCRYPT_PARAMS.p}, ` +
      'salt는 매번 새로 생성되므로 같은 비밀번호도 실행할 때마다 다른 해시가 나옵니다.)',
  );
  console.log('변경 후에는 서버를 재시작해야 적용됩니다. 기존 세션 쿠키는 만료 전까지 유효하므로,');
  console.log('즉시 전면 로그아웃하려면 SESSION_SECRET도 함께 교체하세요.');
}

main().catch((error: unknown) => {
  console.error('해시 생성 실패:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
