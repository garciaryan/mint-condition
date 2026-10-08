import Link from "next/link";
import { getDb } from "@/lib/db.ts";
import { discogsState } from "@/lib/discogs-state.ts";
import { ROUTES } from "@/lib/consts.ts";
import SiteHeader from "@/components/layout/SiteHeader.tsx";
import LotView from "@/components/collection/LotView.tsx";

export const metadata = { title: "Collection - Mint Condition" };
// SiteHeader reads cookies and the database at request time; never prerender at build.
export const dynamic = "force-dynamic";

export default async function LotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { state } = discogsState(process.env, getDb);
  return (
    <>
      <SiteHeader />
      <main className="page lot-page">
        {state === "not-connected" && (
          <div className="notice" role="status">
            Not connected to Discogs: records will be priced once you connect. <Link href={ROUTES.settings}>Settings</Link>
          </div>
        )}
        <LotView id={Number(id)} discogs={state} />
      </main>
    </>
  );
}
