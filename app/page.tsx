import Lookup from "@/app/Lookup.tsx";
import SiteHeader from "@/app/SiteHeader.tsx";

// SiteHeader reads cookies and the database at request time; never prerender at build.
export const dynamic = "force-dynamic";

export default function Home() {
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
        <Lookup />
      </main>
    </>
  );
}
