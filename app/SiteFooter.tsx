import { NOT_AFFILIATED } from "../lib/discogs-terms.ts";

// Credits, and the notice the Discogs API terms require on every page. Plain links: no third-party scripts.
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="site-footer-links">
        <a href="https://github.com/garciaryan" target="_blank" rel="noreferrer">
          GitHub<span className="sr-only"> (opens in a new tab)</span>
        </a>
        <a className="coffee" href="https://www.buymeacoffee.com/rgarciadev" target="_blank" rel="noreferrer">
          <span aria-hidden="true">☕ </span>Buy me a coffee<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
      <p>{NOT_AFFILIATED}</p>
    </footer>
  );
}
