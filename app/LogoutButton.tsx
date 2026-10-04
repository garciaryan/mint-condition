"use client";

export default function LogoutButton() {
  async function logout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      location.assign("/login");
    }
  }
  return (
    <button type="button" className="secondary" onClick={logout}>
      Log out
    </button>
  );
}
