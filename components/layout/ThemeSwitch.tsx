"use client";

import { useState } from "react";
import { nextTheme, themeCookie } from "@/lib/theme.ts";
import type { ThemeChoice } from "@/lib/theme.ts";
import NavIcon from "@/components/layout/NavIcon.tsx";

const NAMES: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

// One button that cycles System → Light → Dark; the icon and label show the current choice.
export default function ThemeSwitch({ initial, collapsed }: { initial: ThemeChoice; collapsed: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);

  function change() {
    const next = nextTheme(choice);
    setChoice(next);
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    document.cookie = themeCookie(next);
  }

  const label = `Theme: ${NAMES[choice]}`;
  return (
    <button type="button" className="nav-item" onClick={change} title={collapsed ? label : undefined}>
      <NavIcon name={choice} />
      <span className="nav-label">{label}</span>
      <span className="tab-label" aria-hidden="true">
        Theme
      </span>
    </button>
  );
}
