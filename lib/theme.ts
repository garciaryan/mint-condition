// Theme choice: "system" follows the device; light/dark are pinned in a cookie the root layout reads, so the server
// renders the right theme and the page never flashes. Pure and client-safe.

export type ThemeChoice = "system" | "light" | "dark";
export const THEME_COOKIE = "mc_theme";

/** The pinned theme from the cookie value, or null to follow the device. */
export function parseThemeCookie(value: string | undefined): "light" | "dark" | null {
  return value === "light" || value === "dark" ? value : null;
}

/** The theme button's next choice: system, light, dark, then back to system. */
export function nextTheme(choice: ThemeChoice): ThemeChoice {
  return choice === "system" ? "light" : choice === "light" ? "dark" : "system";
}

/** document.cookie string that pins a theme for a year, or clears the pin for "system". */
export function themeCookie(choice: ThemeChoice): string {
  return choice === "system"
    ? `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
    : `${THEME_COOKIE}=${choice}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
