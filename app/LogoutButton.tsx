"use client";

import { ROUTES } from "@/lib/consts.ts";

export default function LogoutButton() {
  async function logout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      location.assign(ROUTES.login());
    }
  }
  return (
    <button type="button" className="secondary" onClick={logout}>
      Log out
    </button>
  );
}
