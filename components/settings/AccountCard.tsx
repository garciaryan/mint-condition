import type { DiscogsState } from "@/lib/discogs-state.ts";
import LogoutButton from "@/components/layout/LogoutButton.tsx";
import DiscogsSection from "@/components/settings/DiscogsSection.tsx";

/** Settings' Account card: the Discogs connection, then Log out (only when login is on). */
export default function AccountCard({ discogs, loggedIn }: { discogs: DiscogsState; loggedIn: boolean }) {
  return (
    <section className="card account" aria-labelledby="account-heading">
      <h2 id="account-heading">Account</h2>
      <DiscogsSection {...discogs} />
      {loggedIn && (
        <div className="account-section" aria-labelledby="login-heading">
          <h3 id="login-heading">Login</h3>
          <LogoutButton />
        </div>
      )}
    </section>
  );
}
