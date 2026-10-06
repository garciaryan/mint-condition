import SiteHeader from "../../SiteHeader.tsx";
import LotView from "./LotView.tsx";

export const metadata = { title: "Collection - Mint Condition" };
// SiteHeader reads cookies and the database at request time; never prerender at build.
export const dynamic = "force-dynamic";

export default async function LotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <SiteHeader />
      <main className="page lot-page">
        <LotView id={Number(id)} />
      </main>
    </>
  );
}
