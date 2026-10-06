import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authMode, SESSION_COOKIE } from "./lib/auth.ts";
import { gate } from "./lib/gate.ts";

export const config = { runtime: "nodejs", matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

const g = globalThis as typeof globalThis & { __authOffWarned?: boolean };

export async function middleware(req: NextRequest) {
  if (!g.__authOffWarned && authMode(process.env).mode === "off") {
    g.__authOffWarned = true;
    console.warn("Login is disabled: APP_PASSWORD is unset.");
  }
  const result = await gate(
    {
      method: req.method,
      path: req.nextUrl.pathname,
      search: req.nextUrl.search,
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
      cookie: req.cookies.get(SESSION_COOKIE)?.value,
    },
    process.env,
    Date.now(),
  );
  switch (result.kind) {
    case "pass":
      return NextResponse.next();
    case "redirect":
      return NextResponse.redirect(new URL(result.location, req.url));
    case "json":
      return NextResponse.json(result.body, { status: result.status });
    case "text":
      return new NextResponse(result.body, { status: result.status, headers: { "content-type": "text/plain" } });
  }
}
