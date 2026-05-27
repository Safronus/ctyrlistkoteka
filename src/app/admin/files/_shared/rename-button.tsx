"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
/** Split a filename into (stem, extension-with-dot). The extension
 *  is everything from the LAST dot onward — same convention every
 *  filename parser in this project uses. Names without a dot get an
 *  empty extension; both halves are returned so the caller can
 *  reassemble the original name via `stem + ext`. */
function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

export function RenameButton({ currentName, scopeSlug, action }: Props) {
  const { stem: currentStem, ext: currentExt } = splitExtension(currentName);
  const [editing, setEditing] = useState(false);
  // Edit field holds the *stem only* — the extension is shown as a
  // read-only suffix next to the input and re-appended on submit.
  // Avoids accidental ".jpg" deletion, which would have been the
  // single most common rename mistake.
  const [value, setValue] = useState(currentStem);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close the popover on outside-click / Escape so it doesn't get
  // stuck open after the user moves on. Skipped while a save is in
  // flight — bailing mid-action could leave the operator wondering
  // whether the rename actually went through.
  useEffect(() => {
    if (!editing) return;
    const onClick = (e: MouseEvent) => {
      if (isPending) return;
      const node = popoverRef.current;
      if (!node) return;
      if (node.contains(e.target as Node)) return;
      setEditing(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) setEditing(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [editing, isPending]);

  const submit = () => {
    setError(null);
    setNotice(null);
    const trimmedStem = value.trim();
    if (trimmedStem.length === 0) {
      setError("Nový název nemůže být prázdný.");
      return;
    }
    // Defence: if the user manually retyped the extension into the
    // stem field (paste from somewhere), strip a trailing copy of
    // the original extension before re-attaching. Avoids ending up
    // with names like `foo.jpg.jpg`.
    const newStem = trimmedStem.endsWith(currentExt)
      ? trimmedStem.slice(0, -currentExt.length)
      : trimmedStem;
    const newName = newStem + currentExt;
    if (newName === currentName) {
      setEditing(false);
      return;
    }
    const fd = new FormData();
    fd.append("oldName", currentName);
    fd.append("newName", newName);
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

  return (
    <div ref={popoverRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => {
          if (editing) {
            setEditing(false);
            return;
          }
          setValue(currentStem);
          setError(null);
          setNotice(null);
          setEditing(true);
        }}
        aria-expanded={editing}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
          editing
            ? "border-brand-500 bg-brand-50 text-brand-800"
            : "border-gray-300 bg-white text-gray-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
        }`}
        title="Upravit název souboru"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        Upravit název
      </button>

      {/* Popover panel — positioned absolute under the button so
          the rest of the action row keeps its inline flow. Right-
          aligned with the button (`right-0`) so the wide input
          extends to the LEFT into the action row's empty space
          rather than off the right edge of the page. z-20 sits
          above the figure preview below. */}
      {editing && (
        <div
          role="dialog"
          aria-label="Přejmenovat soubor"
          className="absolute right-0 top-full z-20 mt-1 w-[32rem] max-w-[90vw] rounded-lg border border-gray-300 bg-white p-3 shadow-lg"
        >
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Nový název (bez přípony{currentExt && `, ta zůstane "${currentExt}"`})
          </label>
          {/* Input holds the stem only; the (read-only) extension
              sits flush against the right edge as a visual cue
              that ".jpg" / ".heic" stays put. Same border styles
              as the standalone input so the compound looks like
              one control. */}
          <div className="flex items-stretch overflow-hidden rounded-md border border-gray-300 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={isPending}
              spellCheck={false}
              autoFocus
              className="block w-full border-0 bg-transparent px-2.5 py-1.5 font-mono text-xs text-gray-900 focus:outline-none focus:ring-0"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape" && !isPending) setEditing(false);
              }}
            />
            {currentExt && (
              <span
                aria-hidden
                title="Přípona se nemění"
                className="select-none border-l border-gray-200 bg-gray-50 px-2 py-1.5 font-mono text-xs text-gray-500"
              >
                {currentExt}
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={isPending}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Zrušit
            </button>
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
          </div>
          {error && (
            <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
              {error}
            </p>
          )}
          {notice && (
            <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
              {notice}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
