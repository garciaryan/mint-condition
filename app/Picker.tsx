"use client";

import { useMemo, useState } from "react";
import { groupCandidates } from "../lib/form.ts";
import type { Candidate } from "../lib/types.ts";

export default function Picker({
  candidates,
  year,
  onPick,
  autoFocusFilter = false,
}: {
  candidates: Candidate[];
  year?: number;
  onPick: (c: Candidate) => void;
  autoFocusFilter?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const groups = useMemo(() => groupCandidates(candidates, filter, year), [candidates, filter, year]);

  return (
    <div className="card">
      <div className="picker-head">
        <h2 tabIndex={-1} data-focus>
          {candidates.length} possible pressings
        </h2>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by country, label, format…"
          aria-label="Filter pressings"
          autoFocus={autoFocusFilter}
        />
      </div>
      <p className="muted">Pick the one that matches your copy (check the label, country and matrix if you can).</p>
      {groups.length === 0 && <p className="muted">Nothing matches that filter.</p>}
      {groups.map((g) => (
        <div key={g.title}>
          <h3 className="group-title">
            {g.title} <span className="muted">({g.items.length})</span>
          </h3>
          <ul className="candidates">
            {g.items.map((c) => (
              <li key={c.id}>
                <button type="button" className="candidate" onClick={() => onPick(c)}>
                  <Thumb src={c.thumb} />
                  <span className="candidate-main">
                    <strong>{c.title}</strong>
                    <span className="muted">
                      {[c.label, c.catno].filter(Boolean).join(" · ")} — {c.format ?? "format unknown"}
                    </span>
                  </span>
                  <span className="candidate-meta">
                    <span>{c.country ?? "—"}</span>
                    <span>{c.year ?? "year ?"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function Thumb({ src }: { src: string | null }) {
  // Plain <img>: Discogs thumbs are small and next/image would need remote config for no benefit here.
  return src ? <img className="thumb" src={src} alt="" loading="lazy" /> : <span className="thumb thumb-empty" />;
}
