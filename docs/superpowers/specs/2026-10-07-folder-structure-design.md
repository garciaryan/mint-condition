# Folder structure: components, hooks and shared constants

Date: 2026-10-07 · Status: approved design, awaiting spec review

## Why

Components and hooks are spread between the loose files in `app/` and the route folders. Shared links are written out
in more than one place. Before Phase 10 adds more UI, the codebase gets one predictable layout:
- `app/` holds routes only.
- Components live in `components/`, grouped by area.
- Hooks live in `hooks/`.
- Shared links and page paths live in `lib/consts.ts`.

Success:
- Every file is where the layout below says it is.
- Nothing about the app changes for its user. Tests, the type check and the build pass, and every page loads under
  `npm run dev`.
- A test keeps the layout from drifting.

## Decisions (from brainstorming)

- **Root folders:** `components/` and `hooks/` sit beside `lib/`, not inside `app/`.
- **`lib/consts.ts` holds external links and page routes.** Cookie names stay in `lib/auth.ts`, `lib/theme.ts` and
  `lib/nav.ts`. Discogs URLs stay in `lib/discogs-terms.ts`, which the terms test reads. API paths stay inline.
- **Delivery:** one PR, one commit per area, with the full checks passing after every commit. Files move with
  `git mv` and keep their names.

## Layout

`app/` keeps only Next's special files (`page.tsx`, `layout.tsx`, `route.ts`) and `globals.css`.

| From | To |
|---|---|
| `app/SiteHeader.tsx`, `SiteNav.tsx`, `NavLinks.tsx`, `NavIcon.tsx`, `SiteFooter.tsx`, `ThemeSwitch.tsx`, `LogoutButton.tsx` | `components/layout/` |
| `app/Lookup.tsx`, `LookupScanner.tsx`, `Picker.tsx` | `components/lookup/` |
| `app/ScanButton.tsx`, `ScanFrame.tsx` | `components/scan/` |
| `app/GradeSelect.tsx`, `DiscogsCredit.tsx` | `components/ui/` |
| `app/collection/LotsList.tsx`; `app/collection/[id]/LotView.tsx`, `LotHeader.tsx`, `ItemRow.tsx`, `EntryBar.tsx`, `Scanner.tsx`, `PasteList.tsx`, `PickPanel.tsx`, `TotalsBar.tsx`, `OfferPanel.tsx`; `app/collection/[id]/print/PrintButton.tsx` | `components/collection/` |
| `app/settings/SettingsForm.tsx`, `HelpTip.tsx` | `components/settings/` |
| `app/login/LoginForm.tsx` | `components/login/` |
| `app/useBarcodeCamera.ts`, `useDisclosure.ts`, `useFadeOut.ts`; `app/collection/[id]/useDialog.ts` | `hooks/` |
| `app/collection/[id]/api.ts` (fetch wrapper, `money`) | `lib/collection/client.ts` |

Exports and component names don't change. Only import paths do.

## `lib/consts.ts`

Pure, client-safe, no imports.

```ts
export const LINKS = {
  repo: "https://github.com/garciaryan/mint-condition",
  docs: "https://github.com/garciaryan/mint-condition#readme",
  coffee: "https://www.buymeacoffee.com/rgarciadev",
} as const;

export const ROUTES = {
  home: "/",
  collections: "/collection",
  collection: (id: number) => `/collection/${id}`,
  print: (id: number) => `/collection/${id}/print`,
  settings: "/settings",
  login: (next?: string) => (next ? `/login?next=${next}` : "/login"),
} as const;
```

- `SiteNav` and `SiteFooter` take their links from `LINKS`.
- Every page path written in components uses `ROUTES`: the nav items, `LotsList`, `LotView`, `LotHeader`, the print
  page, the login redirects in `Lookup`, `LogoutButton`, `SettingsForm`, `LotsList` and `lib/collection/client.ts`.
  `ROUTES.login(next)` produces exactly the strings used today (for example `/login?next=/settings`), and the
  `client.ts` redirect still passes `location.pathname`.
- **Not changed:** the path checks in `lib/auth.ts` (`isPublicPath`, `safeNext`). They are security matching
  against request paths, including API routes, so they stay literal and keep their existing tests.

## Imports

- Moved components, hooks and `app/` pages and layouts import with the existing `@/` alias (`@/components/...`,
  `@/hooks/...`, `@/lib/...`), keeping the `.ts`/`.tsx` extensions as the repo does now.
- `lib/**` and `app/api/**` keep relative imports. The tests load them in plain Node
  (`--experimental-strip-types`), which doesn't resolve `@/`.
- `lib/collection/client.ts` is imported only by components, but it lives in `lib/`, so it follows the `lib` rule
  and uses relative imports.

## Guard test: `tests/structure.test.ts`

- Every file under `app/` is `page.tsx`, `layout.tsx`, `route.ts` or a `.css` file.
- Every file exporting a `use*` function (`export function use` or `export default function use`) is in `hooks/`.
- No file under `lib/` or `app/api/` imports from `"@/`.
- `LINKS.repo` and `LINKS.coffee` appear as string literals only in `lib/consts.ts`, searched across `app/`,
  `components/`, `hooks/` and `lib/`.

## Tests and docs that follow the move

- Tests that read files by path get the new paths: `footer`, `nav`, `layout`, `login`, `collection-ui`, `font`,
  `motion` and `theme-contrast`, wherever each one reads a moved file. `app/globals.css` and `app/layout.tsx` don't
  move.
- CLAUDE.md: the Layout section is rewritten for the new folders, and the Decisions and Status text that names a
  moved path (for example `app/useBarcodeCamera.ts`, `app/ScanButton.tsx`, `app/SiteFooter.tsx`) is updated. Older
  specs and plans under `docs/superpowers/` are historical records and are left as they are.

## Verification

- After every commit: `npm test`, `npm run typecheck` and `npm run build`. Check for a running `next dev` before
  building.
- At the end: under `npm run dev`, `/`, `/collection`, `/collection/<id>`, `/collection/<id>/print`, `/settings` and
  `/login` (with a password set) each return 200, with no compile errors in the log.
- The number of tests changes only by the new structure tests.
