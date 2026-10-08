// GET /api/discogs/callback: Discogs sends the browser back here after approve (or deny). Finishes the sign-in,
// resumes and starts the lookup worker once connected, and returns to /settings?discogs=<outcome>. Signed out, the gate
// sends the person to login first and back here afterwards.
import { kickWorker, resumeQueue } from "../../../../lib/collection/worker.ts";
import { getDb } from "../../../../lib/db.ts";
import { finishConnect, routeDeps } from "../../../../lib/discogs-connect.ts";
import { requireSession } from "../../../../lib/route-auth.ts";

export const dynamic = "force-dynamic";

const see = (location: string) => new Response(null, { status: 303, headers: { Location: location } });

export async function GET(request: Request): Promise<Response> {
  const denied = await requireSession(request);
  if (denied) return denied;
  let db;
  try {
    db = getDb();
  } catch {
    return see("/settings?discogs=error");
  }
  const { location } = await finishConnect(routeDeps(db), new URL(request.url).searchParams);
  if (location === "/settings?discogs=connected") {
    // A queue paused by a revoked connection's 401 restarts with the new one.
    resumeQueue();
    void kickWorker().catch(() => {});
  }
  return see(location);
}
