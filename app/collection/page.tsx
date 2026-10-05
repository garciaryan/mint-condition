import SiteHeader from "../SiteHeader.tsx";
import LotsList from "./LotsList.tsx";

export const metadata = { title: "Lots - Mint Condition" };
// SiteHeader reads env at request time; never prerender at build.
export const dynamic = "force-dynamic";

export default function CollectionPage() {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <header className="masthead">
          <div className="masthead-text">
            <h1>Lots</h1>
            <p>Price a whole collection: add records to a lot and see the running total.</p>
          </div>
        </header>
        <LotsList />
      </main>
    </>
  );
}
