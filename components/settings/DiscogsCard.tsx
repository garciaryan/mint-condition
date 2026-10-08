import type { DiscogsState } from "@/lib/discogs-state.ts";

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function DiscogsCard({ state, username, connectedAt }: DiscogsState) {
  return (
    <section className="card discogs-account" aria-labelledby="discogs-heading">
      <h2 id="discogs-heading">Discogs account</h2>
      {state === "token" && <p>Using a personal access token (<code>DISCOGS_TOKEN</code>).</p>}
      {state === "not-connected" && (
        <>
          <p>
            Connect your Discogs account so this app can look up records and your seller account&apos;s price suggestions.
            You&apos;ll approve it on discogs.com and come straight back.
          </p>
          <form method="post" action="/api/discogs/connect">
            <button type="submit">Connect Discogs</button>
          </form>
        </>
      )}
      {state === "connected" && (
        <>
          <p>
            Connected as <strong>{username}</strong>
            {connectedAt > 0 ? <> since {dateFmt.format(new Date(connectedAt))}</> : null}.
          </p>
          <form method="post" action="/api/discogs/disconnect">
            <button type="submit" className="secondary">
              Disconnect
            </button>
          </form>
          <p className="muted small">
            To remove this app&apos;s access completely, revoke it under Applications in your{" "}
            <a href="https://www.discogs.com/settings/applications" target="_blank" rel="noreferrer">
              Discogs settings
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            .
          </p>
        </>
      )}
      {state === "setup" && <p>Discogs isn&apos;t set up for this app (missing consumer key or token).</p>}
      <p className="muted small">This app only reads from Discogs. It doesn&apos;t list, buy or message for you.</p>
    </section>
  );
}
