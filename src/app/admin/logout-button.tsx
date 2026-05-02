"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { logoutAction } from "./logout-action";

export function LogoutButton() {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => logoutAction())}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50"
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden />
      Odhlásit
    </button>
  );
}
