/**
 * `POST /api/ai/chat` -- Mac mini Claude Max CLI 기반 AI 파일 탐색 및 질의응답 API.
 *
 * 요청: JSON `{ query: string }`
 * 응답: `AiChatResponse` = `{ answer: string, relatedFiles: Array<{ path: string, snippet?: string }> }`
 *
 * 보안 및 인증:
 *   - middleware를 통해 세션 보호됨 (미인증 시 401).
 *   - CLI 실행 실패 시 FTS5 검색 기반의 스마트 폴백 지원.
 */

import { NextResponse } from 'next/server';
import { apiError, internalError } from '@/lib/api-response';
import { queryClaudeCli } from '@/lib/claude-cli';
import { search } from '@/lib/search-index';

export const runtime = 'nodejs';

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
      const reason = cliError instanceof Error ? cliError.message : String(cliError);
      console.warn('[AI Chat] Claude CLI 호출 실패 (폴백 모드 전환):', reason);

      // CLI 호출 불가 시 FTS5 검색 인덱스 기반의 폴백 응답 구성
      const ftsResults = search(query);
      const relatedFiles = ftsResults.slice(0, 5).map((r) => ({
        path: r.subpath,
        snippet: r.snippet,
      }));

      let fallbackAnswer = `(Mac mini Claude CLI 연결 대기 상태)\n\n입력하신 "${query}"와(과) 연관된 마크다운 파일 ${relatedFiles.length}건을 검색했습니다.`;
      if (relatedFiles.length > 0) {
        fallbackAnswer += `\n하단의 관련 파일 목록에서 원하는 문서를 선택하여 읽거나 편집하실 수 있습니다.`;
      } else {
        fallbackAnswer += `\n해당 키워드가 포함된 문서를 찾지 못했습니다. 다른 검색어로 시도해 보세요.`;
      }

      return NextResponse.json({
        answer: fallbackAnswer,
        relatedFiles,
        isFallback: true,
      });
    }
  } catch (error) {
    return internalError('AI Chat', error);
  }
}
