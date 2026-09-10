/**
 * Mac mini의 Claude CLI 연동 유틸리티.
 *
 * Mac mini에 로그인된 `claude` (Claude Code / Claude Max CLI)를 `child_process.spawn`으로 실행하여
 * 디스크 내 파일 관련 자연어 검색 및 문맥 질의응답을 수행한다.
 *
 * 보안 및 성능:
 * 1. FTS5 검색 인덱스(`src/lib/search-index.ts`)로 1차 연관 문서를 선별하여 Prompt Context로 제공.
 * 2. 타임아웃(기본 30초) 및 프로세스 에러 처리.
 * 3. Path Safety 유틸로 파일 접근 경로 검증.
 */

import 'server-only';

import { spawn } from 'node:child_process';
import { search } from './search-index';

export interface AiChatResult {
  answer: string;
  relatedFiles: Array<{
    path: string;
    snippet?: string;
  }>;
}

/**
 * 사용자 질문을 받아 FTS5 1차 검색 결과를 바탕으로 맥미니 Claude CLI를 실행하여 답변을 생성한다.
 */
export async function queryClaudeCli(userQuery: string): Promise<AiChatResult> {
  const trimmedQuery = userQuery.trim();
  if (!trimmedQuery) {
    throw new Error('검색어를 입력해 주세요.');
  }

  // 1. FTS5 인덱스를 통해 관련도 높은 마크다운 파일 1차 탐색
  const ftsResults = search(trimmedQuery);
  const relatedFiles = ftsResults.slice(0, 5).map((r) => ({
    path: r.subpath,
    snippet: r.snippet,
  }));

  // 2. Claude CLI에 전달할 Prompt 구성
  let promptContext = `사용자 질문: "${trimmedQuery}"\n\n`;

  if (relatedFiles.length > 0) {
    promptContext += `관련 문서 검색 결과 (총 ${relatedFiles.length}건):\n`;
    relatedFiles.forEach((file, index) => {
      promptContext += `${index + 1}. 파일 경로: ${file.path}\n`;
      if (file.snippet) {
        // HTML 태그 제거된 스니펫
        const cleanSnippet = file.snippet.replace(/<[^>]*>/g, '');
        promptContext += `   내용 요약: ${cleanSnippet}\n`;
      }
    });
    promptContext += `\n위 관련 문서 정보 및 파일 시스템 지식을 바탕으로 사용자의 질문에 친절하고 정확하게 한국어로 답변해 주세요. 관련 파일 경로가 언급되면 답변 내에 [파일경로] 형식으로 명확히 포함해 주세요.`;
  } else {
    promptContext += `현재 검색어와 직접 매칭되는 문서를 찾지 못했습니다. 파일 구조나 일반 마크다운 파일 관련 질문이라면 친절하게 안내해 주세요.`;
  }

  // 3. 실행할 Claude CLI 경로 및 명령어 설정
  // 환경변수 CLAUDE_CLI_PATH가 없으면 시스템 PATH의 'claude' 사용
  const cliExecutable = process.env.CLAUDE_CLI_PATH || 'claude';

  return new Promise((resolve, reject) => {
    // Non-interactive print 모드로 claude CLI 실행
    // -p 옵션은 단발성 prompt 전달 후 결과를 출력하고 종료한다.
    const args = ['-p', promptContext];
    
    // MacOS/Linux 환경에서 실행.
    //
    // ⚠️ shell: true 를 쓰지 않는다. shell 을 켜면 command+args 가 따옴표 없이
    // 한 줄로 이어붙어, 공백·줄바꿈이 있는 promptContext 가 셸에서 단어 분리되어
    // `-p` 에 첫 토큰(예: "사용자")만 전달된다(실제 관측된 버그). 또한 사용자 입력이
    // 그대로 셸에 들어가 command injection 위험이 있다(보안 불변식 8/일반 원칙).
    // shell 없이 spawn 하면 promptContext 가 공백·한글 상관없이 하나의 argv 로
    // 안전하게 전달된다. 실행 파일은 PATH(또는 CLAUDE_CLI_PATH 절대경로)로 찾는다.
    const child = spawn(cliExecutable, args, {
      env: {
        ...process.env,
        // 비인터랙티브 터미널 힌트
        TERM: 'dumb',
      },
    });

    let stdoutData = '';
    let stderrData = '';
    let isSettled = false;

    // 타임아웃 설정 (30초)
    const timeoutTimer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        child.kill();
        reject(new Error('Claude CLI 응답 시간이 초과되었습니다. (30초)'));
      }
    }, 30000);

    child.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    child.on('error', (err) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timeoutTimer);
        reject(new Error(`Claude CLI 실행 실패: ${err.message}`));
      }
    });

    child.on('close', (code) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeoutTimer);

      if (code === 0 || stdoutData.trim().length > 0) {
        resolve({
          answer: stdoutData.trim() || '답변이 생성되지 않았습니다.',
          relatedFiles,
        });
      } else {
        reject(new Error(`Claude CLI 프로세스 오류 (종료 코드: ${code}): ${stderrData}`));
      }
    });
  });
}
