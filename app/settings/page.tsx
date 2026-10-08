import { authMode } from "@/lib/auth.ts";
import { appVersion, versionUrl } from "@/lib/version.ts";
import SiteHeader from "@/components/layout/SiteHeader.tsx";
import AccountCard from "@/components/settings/AccountCard.tsx";
import DiscogsNotice from "@/components/settings/DiscogsNotice.tsx";
import { getDb } from "@/lib/db.ts";
import { discogsState } from "@/lib/discogs-state.ts";
import SettingsForm from "@/components/settings/SettingsForm.tsx";

export const metadata = { title: "Settings - Mint Condition" };
// SiteHeader and Log out read cookies and env at request time; never prerender at build.
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ discogs?: string | string[] }> }) {
  const { discogs } = await searchParams;
  const notice = Array.isArray(discogs) ? discogs[0] : discogs;
  const discogsInfo = discogsState(process.env, getDb);
  const loggedIn = authMode(process.env).mode === "on";
  const version = appVersion(process.env);
  const versionHref = versionUrl(version);
  return (
    <>
      <SiteHeader />
      <main className="page">
        <header className="masthead">
          <div className="masthead-text">
            <h1>Settings</h1>
            <p>Tune sell, local and offer prices. Changes apply to new lookups and every collection.</p>
          </div>
        </header>
        {notice && <DiscogsNotice value={notice} username={discogsInfo.username} />}
        <SettingsForm />
        <AccountCard discogs={discogsInfo} loggedIn={loggedIn} />
        <p className="app-version muted small">
          Version{" "}
          {versionHref ? (
            <a href={versionHref} target="_blank" rel="noreferrer">
              {version}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            version
          )}
        </p>
      </main>
    </>
  );
}
