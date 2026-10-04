// GET /api/health: public liveness check. Reports DB status and which env vars are set (names only).
import { configStatus } from "../../../lib/auth.ts";
import { getDb } from "../../../lib/db.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let db = "ok";
  try {
    getDb().prepare("select 1").get();
  } catch (e) {
    db = "error";
    console.error("health: db check failed:", e instanceof Error ? e.message : String(e));
  }
  const config = configStatus(process.env);
  const ok = db === "ok" && config.ok;
  return Response.json({ ok, db, config: config.vars }, { status: ok ? 200 : 503 });
}
