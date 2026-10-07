/**
 * 정적 프리렌더 페이지의 Suspense fallback + 하이드레이션 실패 복구.
 *
 * `useSearchParams`를 쓰는 페이지는 빌드 시 이 fallback만 담긴 HTML로 프리렌더된다.
 * 외부 링크(Discord/Slack 알림 등)로 직접 들어오면 이 HTML을 받고, JS 청크가 실행돼야
 * 본문으로 바뀐다. 청크가 404(서버 재빌드 후 남은 옛 HTML, iOS 홈 화면 앱의 캐시 스냅샷)로
 * 실패하면 화면이 "불러오는 중"에서 영원히 멈춘다.
 *
 * 그래서 복구 로직은 React 번들이 아니라 **HTML에 박힌 인라인 스크립트**로 둔다 —
 * 번들이 안 뜨는 상황을 번들로 고칠 수는 없기 때문이다.
 *
 * - `/_next/static/` 스크립트 로드 실패 또는 {@link BOOT_TIMEOUT_MS} 경과 후에도 fallback이 남아 있으면
 *   캐시를 우회하도록 {@link BOOT_RETRY_PARAM}을 붙여 한 번만 다시 연다.
 * - 이미 재시도한 URL이면 루프를 막고 수동 새로고침 링크만 보여 준다.
 * - 클라이언트 내비게이션 중 React가 만든 `<script>`는 실행되지 않으므로 앱 내 이동에는 영향이 없다.
 */

import { Loader2 } from 'lucide-react';

/** 재시도 표식 쿼리 파라미터. 정상 로드 후 페이지가 URL에서 지운다. */
export const BOOT_RETRY_PARAM = '__boot';

const BOOT_TIMEOUT_MS = 10_000;
const FALLBACK_ID = 'boot-fallback';
const STUCK_ID = 'boot-fallback-stuck';
const RELOAD_LINK_ID = 'boot-fallback-reload';

// 구형 iOS Safari에서도 돌도록 ES5 문법만 쓴다.
const BOOT_GUARD_SCRIPT = `(function(){
var P=${JSON.stringify(BOOT_RETRY_PARAM)},done=false;
function retryUrl(){var u=new URL(location.href);u.searchParams.set(P,String(Date.now()));return u.toString();}
function retry(){
if(done||!document.getElementById(${JSON.stringify(FALLBACK_ID)}))return;
done=true;
if(new URL(location.href).searchParams.has(P)){
var s=document.getElementById(${JSON.stringify(STUCK_ID)}),a=document.getElementById(${JSON.stringify(RELOAD_LINK_ID)});
if(a)a.href=retryUrl();if(s)s.hidden=false;return;}
location.replace(retryUrl());}
window.addEventListener('error',function(e){var t=e.target;if(t&&t.tagName==='SCRIPT'&&/\\/_next\\/static\\//.test(t.src||''))retry();},true);
setTimeout(retry,${BOOT_TIMEOUT_MS});
})();`;

export function BootFallback({ label }: { label: string }) {
  return (
    <div
      id={FALLBACK_ID}
      className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-950"
    >
      <div className="flex items-center">
        <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
        <span className="ml-2 text-sm text-zinc-500">{label}</span>
      </div>
      <p id={STUCK_ID} hidden className="text-sm text-zinc-500">
        화면이 열리지 않나요?{' '}
        <a id={RELOAD_LINK_ID} href="" className="text-amber-400 underline">
          새로고침
        </a>
      </p>
      <script dangerouslySetInnerHTML={{ __html: BOOT_GUARD_SCRIPT }} />
    </div>
  );
}
