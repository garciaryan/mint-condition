"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { ThemeChoice } from "../lib/theme.ts";
import LogoutButton from "./LogoutButton.tsx";
import NavLinks from "./NavLinks.tsx";
import ThemeSwitch from "./ThemeSwitch.tsx";
import { useDisclosure } from "./useDisclosure.ts";

// Nav, theme and log out: inline in the header on wider screens, behind a Menu button on phones (CSS decides).
export default function SiteMenu({ theme, loggedIn }: { theme: ThemeChoice; loggedIn: boolean }) {
  const { open, toggle, close, root, button } = useDisclosure();
  const pathname = usePathname();
  useEffect(close, [pathname, close]);

  return (
    <div ref={root} className="site-menu">
      <button
        ref={button}
        type="button"
        className="menu-toggle"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="site-menu-panel"
        onClick={toggle}
      >
        <span aria-hidden="true">☰</span>
      </button>
      <div id="site-menu-panel" className={open ? "site-menu-panel open" : "site-menu-panel"}>
        <NavLinks />
        <ThemeSwitch initial={theme} />
        {loggedIn && <LogoutButton />}
      </div>
    </div>
  );
}
