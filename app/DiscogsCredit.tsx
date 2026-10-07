import { DATA_CREDIT, MARKETPLACE_URL } from "@/lib/discogs-terms.ts";

// "Data provided by Discogs", linked to the discogs.com page holding the data (Discogs API terms). The link must pass
// ranking credit, so no rel value that withholds it.
export default function DiscogsCredit({ href = MARKETPLACE_URL }: { href?: string }) {
  return (
    <p className="discogs-credit muted small">
      <a href={href} target="_blank" rel="noreferrer">
        {DATA_CREDIT}
        <span aria-hidden="true"> ↗</span>
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </p>
  );
}
