// GET /api/health: public liveness check. Reports DB status, which env vars are set (names only) and where the
// session secret came from (env, file or none), and the running version (its deploy tag, or dev).
import { configStatus } from "../../../lib/auth.ts";
import { discogsAccess } from "../../../lib/discogs-access.ts";
import { getConnection } from "../../../lib/discogs-auth-store.ts";
import type { Connection } from "../../../lib/discogs-auth-store.ts";
import { getDb } from "../../../lib/db.ts";
import { appVersion } from "../../../lib/version.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let db = "ok";
  let connection: Connection | null = null;
  try {
    const d = getDb();
    d.prepare("select 1").get();
    connection = getConnection(d);
  } catch (e) {
    db = "error";
    console.error("health: db check failed:", e instanceof Error ? e.message : String(e));
  }
  // On a database error the connection is unknown: report from env alone (consumer vars set means not-connected).
  const access = discogsAccess(process.env, connection);
  const discogs = access.kind === "token" ? "token" : access.kind === "oauth" ? "connected" : access.reason;
  const config = configStatus(process.env, discogs);
  const ok = db === "ok" && config.ok;
  return Response.json({ ok, db, discogs, config: config.vars, sessionSecretSource: config.sessionSecretSource, version: appVersion(process.env) }, { status: ok ? 200 : 503 });
}
