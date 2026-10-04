// POST /api/logout: clear the session cookie.
import { SESSION_COOKIE } from "../../../lib/auth.ts";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const res = Response.json({ ok: true });
  res.headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
  return res;
}
