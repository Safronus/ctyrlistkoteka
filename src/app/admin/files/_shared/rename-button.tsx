"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X, Check } from "lucide-react";

/** Generic rename action — same shape across the three scopes
 *  (finds / crops / maps) so the page can pass the right server
 *  action straight through. Returns `newFilename` on success so
 *  the client can redirect to the renamed URL without guessing. */
type RenameAction = (formData: FormData) => Promise<{
  ok: boolean;
  newFilename?: string;
  cropRenamed?: boolean;
  error?: string;
}>;

interface Props {
  currentName: string;
  /** Which admin scope's file list to redirect into after rename.
   *  Hardcoded per call site so the client can't trick the action
   *  by claiming a different scope — the server action ignores this
   *  prop, it's only used for client-side navigation. */
  scopeSlug: "finds" | "crops" | "maps";
  action: RenameAction;
}

/** Inline rename control. Default state is a small "Upravit název"
 *  button alongside the other action buttons. Click → swap in a
 *  text input pre-filled with the current name + Save/Cancel
 *  buttons. Save calls the server action, redirects to the new
 *  detail URL on success.
 *
 *  Same UX shape for all three scopes — server-side validation
 *  differs (parseFindFilename for finds + crops with short-form
 *  fallback, parseMapFilename for maps), but the operator-facing
 *  interaction is identical. */
export function RenameButton({ currentName, scopeSlug, action }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    setError(null);
    setNotice(null);
    if (value.trim().length === 0) {
      setError("Nový název nemůže být prázdný.");
      return;
    }
    if (value === currentName) {
      setEditing(false);
      return;
    }
    const fd = new FormData();
    fd.append("oldName", currentName);
    fd.append("newName", value);
    startTransition(async () => {
      const r = await action(fd);
      if (!r.ok) {
        setError(r.error ?? "Přejmenování selhalo");
        return;
      }
      if (r.cropRenamed === false) {
        // Original renamed OK but crop divergence — the operator
        // should know. The redirect still happens; this notice
        // would show on the new URL just to inform.
        setNotice("Originál přejmenován, ořez se nepodařilo přejmenovat.");
      }
      if (r.newFilename) {
        router.push(
          `/admin/files/${scopeSlug}/${encodeURIComponent(r.newFilename)}`,
        );
      } else {
        router.refresh();
      }
    });
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(currentName);
          setError(null);
          setEditing(true);
        }}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
        title="Upravit název souboru"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        Upravit název
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={isPending}
          spellCheck={false}
          autoFocus
          // Wide enough for the typical 80+ char find/crop filename
          // without truncating mid-edit; flexes down on mobile via
          // the parent flex-wrap.
          className="w-[28rem] max-w-full rounded-md border border-gray-300 bg-white px-2.5 py-1 font-mono text-xs text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-brand-600 bg-brand-600 px-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Check className="h-3.5 w-3.5" aria-hidden />
          )}
          Uložit
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={isPending}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Zrušit
        </button>
      </div>
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900">
          {notice}
        </p>
      )}
    </div>
  );
}
