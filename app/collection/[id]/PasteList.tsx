"use client";

import { useMemo, useState } from "react";
import { parseBulkLines } from "../../../lib/collection/parse.ts";
import { pasteSummary } from "../../../lib/collection/ui.ts";
import type { NewLine } from "../../../lib/collection/types.ts";

export default function PasteList({ onAdd }: { onAdd: (lines: NewLine[]) => Promise<string | null> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parseBulkLines(text), [text]);
  const count = parsed.lines.length;

  async function submit() {
    if (busy || count === 0) return;
    setBusy(true);
    setError(null);
    const err = await onAdd(parsed.lines);
    setBusy(false);
    if (err) setError(err);
    else setText("");
  }

  return (
    <div className="paste">
      <div className="field">
        <label htmlFor="paste-text">Catalog numbers, one per line (add a year after a comma or tab)</label>
        <textarea
          id="paste-text"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"SD 7208, 1971\nPCS 7088\nST 2001\t1964"}
          aria-describedby={error ? "paste-error" : "paste-preview"}
          spellCheck={false}
        />
      </div>
      <div className="paste-foot">
        <div id="paste-preview" aria-live="polite" className="small muted">
          {text.trim() ? pasteSummary(count, parsed.errors.map((e) => e.line)) : "Nothing pasted yet."}
          {parsed.errors.length > 0 && (
            <ul className="paste-errors">
              {parsed.errors.slice(0, 5).map((e) => (
                <li key={e.line}>
                  Line {e.line}: {e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className="primary" disabled={busy || count === 0} onClick={submit}>
          {busy ? "Adding…" : `Add ${count} ${count === 1 ? "record" : "records"}`}
        </button>
      </div>
      {error && (
        <p className="field-error" id="paste-error" role="alert">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
    </div>
  );
}
