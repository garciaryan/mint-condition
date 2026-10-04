// Ordered schema steps. Append only; never edit a shipped step. user_version records how many have run.
import type { DatabaseSync } from "node:sqlite";

export const migrations: string[] = [];

export function migrate(db: DatabaseSync, steps: string[]): number {
  const row = db.prepare("pragma user_version").get() as { user_version: number };
  let version = row.user_version;
  for (let i = version; i < steps.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(steps[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    version = i + 1;
  }
  return version;
}
