"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ROUTES } from "@/lib/consts.ts";

// The ?discogs= result notice. Drops the query from the address once shown.
export default function DiscogsNotice({ value, username }: { value: string; username: string }) {
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("discogs");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {
      /* the notice still shows */
    }
  }, []);

  if (value === "connected") {
    return (
      <div className="notice" role="status">
        Connected{username ? ` as ${username}` : ""}. You&apos;re ready to price records.{" "}
        <Link href={ROUTES.home}>Price a record</Link>
      </div>
    );
  }
  if (value === "denied") {
    return (
      <div className="notice" role="status">
        You didn&apos;t approve the connection, so nothing changed.
      </div>
    );
  }
  if (value === "error") {
    return (
      <div className="notice" role="status">
        Connecting to Discogs didn&apos;t work. Try again.
      </div>
    );
  }
  if (value === "disconnected") {
    return (
      <div className="notice" role="status">
        Disconnected. This app no longer uses your Discogs account.
      </div>
    );
  }
  return null;
}
