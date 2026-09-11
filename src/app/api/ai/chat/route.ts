/**
 * `POST /api/ai/chat` -- Mac mini Claude Max CLI 기반 AI 파일 탐색 및 질의응답 API.
 *
 * 요청: JSON `{ query: string }`
 * 응답: `AiChatResponse` = `{ answer, relatedFiles, isFallback?, fallbackCode?, fallbackHint? }`
 *
 * `GET /api/ai/chat` -- CLI 연동 상태 진단(경로 탐지 여부만 반환).
 *
 * 보안 및 인증:
 *   - middleware를 통해 세션 보호됨 (미인증 시 401).
 *   - CLI 실행 실패 시 FTS5 검색 기반의 스마트 폴백 지원. 실패 **사유**는 함께 반환하되
 *     stderr 원문·스택트레이스는 서버 로그에만 남긴다(보안 불변식 8).
 */

import { NextResponse } from 'next/server';
import { apiError, internalError } from '@/lib/api-response';
import { ClaudeCliError, getClaudeCliStatus, queryClaudeCli } from '@/lib/claude-cli';
import { search } from '@/lib/search-index';

export const runtime = 'nodejs';

/** CLI 연동 상태 확인용. 절대경로는 내부 정보이므로 노출하지 않는다. */
export async function GET(): Promise<NextResponse> {
  const status = getClaudeCliStatus();
  return NextResponse.json({
    cliAvailable: status.available,
    hint: status.available
      ? null
      : 'claude 실행 파일을 찾지 못했습니다. .env.local의 CLAUDE_CLI_PATH를 확인하세요.',
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.query !== 'string') {
      return apiError(400, '올바른 질문(query)을 입력해 주세요.');
    }

    const query = body.query.trim();
    if (query.length < 2) {
      return apiError(400, '질문은 2자 이상 입력해 주세요.');
    }

    try {
      // Mac mini 상의 Claude CLI 호출 시도
      const result = await queryClaudeCli(query);
      return NextResponse.json(result);
    } catch (cliError) {
      let code = 'SPAWN_FAILED';
      // 분류되지 않은 오류의 원문은 절대 클라이언트로 내보내지 않는다 —
      // 경로·환경 정보가 섞여 나올 수 있다(보안 불변식 8). 사유는 서버 로그에만.
      let hint = 'Claude CLI 호출에 실패했습니다. 서버 로그를 확인하세요.';
      let detail: string | undefined;

      if (cliError instanceof ClaudeCliError) {
        code = cliError.code;
        hint = cliError.hint;
        detail = cliError.detail;
      } else {
        detail = cliError instanceof Error ? cliError.stack : String(cliError);
      }

      // 원문(stderr 등)은 서버 로그 전용.
      console.warn(
        `[AI Chat] Claude CLI 호출 실패 (${code}) — 폴백 모드 전환: ${hint}`,
        detail ? `\n  detail: ${detail}` : '',
      );

      // CLI 호출 불가 시 FTS5 검색 인덱스 기반의 폴백 응답 구성
      const ftsResults = search(query);
      const relatedFiles = ftsResults.slice(0, 5).map((r) => ({
        path: r.subpath,
        snippet: r.snippet,
      }));

      let fallbackAnswer = `AI 응답을 받지 못해 문서 검색 결과로 대신합니다.\n사유: ${hint}\n\n입력하신 "${query}"와(과) 연관된 마크다운 파일 ${relatedFiles.length}건을 검색했습니다.`;
      if (relatedFiles.length > 0) {
        fallbackAnswer += `\n하단의 관련 파일 목록에서 원하는 문서를 선택하여 읽거나 편집하실 수 있습니다.`;
      } else {
        fallbackAnswer += `\n해당 키워드가 포함된 문서를 찾지 못했습니다. 다른 검색어로 시도해 보세요.`;
      }

      return NextResponse.json({
        answer: fallbackAnswer,
        relatedFiles,
        isFallback: true,
        fallbackCode: code,
        fallbackHint: hint,
      });
    }
  } catch (error) {
    return internalError('AI Chat', error);
  }
}
