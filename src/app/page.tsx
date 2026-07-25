import { redirect } from "next/navigation";

/**
 * 루트는 워크스페이스로 보낸다.
 * 미인증이면 middleware(security-auth 담당)가 `/login`으로 되돌린다.
 */
export default function Home() {
  redirect("/workspace");
}
