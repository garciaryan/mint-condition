export async function register() {
  // Node-only work stays inside this block: Next also compiles this file for the edge runtime, and in dev webpack only
  // drops these imports when they sit in the if (not after an early return). tests/instrumentation.test.ts checks it.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Before anything serves a request: a password-only setup gets its session secret from the data volume.
    (await import("./lib/session-secret.ts")).ensureSessionSecret(process.env, process.env.DATA_DIR ?? "./data");
    (await import("./lib/collection/worker.ts")).startWorkerOnBoot();
  }
}
