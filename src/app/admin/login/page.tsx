import { redirect } from "next/navigation";
import Link from "next/link";
import { hasAnyCredential } from "@/lib/admin/credentials";
import { getAdminSession, isAuthenticated } from "@/lib/admin/session";
import { LoginForm } from "./login-form";

export default async function AdminLoginPage() {
  // Already-authed visitors land at the dashboard. Visitors whose
  // first-time setup hasn't run yet are redirected to /admin/setup so
  // they don't get stuck on a login page that nobody can pass.
  const session = await getAdminSession();
  if (isAuthenticated(session)) redirect("/admin");
  if (!(await hasAnyCredential())) redirect("/admin/setup");

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Přihlášení</h1>
      <p className="text-sm text-gray-600">
        Tato sekce je určena výhradně pro správu sbírky. Přístup je omezen
        IP adresou + passkey ověřením.
      </p>
      <LoginForm />
      <p className="text-center text-xs text-gray-500">
        <Link href="/" className="hover:underline">
          ← zpět na veřejný web
        </Link>
      </p>
    </div>
  );
}
