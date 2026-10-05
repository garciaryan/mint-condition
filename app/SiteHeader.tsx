import { cookies } from "next/headers";
import { authMode } from "../lib/auth.ts";
import { parseThemeCookie, THEME_COOKIE } from "../lib/theme.ts";
import LogoutButton from "./LogoutButton.tsx";
import NavLinks from "./NavLinks.tsx";
import ThemeSwitch from "./ThemeSwitch.tsx";

// Reads env at request time to decide whether to show Log out; pages using this must export
// `dynamic = "force-dynamic"` so it is never prerendered at build.
export default async function SiteHeader() {
  const loggedIn = authMode(process.env).mode === "on";
  const theme = parseThemeCookie((await cookies()).get(THEME_COOKIE)?.value) ?? "system";
  return (
    <div className="topbar">
      <span className="brand">Mint Condition</span>
      <NavLinks />
      <ThemeSwitch initial={theme} />
      {loggedIn && <LogoutButton />}
    </div>
  );
}
