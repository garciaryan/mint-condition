// Shared links and page paths. Pure and client-safe. Cookie names live with their modules (auth, theme, nav) and
// Discogs URLs in discogs-terms.ts.

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
