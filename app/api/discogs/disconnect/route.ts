// POST /api/discogs/disconnect (HTML form post; the gate enforces same-origin): forgets the stored Discogs connection
// and its cached answers. Revoking the app on discogs.com is up to the person (the settings page links there).
import { dbUnavailable, getDb } from "../../../../lib/db.ts";
import { clearConnection } from "../../../../lib/discogs-auth-store.ts";
import { requireSession } from "../../../../lib/route-auth.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  try {
    clearConnection(getDb());
  } catch (e) {
    return Response.json({ status: "error", kind: "database", message: dbUnavailable(e) }, { status: 500 });
  }
  return new Response(null, { status: 303, headers: { Location: "/settings?discogs=disconnected" } });
}
