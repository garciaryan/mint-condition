export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Before anything serves a request: a password-only setup gets its session secret from the data volume.
  (await import("./lib/session-secret.ts")).ensureSessionSecret(process.env, process.env.DATA_DIR ?? "./data");
  (await import("./lib/collection/worker.ts")).startWorkerOnBoot();
}
