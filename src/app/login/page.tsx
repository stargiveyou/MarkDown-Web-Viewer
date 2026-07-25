'use client';

/**
 * 로그인 페이지 — 계약상 유일한 무인증 라우트(`POST /api/auth/login`)를 소비한다.
 *
 * 성공 시 `?next=`로 지정된 내부 경로(기본 `/workspace`)로 이동한다.
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiRequestError, NEXT_PARAM, apiFetch } from '@/lib/fetcher';
import type { LoginRequest, LoginResponse } from '@/types/api';

const DEFAULT_REDIRECT = '/workspace';

/**
 * 오픈 리다이렉트 차단 — 앱 내부의 절대 경로만 허용한다.
 * `//evil.com`, `/\evil.com`, `https://…`는 전부 기본값으로 되돌린다.
 */
function safeNext(raw: string | null): string {
  if (!raw) return DEFAULT_REDIRECT;
  if (!raw.startsWith('/')) return DEFAULT_REDIRECT;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_REDIRECT;
  if (raw === '/login' || raw.startsWith('/login?')) return DEFAULT_REDIRECT;
  return raw;
}

function messageForError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    // 401은 "세션 없음"이 아니라 이 화면에서는 "패스워드 불일치"를 뜻한다.
    if (error.code === 401 || error.code === 400) return '패스워드가 올바르지 않습니다.';
    return error.message;
  }
  return '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // form onSubmit이므로 Enter 키 제출이 기본 동작으로 보장된다.
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    if (password.length === 0) {
      setError('패스워드를 입력해 주세요.');
      inputRef.current?.focus();
      return;
    }

    setPending(true);
    setError(null);

    try {
      const body: LoginRequest = { password };
      await apiFetch<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      setPassword('');
      const target = safeNext(searchParams.get(NEXT_PARAM));
      router.replace(target);
      // 세션 쿠키 기준으로 서버 컴포넌트를 다시 평가하게 한다.
      router.refresh();
    } catch (caught) {
      setError(messageForError(caught));
      setPending(false);
      inputRef.current?.select();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Husky Works MDs
      </h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        계속하려면 패스워드를 입력하세요.
      </p>

      <label htmlFor="password" className="mt-6 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        패스워드
      </label>
      <input
        id="password"
        ref={inputRef}
        type="password"
        name="password"
        autoComplete="current-password"
        value={password}
        disabled={pending}
        onChange={(event) => {
          setPassword(event.target.value);
          if (error) setError(null);
        }}
        aria-invalid={error !== null}
        aria-describedby={error ? 'login-error' : undefined}
        className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus-visible:border-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:border-zinc-100 dark:focus-visible:ring-zinc-100/20"
        placeholder="••••••••"
      />

      {/* 에러 상태 */}
      {error && (
        <p id="login-error" role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-100"
      >
        {/* 로딩 상태 */}
        {pending && (
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        {pending ? '확인 중…' : '로그인'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-6 font-sans dark:bg-black">
      {/* useSearchParams는 Suspense 경계가 필요하다(Next App Router 프리렌더 제약). */}
      <Suspense
        fallback={
          <div
            aria-busy="true"
            className="h-72 w-full max-w-sm animate-pulse rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
          />
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
