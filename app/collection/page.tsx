import SiteHeader from "@/components/layout/SiteHeader.tsx";
import LotsList from "@/components/collection/LotsList.tsx";

export const metadata = { title: "Collections - Mint Condition" };
// SiteHeader reads cookies and the database at request time; never prerender at build.
export const dynamic = "force-dynamic";

export default function CollectionPage() {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <header className="masthead">
          <div className="masthead-text">
            <h1>Collections</h1>
            <p>Add records to a collection and see the running total.</p>
          </div>
        </header>
        <LotsList />
      </main>
    </>
  );
}
