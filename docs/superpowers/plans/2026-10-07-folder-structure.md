# Folder Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move components to `components/`, hooks to `hooks/` and the collection client helper to `lib/`. Put
shared links and page routes in `lib/consts.ts`. Nothing changes for the user.

**Architecture:** Moves are `git mv` plus import rewrites, done one area per commit. `lib/consts.ts` is a pure
module. A structure test keeps the layout from drifting.

**Tech Stack:** Next.js 15 App Router, TypeScript, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-07-folder-structure-design.md`

## Global Constraints

- `app/` ends with only `page.tsx`, `layout.tsx`, `route.ts` and `globals.css`. Files keep their names, and exports
  don't change.
- Moved components, hooks and `app/` pages and layouts import with `@/...`, keeping the `.ts`/`.tsx` extensions.
  `lib/**` and `app/api/**` keep relative imports and never use `@/`.
- `lib/auth.ts` path checks stay literal. Cookie names and `lib/discogs-terms.ts` don't change.
- Older specs and plans under `docs/superpowers/` are not edited.
- After every commit: `npm test` and `npm run typecheck` pass.
- **Build and dev server:** the owner's `next dev` is running on :3000, and `npm run build` would clobber its
  `.next`. While it runs, check pages through it with GET requests instead of building. Run `npm run build` only
  when `pgrep -f "next dev"` shows nothing. CI builds the PR in any case.
- Each task's page check: `curl -s -o /dev/null -w "%{http_code}"` returns 200 on `/`, `/collection`, `/settings`, and on
  `/collection/<id>` and `/collection/<id>/print` for an existing lot (`GET /api/sessions` lists them). Compile
  errors return 500.

## Review Focus

1. A component imported both from its old relative path and from `@/` (two module instances). That breaks shared
   state, such as the shared Discogs client on `globalThis`. Rule: after Task 6, `grep -rn "from \"\.\./" components
   hooks` shows only same-area siblings (`./`). The structure test checks there are no imports of `app/` from
   `components/` or `hooks/`.
2. `ROUTES.login(next)` must produce exactly today's strings, including `/login?next=/` from Lookup and
   `location.pathname` passed through by the client. Test in Task 1.
3. A test still reading an old path after a move fails with ENOENT. That's caught by `npm test` in each task.
4. Client components moved without their `"use client"` line, or a server page importing a hook. That fails the
   page check (500). Each task runs its page check.
5. `lib/collection/client.ts` must not import a component or hook, since `lib/` stays usable from Node. The
   structure test checks that `lib/` imports nothing from `components/` or `hooks/`.

---

### Task 1: `lib/consts.ts` and its use

**Files:**
- Create: `lib/consts.ts`, `tests/consts.test.ts`
- Modify (to use `LINKS`/`ROUTES`, still at their current paths): `app/SiteNav.tsx`, `app/SiteFooter.tsx`,
  `app/NavLinks.tsx`, `app/Lookup.tsx`, `app/LogoutButton.tsx`, `app/settings/SettingsForm.tsx`,
  `app/collection/LotsList.tsx`, `app/collection/[id]/LotView.tsx`, `app/collection/[id]/LotHeader.tsx`,
  `app/collection/[id]/api.ts`, `app/collection/[id]/print/page.tsx`

**Interfaces:**
- Produces: `LINKS { repo, docs, coffee }` and `ROUTES { home, collections, collection(id: number), print(id: number),
  settings, login(next?: string) }`, exactly as in the spec.

- [ ] **Step 1: Write the failing tests** in `tests/consts.test.ts`:

```ts
test("ROUTES give today's paths", () => {
  assert.equal(ROUTES.home, "/");
  assert.equal(ROUTES.collections, "/collection");
  assert.equal(ROUTES.collection(7), "/collection/7");
  assert.equal(ROUTES.print(7), "/collection/7/print");
  assert.equal(ROUTES.settings, "/settings");
  assert.equal(ROUTES.login(), "/login");
  assert.equal(ROUTES.login("/"), "/login?next=/");
  assert.equal(ROUTES.login("/settings"), "/login?next=/settings");
});
test("LINKS", () => {
  assert.equal(LINKS.docs, `${LINKS.repo}#readme`);
  assert.equal(LINKS.coffee, "https://www.buymeacoffee.com/rgarciadev");
});
test("the repo and coffee URLs are written only in lib/consts.ts", () => {
  // walk app/, components/, hooks/, lib/ (skip missing dirs); every .ts/.tsx except lib/consts.ts
  // must not contain "github.com/garciaryan/mint-condition" or "buymeacoffee.com"
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL. The module is missing, and the URLs are still in SiteNav and
  SiteFooter.
- [ ] **Step 3: Implement** `lib/consts.ts`, then replace each literal page path and link in the files listed. Leave
  `/api/...` paths and `lib/auth.ts` alone.
- [ ] **Step 4: Run** `npm test && npm run typecheck`, then the page check. Expected: PASS, all 200.
- [ ] **Step 5: Commit** `refactor: shared links and page routes in lib/consts.ts`.

### Task 2: Hooks to `hooks/`

**Files:**
- Move: `app/useBarcodeCamera.ts`, `app/useDisclosure.ts`, `app/useFadeOut.ts` and `app/collection/[id]/useDialog.ts`
  to `hooks/`
- Modify importers: `app/LookupScanner.tsx`, `app/settings/HelpTip.tsx`, `app/collection/[id]/LotHeader.tsx`,
  `Scanner.tsx` and `PickPanel.tsx`, now importing `@/hooks/<name>.ts`. Imports inside the hooks become `@/lib/...`.

- [ ] **Step 1:** `git mv` the four files, then rewrite the imports.
- [ ] **Step 2: Run** `npm test && npm run typecheck`, then the page check. Expected: PASS, all 200.
- [ ] **Step 3: Commit** `refactor: hooks live in hooks/`.

### Task 3: Collection client helper to `lib/collection/client.ts`

**Files:**
- Move: `app/collection/[id]/api.ts` → `lib/collection/client.ts`. Its own imports become relative to `lib/`.
- Modify importers: `app/collection/LotsList.tsx` and, in `app/collection/[id]/`, `EntryBar`, `ItemRow`,
  `LotHeader`, `LotView`, `OfferPanel`, `PickPanel`, `Scanner` and `TotalsBar`, now importing
  `@/lib/collection/client.ts`.

- [ ] **Step 1:** `git mv`, then rewrite the imports.
- [ ] **Step 2: Run** `npm test && npm run typecheck`, then the page check. Expected: PASS, all 200.
- [ ] **Step 3: Commit** `refactor: collection client helper in lib/collection/client.ts`.

### Task 4: Shared components to `components/{layout,ui,scan,lookup}`

**Files:**
- Move to `components/layout/`: SiteHeader, SiteNav, NavLinks, NavIcon, SiteFooter, ThemeSwitch, LogoutButton.
  `components/ui/`: GradeSelect, DiscogsCredit. `components/scan/`: ScanButton, ScanFrame. `components/lookup/`:
  Lookup, LookupScanner, Picker. All are currently `app/<Name>.tsx`.
- Modify importers, including `app/layout.tsx`, `app/page.tsx`, the collection and settings pages, and the
  components still in `app/`, to use `@/components/<area>/<Name>.tsx`.
- Modify tests: `footer` and `nav` read `components/layout/SiteFooter.tsx` and `components/layout/SiteNav.tsx`.

- [ ] **Step 1:** `git mv` the files, then rewrite the imports. Siblings in the same area may use `./Name.tsx`.
- [ ] **Step 2: Run** `npm test && npm run typecheck`, then the page check. Expected: PASS, all 200.
- [ ] **Step 3: Commit** `refactor: shared components in components/`.

### Task 5: Collection, settings and login components

**Files:**
- Move to `components/collection/`: `app/collection/LotsList.tsx`; from `app/collection/[id]/`: LotView, LotHeader,
  ItemRow, EntryBar, Scanner, PasteList, PickPanel, TotalsBar and OfferPanel; and
  `app/collection/[id]/print/PrintButton.tsx`.
- Move to `components/settings/`: SettingsForm, HelpTip. Move to `components/login/`: LoginForm.
- Modify the pages under `app/collection`, `app/settings` and `app/login` to import from `@/components/...`.
- Modify tests: `collection-ui` reads `components/collection/ItemRow.tsx`, and `login` reads
  `components/login/LoginForm.tsx`.

- [ ] **Step 1:** `git mv` the files, then rewrite the imports.
- [ ] **Step 2: Run** `npm test && npm run typecheck`, then the page check, including `/login` with
  `APP_PASSWORD` set on a separate dev instance if the owner's server has login off. Expected: PASS, all 200.
- [ ] **Step 3: Commit** `refactor: collection, settings and login components in components/`.

### Task 6: Structure guard test and docs

**Files:**
- Create: `tests/structure.test.ts`
- Modify: `CLAUDE.md`. Rewrite the Layout section. Update the Decisions and Status text naming moved paths:
  `app/useBarcodeCamera.ts`, `app/LookupScanner.tsx`, `app/ScanButton.tsx`, `app/SiteFooter.tsx`,
  `app/DiscogsCredit.tsx`, `app/SiteHeader.tsx`, `app/SiteNav.tsx`, `app/NavLinks.tsx`, `app/NavIcon.tsx`,
  `app/ThemeSwitch.tsx`, `app/useDisclosure.ts`, `app/Picker.tsx`, `app/GradeSelect.tsx`, `app/settings/` and
  `app/collection/[id]/`.

- [ ] **Step 1: Write** `tests/structure.test.ts` (it walks folders with `readdirSync` recursion):
  - `"app/ holds only routes"`: every file under `app/` has a basename in `page.tsx`, `layout.tsx`, `route.ts` or
    `globals.css`.
  - `"hooks live in hooks/"`: every `.ts`/`.tsx` file in `app/`, `components/` and `lib/` has no match for
    `/export (default )?function use[A-Z]/`.
  - `"lib/ and app/api/ use relative imports"`: no file under `lib/` or `app/api/` contains `from "@/`.
  - `"lib/ stays free of UI imports"`: no file under `lib/` imports from a path containing `components/` or `hooks/`.
  - `"components and hooks never import from app/"`: no file under `components/` or `hooks/` imports from `@/app/` or
    from a relative path that reaches into `app/`.
- [ ] **Step 2: Run** `npm test`. Expected: PASS, since Tasks 2–5 did the moves.
- [ ] **Step 3: Prove it guards.** Temporarily `git mv components/ui/GradeSelect.tsx app/GradeSelect.tsx`, run
  `npm test`, expect `"app/ holds only routes"` to FAIL, then `git mv` it back. Do the same with a hook moved into
  `components/`.
- [ ] **Step 4: Update CLAUDE.md** as listed. Then run `npm test && npm run typecheck`, the page check, and
  `npm run build` if no `next dev` is running.
- [ ] **Step 5: Commit** `test: guard the folder layout; docs for the new structure`.
