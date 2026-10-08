// What the pages show about the Discogs connection. Plain values only: never the token or secret.
import type { DatabaseSync } from "node:sqlite";
import { discogsAccess } from "./discogs-access.ts";
import { getConnection, type Connection } from "./discogs-auth-store.ts";

export type DiscogsState = {
  state: "token" | "connected" | "not-connected" | "setup";
  username: string;
  connectedAt: number;
};

type Env = Record<string, string | undefined>;

/** A database error never crashes a page: with consumer vars set it reads as not connected, else as setup. */
export function discogsState(env: Env, db: () => DatabaseSync): DiscogsState {
  let connection: Connection | null = null;
  let failed = false;
  try {
    connection = getConnection(db());
  } catch {
    failed = true;
  }
  const a = discogsAccess(env, connection);
  if (a.kind === "token") return { state: "token", username: "", connectedAt: 0 };
  if (a.kind === "oauth") return { state: "connected", username: a.username, connectedAt: connection?.connectedAt ?? 0 };
  if (a.reason === "setup") return { state: "setup", username: "", connectedAt: 0 };
  return { state: failed || !connection ? "not-connected" : "setup", username: "", connectedAt: 0 };
}
