// POST /api/discogs/connect (HTML form post; the gate enforces same-origin): starts the Discogs sign-in and sends the
// browser to discogs.com to approve it. Token mode goes back to /settings.
import { dbUnavailable, getDb } from "../../../../lib/db.ts";
import { ConnectSetupError, routeDeps, startConnect } from "../../../../lib/discogs-connect.ts";
import { requireSession } from "../../../../lib/route-auth.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  let db;
  try {
    db = getDb();
  } catch (e) {
    return Response.json({ status: "error", kind: "database", message: dbUnavailable(e) }, { status: 500 });
  }
  const host = request.headers.get("host") ?? new URL(request.url).host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? null;
  try {
    const { location } = await startConnect(routeDeps(db), host, proto);
    return new Response(null, { status: 303, headers: { Location: location } });
  } catch (e) {
    if (e instanceof ConnectSetupError) return Response.json({ status: "error", kind: "missing-env", message: e.message }, { status: 503 });
    throw e;
  }
}
