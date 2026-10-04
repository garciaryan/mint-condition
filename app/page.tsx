import { authMode } from "../lib/auth.ts";
import Lookup from "./Lookup.tsx";
import LogoutButton from "./LogoutButton.tsx";

// Reads env at request time to decide whether to show Log out; never prerender at build.
export const dynamic = "force-dynamic";

export default function Home() {
  const loggedIn = authMode(process.env).mode === "on";
  return (
    <main className="page">
      <header className="masthead">
        <div className="masthead-text">
          <h1>Mint Condition</h1>
          <p>Price a record from its catalog number and grades, using Discogs marketplace data.</p>
        </div>
        {loggedIn && <LogoutButton />}
      </header>
      <Lookup />
    </main>
  );
}
