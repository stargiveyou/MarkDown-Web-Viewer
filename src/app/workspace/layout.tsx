/**
 * `/workspace/*` 공통 세그먼트 설정.
 *
 * 하위 페이지는 전부 `useSearchParams`를 쓰는 클라이언트 컴포넌트라, 기본값이면 빌드 시
 * Suspense fallback만 담긴 HTML로 **정적 프리렌더**된다. 그 HTML은 빌드 시점의 JS 청크
 * 해시를 가리키므로, 서버를 재빌드한 뒤 캐시(브라우저·iOS 홈 화면 앱 스냅샷·Web Push 클릭으로
 * 열린 창)에 남은 옛 HTML이 다시 쓰이면 청크가 404 나고 "불러오는 중"에서 멈춘다.
 *
 * `force-dynamic`이면 매 요청 렌더링되고 Next가 `Cache-Control: no-store`를 붙인다.
 * 인증된 화면이라 애초에 캐시될 이유도 없다(보안 불변식 1 보조).
 */

export const dynamic = 'force-dynamic';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
