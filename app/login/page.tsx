import { safeNext } from "@/lib/auth.ts";
import LoginForm from "@/components/login/LoginForm.tsx";

export const metadata = { title: "Log in - Mint Condition" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return (
    <main className="page login-page">
      <header className="masthead">
        <h1>Mint Condition</h1>
      </header>
      <LoginForm next={safeNext(typeof next === "string" ? next : null)} />
    </main>
  );
}
