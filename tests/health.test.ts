import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/health/route.ts";

test("health names where the session secret comes from, never its value", async () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { s: env.SESSION_SECRET, src: env.SESSION_SECRET_SOURCE };
  env.SESSION_SECRET = "health-test-secret-value";
  env.SESSION_SECRET_SOURCE = "file";
  try {
    const text = await (await GET()).text();
    assert.equal(JSON.parse(text).sessionSecretSource, "file");
    assert.doesNotMatch(text, /health-test-secret-value/);
  } finally {
    for (const [k, v] of [["SESSION_SECRET", saved.s], ["SESSION_SECRET_SOURCE", saved.src]] as const) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
});
