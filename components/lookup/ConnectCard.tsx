// Shown when Discogs is not connected yet. A plain form POST, so it works without JavaScript.
export default function ConnectCard() {
  return (
    <div className="card connect-card">
      <h2 tabIndex={-1} data-focus>
        Discogs not connected
      </h2>
      <p>Connect your Discogs account to start pricing.</p>
      <form method="post" action="/api/discogs/connect">
        <button type="submit">Connect Discogs</button>
      </form>
    </div>
  );
}
