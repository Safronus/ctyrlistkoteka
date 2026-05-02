import { redirect } from "next/navigation";
import { hasAnyCredential } from "@/lib/admin/credentials";
import { SetupForm } from "./setup-form";

// One-shot setup — only reachable when no credentials exist yet. Once
// the first passkey lands, this route redirects so a passing visitor
// can't enroll a second key without authenticating.
export default async function AdminSetupPage() {
  if (await hasAnyCredential()) {
    redirect("/admin/login");
  }
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Nastavení adminu</h1>
      <p className="text-sm text-gray-600">
        Vítej. Tahle stránka se zobrazí jen jednou — při prvním nastavení.
        Po vytvoření passkey se brána uzamkne a další zařízení půjde
        zaregistrovat jen z přihlášené relace.
      </p>
      <SetupForm />
    </div>
  );
}
