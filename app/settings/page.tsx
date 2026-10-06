import { authMode } from "../../lib/auth.ts";
import LogoutButton from "../LogoutButton.tsx";
import SiteHeader from "../SiteHeader.tsx";
import SettingsForm from "./SettingsForm.tsx";

export const metadata = { title: "Settings - Mint Condition" };
// SiteHeader and Log out read cookies and env at request time; never prerender at build.
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const loggedIn = authMode(process.env).mode === "on";
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
        <SettingsForm />
        {loggedIn && (
          <section className="card account" aria-labelledby="account-heading">
            <h2 id="account-heading">Account</h2>
            <LogoutButton />
          </section>
        )}
      </main>
    </>
  );
}
