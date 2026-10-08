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

test("health reports the running version", async () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = env.NEXT_PUBLIC_APP_VERSION;
  try {
    env.NEXT_PUBLIC_APP_VERSION = "v0.1.0-alpha.4";
    assert.equal((await (await GET()).json()).version, "v0.1.0-alpha.4");
    delete env.NEXT_PUBLIC_APP_VERSION;
    assert.equal((await (await GET()).json()).version, "dev");
  } finally {
    if (saved === undefined) delete env.NEXT_PUBLIC_APP_VERSION;
    else env.NEXT_PUBLIC_APP_VERSION = saved;
  }
});
