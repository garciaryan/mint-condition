// POST /api/discogs/connect (HTML form post; the gate enforces same-origin): starts the Discogs sign-in and sends the
// browser to discogs.com to approve it. Token mode goes back to /settings. A browser posted the form, so failures
// (database, missing setup) go back to /settings?discogs=error; the reason is logged server-side (names, never values).
import { dbUnavailable, getDb } from "../../../../lib/db.ts";
import { ConnectSetupError, routeDeps, startConnect } from "../../../../lib/discogs-connect.ts";
import { requireSession } from "../../../../lib/route-auth.ts";

export const dynamic = "force-dynamic";

const see = (location: string) => new Response(null, { status: 303, headers: { Location: location } });
const ERROR = "/settings?discogs=error";

export async function POST(request: Request): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  let db;
  try {
    db = getDb();
  } catch (e) {
    console.warn(`Connect Discogs can't start: ${dbUnavailable(e)}`);
    return see(ERROR);
  }
  const host = request.headers.get("host") ?? new URL(request.url).host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? null;
  try {
    const { location } = await startConnect(routeDeps(db), host, proto);
    return see(location);
  } catch (e) {
    if (e instanceof ConnectSetupError) {
      console.warn(`Connect Discogs can't start: ${e.message}`);
      return see(ERROR);
    }
    throw e;
  }
}
