"use client";

import { useState } from "react";
import { navCookie } from "../lib/nav.ts";
import type { NavLot } from "../lib/nav.ts";
import type { ThemeChoice } from "../lib/theme.ts";
import NavIcon from "./NavIcon.tsx";
import NavLinks from "./NavLinks.tsx";
import ThemeSwitch from "./ThemeSwitch.tsx";

// Sidebar on wider screens (expanded, or an icon rail once collapsed); a bottom tab bar on phones (CSS decides).
export default function SiteNav({
  theme,
  initialCollapsed,
  lots,
}: {
  theme: ThemeChoice;
  initialCollapsed: boolean;
  lots: { shown: NavLot[]; more: number };
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    setCollapsed(!collapsed);
    document.cookie = navCookie(!collapsed);
  }

  return (
    <header className={collapsed ? "site-nav collapsed" : "site-nav"}>
      <span className="brand">
        <svg className="brand-mark" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="11" fill="currentColor" />
          <circle cx="12" cy="12" r="3.5" fill="var(--card)" />
        </svg>
        <span className="nav-label">Mint Condition</span>
      </span>
      <NavLinks collapsed={collapsed} lots={lots} />
      <div className="nav-tools">
        {/* Same links as the footer, which shows them instead on phones (CSS decides). No third-party scripts. */}
        <div className="nav-links">
          <a className="coffee" href="https://www.buymeacoffee.com/rgarciadev" target="_blank" rel="noreferrer" title={collapsed ? "Buy me a coffee" : undefined}>
            <span aria-hidden="true">☕</span>
            <span className="nav-label">Buy me a coffee</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        <a
          className="nav-item nav-docs"
          href="https://github.com/garciaryan/mint-condition#readme"
          target="_blank"
          rel="noreferrer"
          title={collapsed ? "Docs" : undefined}
        >
          <NavIcon name="github" />
          <span className="nav-label">Docs</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <ThemeSwitch initial={theme} collapsed={collapsed} />
        <button
          type="button"
          className="nav-item nav-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : undefined}
          onClick={toggle}
        >
          <NavIcon name={collapsed ? "expand" : "collapse"} />
          <span className="nav-label" aria-hidden="true">
            Collapse
          </span>
        </button>
      </div>
    </header>
  );
}
