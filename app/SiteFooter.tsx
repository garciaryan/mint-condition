import { NOT_AFFILIATED } from "../lib/discogs-terms.ts";

// The notice the Discogs API terms require on every page.
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>{NOT_AFFILIATED}</p>
    </footer>
  );
}
