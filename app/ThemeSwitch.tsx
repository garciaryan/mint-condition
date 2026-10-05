"use client";

import { useState } from "react";
import { themeCookie } from "../lib/theme.ts";
import type { ThemeChoice } from "../lib/theme.ts";

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "◐ System" },
  { value: "light", label: "☀ Light" },
  { value: "dark", label: "☾ Dark" },
];

export default function ThemeSwitch({ initial }: { initial: ThemeChoice }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);

  function change(next: ThemeChoice) {
    setChoice(next);
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    document.cookie = themeCookie(next);
  }

  return (
    <label className="theme-switch">
      <span className="sr-only">Theme</span>
      <select value={choice} onChange={(e) => change(e.target.value as ThemeChoice)}>
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
