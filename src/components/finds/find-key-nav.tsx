"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * Keyboard navigation for the find detail page: ← jumps to the previous
 * find, → to the next (mirrors the on-page prev/next clover links). Null
 * neighbours (collection ends) are simply ignored. Renders nothing.
 *
 * Guards against hijacking typing (inputs / textareas / contenteditable)
 * and any modified key press (Alt/Ctrl/Meta/Shift), so browser shortcuts
 * and form fields keep working.
 */
export function FindKeyNav({
  prevId,
  nextId,
}: {
  prevId: number | null;
  nextId: number | null;
}) {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.defaultPrevented ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey
      )
        return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable)
        return;

      if (e.key === "ArrowLeft" && prevId !== null) {
        e.preventDefault();
        router.push(`/sbirka/${prevId}`);
      } else if (e.key === "ArrowRight" && nextId !== null) {
        e.preventDefault();
        router.push(`/sbirka/${nextId}`);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [prevId, nextId, router]);

  return null;
}
