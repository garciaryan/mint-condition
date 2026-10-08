import Lookup from "@/components/lookup/Lookup.tsx";
import ConnectCard from "@/components/lookup/ConnectCard.tsx";
import { getDb } from "@/lib/db.ts";
import { discogsState } from "@/lib/discogs-state.ts";
import SiteHeader from "@/components/layout/SiteHeader.tsx";

// SiteHeader reads cookies and the database at request time; never prerender at build.
export const dynamic = "force-dynamic";

export default function Home() {
  const { state } = discogsState(process.env, getDb);
  return (
    <>
      <SiteHeader />
      <main className="page">
        <header className="masthead">
          <div className="masthead-text">
            <h1>Price a record</h1>
            <p>Price a record from its catalog number and grades, using Discogs marketplace data.</p>
          </div>
        </header>
        {state === "not-connected" && <ConnectCard />}
        <Lookup connectShown={state === "not-connected"} />
      </main>
    </>
  );
}
