import { authMode } from "../lib/auth.ts";
import LogoutButton from "./LogoutButton.tsx";
import NavLinks from "./NavLinks.tsx";

// Reads env at request time to decide whether to show Log out; pages using this must export
// `dynamic = "force-dynamic"` so it is never prerendered at build.
export default function SiteHeader() {
  const loggedIn = authMode(process.env).mode === "on";
  return (
    <div className="topbar">
      <span className="brand">Mint Condition</span>
      <NavLinks />
      {loggedIn && <LogoutButton />}
    </div>
  );
}
