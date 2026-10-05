import SiteHeader from "../SiteHeader.tsx";
import SettingsForm from "./SettingsForm.tsx";

export const metadata = { title: "Settings - Mint Condition" };
// SiteHeader reads env at request time; never prerender at build.
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <header className="masthead">
          <div className="masthead-text">
            <h1>Settings</h1>
            <p>Tune sell, local and offer prices. Changes apply to new lookups and every lot.</p>
          </div>
        </header>
        <SettingsForm />
      </main>
    </>
  );
}
