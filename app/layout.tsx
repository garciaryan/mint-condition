import { Kanit } from "next/font/google";
import { cookies } from "next/headers";
import { parseThemeCookie, THEME_COOKIE } from "@/lib/theme.ts";
import SiteFooter from "@/components/layout/SiteFooter.tsx";
import "@/app/globals.css";

export const metadata = { title: "Mint Condition" };

// Downloaded at build time and served from this app; browsers never contact Google.
const kanit = Kanit({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-kanit", display: "swap" });

async function pinnedTheme() {
  return parseThemeCookie((await cookies()).get(THEME_COOKIE)?.value);
}

// Browser bar colour: the pinned theme's card colour, or one per device setting when following the system.
export async function generateViewport() {
  const pinned = await pinnedTheme();
  const LIGHT = "#ffffff";
  const DARK = "#1a3249";
  return {
    width: "device-width",
    initialScale: 1,
    themeColor: pinned
      ? pinned === "dark" ? DARK : LIGHT
      : [
          { media: "(prefers-color-scheme: light)", color: LIGHT },
          { media: "(prefers-color-scheme: dark)", color: DARK },
        ],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // A pinned theme is rendered on the server so the page never flashes; without one, CSS follows the device.
  const theme = await pinnedTheme();
  return (
    <html lang="en" className={kanit.variable} data-theme={theme ?? undefined}>
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
