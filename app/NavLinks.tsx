"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavLot } from "../lib/nav.ts";
import NavIcon from "./NavIcon.tsx";
import type { IconName } from "./NavIcon.tsx";

// `label` in the sidebar, `tab` under the icon in the phone tab bar.
const LINKS: { href: string; label: string; tab: string; icon: IconName }[] = [
  { href: "/", label: "Price a record", tab: "Price", icon: "record" },
  { href: "/collection", label: "Collections", tab: "Collections", icon: "lots" },
  { href: "/settings", label: "Settings", tab: "Settings", icon: "settings" },
];

export default function NavLinks({ collapsed, lots }: { collapsed: boolean; lots: { shown: NavLot[]; more: number } }) {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map(({ href, label, tab, icon }) => {
        const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <div key={href} className="nav-group">
            <Link
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={active ? "nav-item active" : "nav-item"}
              title={collapsed ? label : undefined}
            >
              <NavIcon name={icon} />
              <span className="nav-label">{label}</span>
              <span className="tab-label" aria-hidden="true">
                {tab}
              </span>
            </Link>
            {href === "/collection" && lots.shown.length > 0 && <LotLinks lots={lots} pathname={pathname} />}
          </div>
        );
      })}
    </nav>
  );
}

// Up to 3 recent lots under Lots in the expanded desktop sidebar (CSS hides it in the rail and the tab bar).
function LotLinks({ lots, pathname }: { lots: { shown: NavLot[]; more: number }; pathname: string }) {
  return (
    <ul className="nav-sub" aria-label="Recent collections">
      {lots.shown.map(({ id, name }) => {
        const href = `/collection/${id}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <li key={id}>
            <Link href={href} aria-current={active ? "page" : undefined} className={active ? "active" : undefined} title={name}>
              {name}
            </Link>
          </li>
        );
      })}
      {lots.more > 0 && (
        <li>
          <Link href="/collection" className="nav-more">
            +{lots.more} more
          </Link>
        </li>
      )}
    </ul>
  );
}
