# Runout Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the shared Picker, load each pressing's Discogs identifiers on demand, or for up to 25 showing pressings at
once. Then narrow the list by a typed runout fragment, with the match highlighted.

**Architecture:** A pure `lib/runout.ts` does the matching, highlight ranges and check planning. A new
`GET /api/releases/:id/identifiers` serves identifiers through the cached `releaseStats` (`release:<id>`). The Picker
holds a per-picker map of loaded identifiers and fetches one at a time.

**Tech Stack:** Next.js 15 App Router, TypeScript, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-07-runout-match-design.md`

## Global Constraints

- **Matching:** uppercase, and drop everything that isn't `A–Z`, `a–z` or `0–9`. Search every identifier's `value`
  only, never `type` or `description`. An empty normalized query matches everything, with no ranges.
- `RUNOUT_CHECK_CAP = 25`. The check is over the cap when more than 25 pressings are showing.
- **Copy, exactly:**
  - "Runouts" (accessible name "Runouts for <title>")
  - "Runout contains…" (`aria-label="Runout contains"`)
  - "Check runouts (N)"
  - "Checked X of Y"
  - "All runouts checked"
  - "Narrow to 25 or fewer pressings first (filter or year)."
  - "N pressings not checked yet"
  - "No checked pressing matches that runout."
  - "Loading runouts…"
  - "No runouts on Discogs"
  - "Retry"
- The route needs a session and runs the same env, database and settings checks as `/api/lookup`. Errors go through
  `toErrorResponse` and `httpStatus`.
- Fetches happen one at a time and are aborted on unmount. Identifiers live only in component state.
- `lib/` keeps relative imports, and `app/api/` uses relative imports. Components use `@/`. Colours only from tokens.
  Controls are 44px on phones.
- After every task: `npm test` and `npm run typecheck` pass.
- **Dev server:** the owner's `next dev` may be on :3000. Check pages with GET requests only. Build only in a scratch
  `git worktree` while it runs.

## Review Focus

1. Highlight ranges when the fragment appears twice in one value, or spans punctuation ("1577A" across "1577-A"). It
   must mark the right characters in the original text. Test in Task 1.
2. A pressing that fails to load (429 or upstream) during "Check runouts". The loop must keep going with the rest and
   show that pressing's Retry; one failure mustn't stop the run. Manual check in Task 3.
3. Closing the picker (or the Pick panel) mid-check: no request is left running, and no state is updated after
   unmount. Manual check in Task 3.
4. A runout query typed while nothing is loaded yet. It shows "N pressings not checked yet" with the Check button, not
   an empty "No checked pressing matches". Test the counting helper in Task 1.
5. The release id in the route path isn't a positive integer (`abc`, `-1`, `1.5`): 400, never a Discogs call. Test in
   Task 2.

---

### Task 1: `lib/runout.ts`

**Files:**
- Create: `lib/runout.ts`, `tests/runout.test.ts`

**Interfaces:**
- Consumes: `Identifier` from `lib/types.ts`.
- Produces:
  - `normalizeRunout(s: string): string`
  - `type RunoutHit = { identifier: Identifier; ranges: [number, number][] }`
  - `matchIdentifiers(identifiers: Identifier[], query: string): RunoutHit[]`
  - `RUNOUT_CHECK_CAP = 25`
  - `checkPlan(visibleIds: number[], loaded: ReadonlySet<number>): { toCheck: number[]; overCap: boolean }`
  - `uncheckedCount(visibleIds: number[], loaded: ReadonlySet<number>): number`

- [ ] **Step 1: Write failing tests.** `B` is `tests/fixtures/release-5193282.json` `.identifiers`.
  - `normalizeRunout("RVG BN-LP-1577-A... 9 M") === "RVGBNLP1577A9M"`
  - `matchIdentifiers(B, "1577a")` gives the values `["BN 1577-A", "RVG BN-LP-1577-A... 9 M"]`.
  - `matchIdentifiers(B, "rvg")` gives the two values starting with "RVG".
  - `matchIdentifiers(B, "bmi")` gives `[ "BMI" ]`.
  - `matchIdentifiers(B, "zzz")` gives `[]`.
  - Ranges: for `"BN 1577-A"` with query `"1577a"`, ranges are `[[3, 9]]`. For `"A1 A-1"` with `"a1"`, ranges are
    `[[0, 2], [3, 6]]`, every occurrence.
  - `matchIdentifiers(B, "")` and `matchIdentifiers(B, "-- .")` return all 5, each with `ranges: []`.
  - `checkPlan([1..25], ∅)` → `overCap: false`, `toCheck` length 25. `checkPlan([1..26], ∅)` → `overCap: true`.
    `checkPlan([1, 2, 3], {2})` → `toCheck: [1, 3]`.
  - `uncheckedCount([1, 2, 3], {2}) === 2`, and `uncheckedCount([], ∅) === 0`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement.** For ranges, map each kept character's original index, find every match start in the
  normalized string (allowing overlapping occurrences), and turn each into `[orig[start], orig[end - 1] + 1]`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(runout): normalize, match and highlight identifiers; check planning`.

### Task 2: `GET /api/releases/:id/identifiers`

**Files:**
- Create: `app/api/releases/[id]/identifiers/route.ts`, `tests/identifiers-route.test.ts`

**Interfaces:**
- Consumes: `getLookupClient().releaseStats(id)`, `missingEnv`, `toErrorResponse` and `httpStatus` from
  `lib/lookup.ts`, `parseId` and `errorJson` from `lib/collection/http.ts`, `requireSession`, `getDb` and
  `dbUnavailable`, `getSettings`.
- Produces: 200 `{ identifiers: Identifier[], fetchedAt: number }`, or an error body
  `{ status: "error", kind, message }` with its status code.

- [ ] **Step 1: Write failing tests.** Set up as in `tests/lookup-route.test.ts`, with `g.__mintDb` in memory, a
  signed session cookie and env set. Use a fake `g.__discogsClient` whose `releaseStats` counts calls and returns the
  fixture parsed by `parseReleaseStats`.
  - No cookie → 401.
  - Ids `abc`, `-1` and `1.5` → 400, with the fake never called.
  - A good id → 200 with 5 identifiers and a numeric `fetchedAt`. A second request → 200, with the fake still called
    only once (cache hit).
  - The fake returns `{ lowestPrice: null, currency: null, numForSale: 0 }` (a missing release) → `identifiers: []`.
  - The fake throws `new DiscogsError("…", 429)` → `kind: "rate-limited"`, with the status
    `httpStatus({ status: "error", kind: "rate-limited", message: "" })`.
  - Missing `DISCOGS_TOKEN` → `kind: "missing-env"`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL, the route module is missing.
- [ ] **Step 3: Implement** the route, mirroring `app/api/lookup/route.ts`'s order of checks.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): GET /api/releases/:id/identifiers through the release cache`.

### Task 3: Runouts in the Picker

**Files:**
- Modify: `components/lookup/Picker.tsx`, `app/globals.css`
- Test: `tests/discogs-terms.test.ts`, `tests/collection-ui.test.ts`

**Interfaces:**
- Consumes: Task 1's helpers, Task 2's route, `RUNOUT_CHECK_CAP`.
- Produces: no new exports. `Picker` props are unchanged, so the lookup and `PickPanel` both get the feature.

- [ ] **Step 1: Write failing tests:**
  - **Terms:** the only component file that fetches `/api/releases/` or renders identifier values is
    `components/lookup/Picker.tsx` (search `components/` for `/api/releases/`), and it still renders `<DiscogsCredit`.
  - **CSS:** `mark.runout-hit` (or `.runout-hit`) uses `var(--accent-soft)` and `var(--ink)`. `.runout-toggle` has
    `min-height: var(--control-h)` inside the phone block.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** as the spec's Picker UI section describes:
  - **State:** `runouts` is a `Map`, kept in `useState` and replaced on each update. Also `openIds` (a `Set`),
    `runoutQuery`, and `checking: { done, total } | null`.
  - **Loading:** `load(id)` calls `fetch('/api/releases/${id}/identifiers', { signal })`. A 401 sends the browser to
    `ROUTES.login(location.pathname)`, like `lib/collection/client.ts`'s `api`. Reuse `api()` from
    `lib/collection/client.ts` if it takes a signal, which it does.
  - **"Check runouts":** awaits `load` for each id in `checkPlan(visibleIds, loaded).toCheck`, one after another,
    updating `checking` as it goes. A failed load records an error for that pressing and the loop continues.
  - **Unmount:** one `AbortController` per Picker, aborted on unmount. Every state setter checks `!signal.aborted`.
  - **What's showing:** `visibleIds` are the ids in the groups after the text filter. When the runout query isn't
    empty, the groups are filtered to pressings that are loaded and match, and their panels show only the matching
    identifiers.
  - **Highlighting:** `ranges` are split into text and `<mark className="runout-hit">` pieces.
- [ ] **Step 4: Run** `npm test && npm run typecheck`, then GET `/` and `/collection/<id>` on the dev server.
  Expected: PASS, 200.
- [ ] **Step 5: Manual check** with `npm run dev` (the owner's server, or a scratch instance on another port):
  - Look up `BLP 1577` with no year: many pressings. Check runouts with year-limited results, watch progress, type
    `1577a`, then `rvg`.
  - Open and close a single "Runouts" toggle.
  - Close the Pick panel mid-check on a collection row: no console errors.
  - Record the number of calls observed. Count them with the dev log, or rely on the cache test plus the cap.
- [ ] **Step 6: Commit** `feat(picker): check runouts and match a runout fragment, highlighted`.

### Task 4: Docs

**Files:**
- Modify: `CLAUDE.md` (Status line for Phase 11; Layout adds `lib/runout.ts` and the route), the spec's status line

- [ ] **Step 1:** Update the docs. Run `npm test && npm run typecheck`, and run the build in a scratch worktree.
- [ ] **Step 2: Commit** `docs: Phase 11 runout matching status`.
