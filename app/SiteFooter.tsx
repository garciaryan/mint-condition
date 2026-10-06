import { NOT_AFFILIATED } from "../lib/discogs-terms.ts";
import NavIcon from "./NavIcon.tsx";

// Credits, and the notice the Discogs API terms require on every page. Plain links: no third-party scripts.
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="site-footer-links">
        <a className="coffee" href="https://www.buymeacoffee.com/rgarciadev" target="_blank" rel="noreferrer">
          <span aria-hidden="true">☕ </span>Buy me a coffee<span className="sr-only"> (opens in a new tab)</span>
        </a>
        <a className="nav-item" href="https://github.com/garciaryan/mint-condition#readme" target="_blank" rel="noreferrer" title="Docs">
          <NavIcon name="github" />
          <span className="sr-only">Docs (opens in a new tab)</span>
        </a>
      </p>
      <p>{NOT_AFFILIATED}</p>
    </footer>
  );
}
