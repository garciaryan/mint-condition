// POST /api/lookup: search by catalog number, or price a chosen release. Server-side only (holds the token).
import { DiscogsClient } from "../../../lib/discogs.ts";
import { httpStatus, missingEnv, parseLookupRequest, runLookup, toErrorResponse } from "../../../lib/lookup.ts";
import type { LookupResponse } from "../../../lib/lookup.ts";
import { loadSettings } from "../../../lib/settings.ts";

export const dynamic = "force-dynamic";

// One client per server process so its throttle covers every request. Kept on globalThis to survive dev reloads.
const g = globalThis as typeof globalThis & { __discogsClient?: DiscogsClient };
function client(): DiscogsClient {
  g.__discogsClient ??= new DiscogsClient({
    token: process.env.DISCOGS_TOKEN!.trim(),
    userAgent: process.env.DISCOGS_USER_AGENT!.trim(),
  });
  return g.__discogsClient;
}

function reply(res: LookupResponse): Response {
  return Response.json(res, { status: httpStatus(res) });
}

export async function POST(request: Request): Promise<Response> {
  const missing = missingEnv(process.env);
  if (missing.length > 0) {
    return reply({
      status: "error",
      kind: "missing-env",
      message: `Missing ${missing.join(" and ")}. Copy .env.example to .env.local, fill it in, and restart the dev server.`,
    });
  }

  let settings;
  try {
    settings = loadSettings();
  } catch (e) {
    return reply({ status: "error", kind: "settings", message: `settings.json is invalid: ${e instanceof Error ? e.message : e}` });
  }

  const parsed = parseLookupRequest(await request.json().catch(() => null));
  if (!parsed.ok) return reply({ status: "error", kind: "bad-request", message: parsed.message });

  try {
    return reply(await runLookup(client(), parsed.value, settings));
  } catch (e) {
    return reply(toErrorResponse(e));
  }
}
