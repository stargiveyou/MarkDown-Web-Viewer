'use client';

/**
 * PushToggle — 이 기기의 업로드 알림(Web Push) 켜기/끄기.
 *
 * iOS 조건:
 *   - 16.4 이상 + Safari "홈 화면에 추가"로 설치한 앱에서만 푸시가 된다.
 *     Safari 탭에서 열면 버튼을 눌렀을 때 설치 방법을 안내한다.
 *   - 권한 요청은 **사용자 탭 안에서** 해야 한다. 그래서 클릭 핸들러의 첫 await가
 *     `Notification.requestPermission()`이다 — 앞에 네트워크 왕복을 두면 제스처가 만료될 수 있다.
 *
 * 서버에 VAPID가 설정돼 있지 않거나 브라우저가 지원하지 않으면 버튼을 숨긴다.
 */

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react';

import { emitToast } from '@/components/ui/toast-bus';
import { ApiRequestError, apiFetch, toApiRequestError } from '@/lib/fetcher';
import {
  SERVICE_WORKER_PATH,
  detectPushSupport,
  readPushEnvironment,
  urlBase64ToUint8Array,
} from '@/lib/push-client';
import type { PushConfigResponse, PushOkResponse, PushSubscriptionJson } from '@/types/api';

type ToggleState = 'loading' | 'hidden' | 'needs-install' | 'denied' | 'off' | 'on';

const BUTTON_CLASS =
  'flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-wait disabled:opacity-60 sm:px-3';

function toSubscriptionJson(sub: PushSubscription): PushSubscriptionJson {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
  };
}

function reportError(err: unknown, fallback: string): void {
  // 서버 왕복이 아닌 브라우저 쪽 실패(서비스 워커 등록·PushManager.subscribe 거부 등)를
  // "서버에 연결할 수 없습니다"(502)로 접으면 원인을 오도한다 — 호출부 문구를 그대로 쓴다.
  if (!(err instanceof ApiRequestError)) {
    console.error('[push]', err);
    emitToast({ message: fallback, variant: 'error' });
    return;
  }
  const apiErr = toApiRequestError(err);
  // 401은 fetcher가 /login으로 보내고, 429는 fetcher가 토스트를 띄운다.
  if (apiErr.code === 401 || apiErr.code === 429) return;
  emitToast({ message: apiErr.message || fallback, variant: 'error' });
}

export function PushToggle() {
  const [state, setState] = useState<ToggleState>('loading');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- 초기 상태 판정 ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const support = detectPushSupport(readPushEnvironment());
      if (support === 'unsupported') {
        if (!cancelled) setState('hidden');
        return;
      }

      let config: PushConfigResponse;
      try {
        config = await apiFetch<PushConfigResponse>('/api/push/subscribe');
      } catch {
        if (!cancelled) setState('hidden');
        return;
      }
      if (cancelled) return;
      if (!config.enabled || !config.publicKey) {
        setState('hidden');
        return;
      }
      setPublicKey(config.publicKey);

      if (support === 'needs-install') {
        setState('needs-install');
        return;
      }

      try {
        // 알림 클릭 처리를 위해 항상 등록해 둔다(이미 있으면 같은 등록을 돌려준다).
        const reg = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
        const existing = await reg.pushManager.getSubscription();
        if (cancelled) return;

        if (Notification.permission === 'denied') {
          setState('denied');
        } else if (existing) {
          // 서버 DB가 초기화됐을 수 있으므로 조용히 다시 등록해 동기화한다.
          apiFetch<PushOkResponse>('/api/push/subscribe', {
            method: 'POST',
            body: JSON.stringify({ subscription: toSubscriptionJson(existing) }),
          }).catch(() => {});
          setState('on');
        } else {
          setState('off');
        }
      } catch (err) {
        console.error('[push] service worker registration failed:', err);
        if (!cancelled) setState('hidden');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // --- 켜기 ------------------------------------------------------------------
  const enable = useCallback(async () => {
    if (!publicKey) return;
    setBusy(true);
    try {
      // 제스처가 살아 있을 때 가장 먼저 권한을 요청한다.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        emitToast({ message: '알림 권한이 허용되지 않았습니다.', variant: 'error' });
        return;
      }

      const reg = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      await apiFetch<PushOkResponse>('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription: toSubscriptionJson(sub) }),
      });
      setState('on');

      // 실제 도착 확인용 — 실패해도 구독은 유지된다.
      try {
        await apiFetch<PushOkResponse>('/api/push/test', {
          method: 'POST',
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        emitToast({ message: '알림을 켰습니다. 테스트 알림을 보냈어요.', variant: 'success' });
      } catch (err) {
        reportError(err, '테스트 알림을 보내지 못했습니다.');
      }
    } catch (err) {
      reportError(err, '이 브라우저에서 알림을 켜지 못했습니다. 홈 화면 앱(iOS) 또는 일반 창에서 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }, [publicKey]);

  // --- 끄기 ------------------------------------------------------------------
  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await apiFetch<PushOkResponse>('/api/push/subscribe', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint }),
        });
      }
      setState('off');
      emitToast({ message: '이 기기의 알림을 껐습니다.', variant: 'success' });
    } catch (err) {
      reportError(err, '알림을 끄지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, []);

  const handleClick = useCallback(() => {
    if (busy) return;
    switch (state) {
      case 'needs-install':
        emitToast({
          message: 'Safari 공유 버튼 → "홈 화면에 추가"로 설치한 앱에서 알림을 켤 수 있습니다.',
          variant: 'info',
        });
        return;
      case 'denied':
        emitToast({
          message: '알림 권한이 꺼져 있습니다. 설정 → 알림에서 이 앱을 허용해 주세요.',
          variant: 'info',
        });
        return;
      case 'on':
        void disable();
        return;
      case 'off':
        void enable();
        return;
      default:
        return;
    }
  }, [busy, state, enable, disable]);

  if (state === 'loading' || state === 'hidden') return null;

  const label =
    state === 'on' ? '알림 켜짐' : state === 'denied' ? '알림 차단됨' : '업로드 알림 받기';
  const Icon = busy ? Loader2 : state === 'on' ? BellRing : state === 'denied' ? BellOff : Bell;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      aria-busy={busy}
      aria-pressed={state === 'on'}
      title={state === 'on' ? '이 기기의 업로드 알림 끄기' : '이 기기에서 업로드 알림 받기'}
      className={BUTTON_CLASS}
    >
      <Icon className={`h-4 w-4 ${busy ? 'animate-spin' : ''} ${state === 'on' ? 'text-amber-400' : ''}`} />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
