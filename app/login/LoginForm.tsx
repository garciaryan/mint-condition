"use client";

import { useState } from "react";
import type { FormEvent } from "react";

export default function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await r.json().catch(() => ({}))) as { retryAfterMinutes?: number; message?: string };
      if (r.ok) {
        location.assign(next);
        return;
      }
      if (r.status === 401) setError("Wrong password.");
      else if (r.status === 429) setError(`Too many attempts. Try again in ${data.retryAfterMinutes ?? 15} ${(data.retryAfterMinutes ?? 15) === 1 ? "minute" : "minutes"}.`);
      else setError(data.message ?? "Could not log in.");
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  return (
    <form className="card login-card" onSubmit={submit}>
      <h2>Log in</h2>
      <div className="field">
        <label htmlFor="password">Password</label>
        <div className="password-row">
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "password-error" : undefined}
          />
          <button type="button" className="secondary" aria-pressed={show} onClick={() => setShow(!show)}>
            {show ? "Hide" : "Show"}
          </button>
        </div>
        {error && (
          <p id="password-error" className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button type="submit" disabled={busy}>
        {busy ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}
