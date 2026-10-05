// Printable buy sheet for a lot: the owner's own copy (offers, walk-away, picks), not for the seller.
import Link from "next/link";
import { notFound } from "next/navigation";
import { buySheetRows } from "../../../../lib/collection/export.ts";
import { parseId } from "../../../../lib/collection/http.ts";
import { getSession, listItems } from "../../../../lib/collection/store.ts";
import { cash, offerNotes } from "../../../../lib/collection/ui.ts";
import { oldestPricedAt } from "../../../../lib/collection/view.ts";
import { getDb } from "../../../../lib/db.ts";
import { computeOffer, offerInputs } from "../../../../lib/offer.ts";
import type { OfferSide } from "../../../../lib/offer.ts";
import { relativeTime } from "../../../../lib/relative-time.ts";
import { getSettings } from "../../../../lib/settings-store.ts";
import SiteHeader from "../../../SiteHeader.tsx";
import PrintButton from "./PrintButton.tsx";

// SiteHeader reads env at request time; the sheet reads the database. Never prerender.
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };

function lotFor(raw: string) {
  const id = parseId(raw);
  return id === null ? null : getSession(getDb(), id);
}

export async function generateMetadata({ params }: Props) {
  const lot = lotFor((await params).id);
  return { title: lot ? `Buy sheet - ${lot.name} - Mint Condition` : "Buy sheet - Mint Condition" };
}

const records = (n: number) => `${n} ${n === 1 ? "record" : "records"}`;

function Ladder({ caption, side, opening, currency }: { caption: string; side: OfferSide; opening: number; currency: string }) {
  return (
    <div className="sheet-offer">
      <table className="sheet-ladder">
        <caption>{caption}</caption>
        <tbody>
          {side.rungs.map((r) => (
            <tr key={r.percent}>
              <th scope="row">
                {r.percent}%{r.percent === opening && " (opening)"}
              </th>
              <td>{r.overMax ? <s>{cash(r.amount, currency)}</s> : cash(r.amount, currency)}</td>
              <td>{r.overMax ? "over max" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Walk-away <b>{cash(side.walkAway, currency)}</b>
      </p>
    </div>
  );
}

export default async function BuySheetPage({ params }: Props) {
  const lot = lotFor((await params).id);
  if (!lot) notFound();

  let settings;
  try {
    settings = getSettings(getDb()).settings;
  } catch (e) {
    return (
      <main className="page sheet">
        <p role="alert">settings.json is invalid: {e instanceof Error ? e.message : String(e)}</p>
      </main>
    );
  }

  const items = listItems(getDb(), lot.id);
  const inputs = offerInputs(lot, settings);
  const offer = computeOffer(items, inputs, settings);
  const rows = buySheetRows(items, settings, inputs);
  const oldest = oldestPricedAt(items);
  const currency = settings.discogs.currency;
  const money = (n: number | null) => (n === null ? "" : cash(n, currency, true));
  const printed = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const steps = settings.offer.unverifiedSteps;

  return (
    <>
      <SiteHeader />
      <main className="page sheet">
        <div className="print-controls">
          <Link href={`/collection/${lot.id}`}>← Back to lot</Link>
          <PrintButton />
        </div>

        <header className="sheet-head">
          <h1>{lot.name}</h1>
          <p>
            Buy sheet · printed {printed} · {records(items.length)}
          </p>
          {lot.unverified && (
            <p>
              <b>
                Condition unverified (offers priced {steps === 1 ? "one grade" : `${steps} grades`} lower)
              </b>
            </p>
          )}
        </header>

        <section className="sheet-offers" aria-label="Offers">
          <Ladder caption={`Cherry-picks (${records(offer.picks)})`} side={offer.pickOnly} opening={offer.openingPercent} currency={currency} />
          <Ladder
            caption={`Whole lot (${records(offer.picks + offer.bulkCount)})`}
            side={offer.wholeLot}
            opening={offer.openingPercent}
            currency={currency}
          />
        </section>
        <p className="sheet-counts">
          {offer.picks} picks · {offer.bulkCount} bulk · {offer.unpricedCount} unpriced
          {offerNotes(offer, currency).map((n) => (
            <span key={n}> · {n}</span>
          ))}
        </p>

        <table className="sheet-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Checked</span>
              </th>
              <th scope="col">Catalog no.</th>
              <th scope="col">Title</th>
              <th scope="col">Grades</th>
              <th scope="col" className="num">
                Suggested
              </th>
              <th scope="col" className="num">
                Sell
              </th>
              <th scope="col">
                <span aria-hidden="true">★</span>
                <span className="sr-only">Pick</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="box" aria-hidden="true">
                  ☐
                </td>
                <td>{r.query}</td>
                <td>
                  {r.title ?? <span className="muted">—</span>}
                  {r.detail && <span className="muted"> · {r.detail}</span>}
                </td>
                <td>
                  {r.record} / {r.sleeve}
                </td>
                {r.suggested === null ? (
                  <td colSpan={2} className="muted">
                    {r.statusLabel}
                  </td>
                ) : (
                  <>
                    <td className="num">
                      {money(r.suggested)}
                      {r.statusLabel && <span className="muted small sheet-flag"> {r.statusLabel}: earlier price</span>}
                    </td>
                    <td className="num">{money(r.sell)}</td>
                  </>
                )}
                <td>{r.isPick ? "★" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="sheet-foot muted small">
          <p>Discogs asking prices and suggestions, not confirmed sales.</p>
          {oldest !== null && Date.now() - oldest > 3_600_000 && <p>Oldest prices: {relativeTime(oldest)}</p>}
        </footer>
      </main>
    </>
  );
}
