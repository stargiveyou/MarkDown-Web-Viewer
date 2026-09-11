'use client';

/**
 * 하단 AI 파일 탐색 & 문맥 질의응답 패널.
 *
 * Mac mini의 Claude Max CLI 및 FTS5 검색과 연동하여
 * 자연어로 파일을 검색하고 질문에 대한 답변 및 연관 파일 바로가기 칩을 제공한다.
 */

import { useState, useRef, useEffect } from 'react';
import { AlertTriangle, Bot, ChevronDown, ChevronUp, FileText, Send, Sparkles } from 'lucide-react';
import type { AiChatResponse } from '@/types/api';

/**
 * 클라이언트 타임아웃(ms).
 * 서버(`AI_CLI_TIMEOUT_MS`, 기본 120초)보다 넉넉히 잡는다 — 서버가 먼저 폴백을 만들게 해서
 * "사유 없는 네트워크 오류" 대신 원인이 적힌 답변이 오도록 한다.
 */
const REQUEST_TIMEOUT_MS = 150_000;

export interface BottomAiPanelProps {
  /** 파일 칩 클릭 시 해당 마크다운 문서/폴더로 이동 */
  onSelectFile?: (path: string) => void;
}

interface MessageItem {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  relatedFiles?: Array<{ path: string; snippet?: string }>;
  isFallback?: boolean;
}

export function BottomAiPanel({ onSelectFile }: BottomAiPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<MessageItem[]>([
    {
      id: 'welcome',
      sender: 'ai',
      text: '안녕하세요! Mac mini에 연결된 Claude AI입니다. 저장된 마크다운 문서 검색 및 관련 질의응답을 물어보세요.',
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 메시지 추가 시 스크롤 하단 자동 이동
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || isLoading) return;

    const userMsgId = Date.now().toString();
    const newMsg: MessageItem = {
      id: userMsgId,
      sender: 'user',
      text: trimmed,
    };

    setMessages((prev) => [...prev, newMsg]);
    setQuery('');
    setIsLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
        signal: controller.signal,
      });

      if (res.status === 401) {
        // 세션 만료 — 미들웨어 정책과 동일하게 로그인으로 돌려보낸다.
        window.location.href = '/login';
        return;
      }

      if (!res.ok) {
        throw new Error(`AI 질의 응답 요청에 실패했습니다. (HTTP ${res.status})`);
      }

      const data: AiChatResponse = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'ai',
          text: data.answer,
          relatedFiles: data.relatedFiles,
          isFallback: data.isFallback,
        },
      ]);
    } catch (err) {
      const reason =
        err instanceof DOMException && err.name === 'AbortError'
          ? `응답이 ${Math.round(REQUEST_TIMEOUT_MS / 1000)}초 안에 오지 않아 요청을 중단했습니다.`
          : err instanceof Error
            ? err.message
            : '요청을 처리할 수 없습니다.';
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'ai',
          text: `오류가 발생했습니다: ${reason}`,
          isFallback: true,
        },
      ]);
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);
    }
  };

  return (
    <aside className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none flex justify-center px-4">
      <div
        className={`pointer-events-auto w-full max-w-4xl bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-t-2xl shadow-2xl transition-all duration-300 flex flex-col ${
          isOpen ? 'h-96' : 'h-13'
        }`}
      >
        {/* 헤더 / 토글 바 */}
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-between px-5 py-3 cursor-pointer border-b border-slate-800/80 hover:bg-slate-800/40 rounded-t-2xl select-none"
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-sm">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              Mac mini Claude AI 파일 탐색기
              <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Claude Max
              </span>
            </span>
          </div>

          <div className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors">
            <span className="text-xs">{isOpen ? '접기' : 'AI 질문 및 검색'}</span>
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </div>
        </div>

        {/* 펼쳐졌을 때의 본문 영역 */}
        {isOpen && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* 대화 히스토리 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                      msg.sender === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-none'
                        : msg.isFallback
                          ? 'bg-amber-950/40 text-amber-100 border border-amber-600/40 rounded-bl-none'
                          : 'bg-slate-800 text-slate-200 border border-slate-700/60 rounded-bl-none'
                    }`}
                  >
                    {msg.isFallback && (
                      <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Claude CLI 응답 없음
                      </div>
                    )}
                    <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>

                    {/* 연관 파일 칩 목록 */}
                    {msg.relatedFiles && msg.relatedFiles.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-slate-700/80 flex flex-wrap gap-1.5">
                        <span className="w-full text-[11px] font-medium text-slate-400 mb-0.5">
                          관련 문서 바로가기:
                        </span>
                        {msg.relatedFiles.map((file) => (
                          <button
                            key={file.path}
                            onClick={() => onSelectFile?.(file.path)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900/80 hover:bg-indigo-950 hover:text-indigo-300 text-slate-300 text-xs border border-slate-700 hover:border-indigo-500/50 transition-all cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5 text-indigo-400" />
                            <span className="truncate max-w-[200px]">{file.path}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex items-center gap-2 text-slate-400 text-xs italic pl-2">
                  <Bot className="w-4 h-4 animate-bounce text-indigo-400" />
                  Mac mini Claude AI가 답변을 생성 중입니다...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 입력 폼 */}
            <form onSubmit={handleSubmit} className="p-3 border-t border-slate-800 bg-slate-950/60 flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="예: 보안 패스워드 설정 문서 찾아줘, 최근 수정된 마크다운 요약"
                className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !query.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <span>전송</span>
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}
