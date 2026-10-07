import { cookies } from "next/headers";
import { listSessions } from "@/lib/collection/store.ts";
import { getDb } from "@/lib/db.ts";
import { NAV_COOKIE, navLots, parseNavCookie } from "@/lib/nav.ts";
import { parseThemeCookie, THEME_COOKIE } from "@/lib/theme.ts";
import SiteNav from "@/app/SiteNav.tsx";

// Reads cookies and the collections (the sidebar submenu) at request time; pages using this must export
// `dynamic = "force-dynamic"` so it is never prerendered at build.
export default async function SiteHeader() {
  const jar = await cookies();
  const theme = parseThemeCookie(jar.get(THEME_COOKIE)?.value) ?? "system";
  const collapsed = parseNavCookie(jar.get(NAV_COOKIE)?.value);
  return <SiteNav theme={theme} initialCollapsed={collapsed} lots={recentLots()} />;
}

// Without a database the sidebar still works; Lots just has no submenu.
function recentLots() {
  try {
    return navLots(listSessions(getDb()), 3);
  } catch {
    return { shown: [], more: 0 };
  }
}
