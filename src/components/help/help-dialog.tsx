"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { HelpCircle, X } from "lucide-react";

/**
 * Reusable "?" help button + modal dialog. The button is a small
 * circular icon-only chip sized to live next to a page's h1 (or any
 * other heading); the dialog uses the project's existing native
 * `<dialog>` + `showModal()` pattern (see donation-photos-button.tsx,
 * collection-progress-banner.tsx, free-photos-button.tsx for siblings).
 *
 * Content shape: a flat list of sections, each with a heading + a list
 * of bullet strings. Pages assemble it from their own translation
 * namespace (e.g. the `Statistiky` namespace's help keys) so the copy
 * ships in cs.json / en.json with everything else.
 *
 * MAINTENANCE NOTE: Whenever a public-page feature changes (new
 * filter, new layer, new sort option, removed control, changed
 * behaviour), update the corresponding `*Help.*` keys so the visible
 * help doesn't drift from the actual UI. The help is part of the
 * page's UX contract, not a one-shot.
 */
export interface HelpSection {
  heading: string;
  items: readonly string[];
}

export function HelpDialog({
  title,
  buttonAriaLabel,
  buttonTitle,
  intro,
  sections,
  /** Optional inline class overrides for the button. Used on /mapa to
   *  match the Vrstvy panel's color scheme; the default (a borderless
   *  icon) suits the h1 adjacencies on /sbirka, /lokality + /statistiky. */
  buttonClassName,
}: {
  title: string;
  buttonAriaLabel: string;
  buttonTitle: string;
  /** Short paragraph rendered above the section list — optional. */
  intro?: string;
  sections: readonly HelpSection[];
  buttonClassName?: string;
}) {
  const tCommon = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Stop the click from toggling an ancestor <details> when the
          // marker lives inside a <summary> (e.g. the /statistiky
          // deviation tile). preventDefault cancels the summary's toggle
          // default action; stopPropagation keeps it off other handlers.
          // Both are no-ops for the h1-adjacent placements on other pages.
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        title={buttonTitle}
        aria-label={buttonAriaLabel}
        className={
          buttonClassName ??
          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 transition hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        }
      >
        <HelpCircle className="h-4 w-4" aria-hidden />
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        // Backdrop click — same pattern as free-photos-button.
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpen(false);
        }}
        aria-labelledby="page-help-title"
        className="fixed left-1/2 top-1/2 max-h-[calc(100vh-2rem)] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
          <h2
            id="page-help-title"
            className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900"
          >
            <HelpCircle className="h-4 w-4 text-brand-600" aria-hidden />
            {title}
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="-m-1 rounded-md p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-label={tCommon("close")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="max-h-[calc(100vh-8rem)] space-y-4 overflow-auto p-4 text-sm">
          {intro && <p className="text-gray-700">{intro}</p>}
          {sections.map((section) => (
            <section key={section.heading} className="space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                {section.heading}
              </h3>
              <ul className="list-disc space-y-1 pl-5 text-gray-800">
                {section.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </dialog>
    </>
  );
}
