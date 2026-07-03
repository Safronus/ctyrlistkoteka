"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RandomFindShowcase } from "@/lib/queries/random-find";

/**
 * Full-screen "screensaver" overlay launched from the random-find
 * widget. It rotates through random clovers faster than the inline
 * widget (which stays at 60 s) and shows only the photo + the bottom
 * countdown strip — no metadata.
 *
 * Fullscreen strategy (see the design discussion): the overlay is a
 * fixed inset-0 portal that already covers the viewport on EVERY
 * browser — including iPhone Safari, which can't fullscreen arbitrary
 * elements. Where the real Fullscreen API exists (desktop Chrome/Edge/
 * Firefox/Safari, Android Chrome, iPad) we additionally call
 * requestFullscreen() to hide the browser/OS chrome. So nothing is ever
 * hidden or warned about — iPhone just keeps the Safari toolbar visible.
 *
 * Exit: the close button, a tap anywhere, the Esc key, or leaving real
 * fullscreen by any other means (which we listen for and mirror).
 * Screen Wake Lock keeps the display awake where supported.
 */
const DEFAULT_SCREENSAVER_ROTATION_MS = 10_000;

// Minimal structural types for the vendor-prefixed Fullscreen API
// (older WebKit / Safari) and the Screen Wake Lock API — neither is
// fully present in the DOM lib types we target. Local so the component
// stays `any`-free.
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
interface WakeLockSentinelLike {
  release: () => Promise<void>;
}
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

export function RandomFindScreensaver({
  initial,
  onClose,
  rotationMs = DEFAULT_SCREENSAVER_ROTATION_MS,
}: {
  initial: RandomFindShowcase;
  /** Called on exit with the find currently on screen, so the inline
   *  widget can adopt it instead of snapping back to the pre-fullscreen
   *  one (and re-anchor its countdown to match). */
  onClose: (finalFind: RandomFindShowcase) => void;
  /** Rotation interval in ms (admin-tunable). Faster than the inline
   *  widget by default. */
  rotationMs?: number;
}) {
  const t = useTranslations("RandomFind");
  const [find, setFind] = useState<RandomFindShowcase>(initial);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Track the latest find in a ref so every close path — including the
  // Esc handler and the fullscreenchange listener, both captured inside
  // effects — reports the image currently on screen, not a stale closure.
  const findRef = useRef(find);
  useEffect(() => {
    findRef.current = find;
  }, [find]);
  const handleClose = useCallback(() => onClose(findRef.current), [onClose]);

  // Pull a fresh random find every 10 s. `no-store` so we bypass the
  // API's 60 s cache and actually see variety in the slideshow.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/random-find", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as RandomFindShowcase | null;
      if (data) setFind(data);
    } catch {
      /* keep the current find on screen */
    }
  }, []);

  useEffect(() => {
    const i = setInterval(refresh, rotationMs);
    return () => clearInterval(i);
  }, [refresh, rotationMs]);

  // Esc closes (desktop). Mobile relies on the tap / close button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  // Real OS fullscreen as progressive enhancement. Missing API (iPhone
  // Safari) → silently stay in pseudo-fullscreen. Leaving real
  // fullscreen by any means also closes the overlay.
  useEffect(() => {
    const el = containerRef.current as FsElement | null;
    const doc = document as FsDocument;
    if (!el) return;

    const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (request) {
      // Fire-and-forget. Deferring the call into `.then` routes a
      // synchronous throw into the same `.catch` as an async rejection —
      // either way a blocked/absent fullscreen just leaves us in
      // pseudo-fullscreen. (No `try` around the promise → satisfies S4822.)
      Promise.resolve()
        .then(() => request.call(el))
        .catch(() => {});
    }

    const onFsChange = () => {
      const active = doc.fullscreenElement ?? doc.webkitFullscreenElement;
      if (!active) handleClose();
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);

    return () => {
      // Remove listeners FIRST so our own exit below doesn't bounce
      // back through onFsChange → onClose during unmount.
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      const active = doc.fullscreenElement ?? doc.webkitFullscreenElement;
      const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
      if (active && exit) {
        // Same fire-and-forget pattern as the request above.
        Promise.resolve()
          .then(() => exit.call(doc))
          .catch(() => {});
      }
    };
  }, [handleClose]);

  // Keep the screen awake (best-effort). The lock is auto-released when
  // the tab is hidden, so re-acquire on visibility.
  useEffect(() => {
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock?.request) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = () => {
      nav.wakeLock
        ?.request("screen")
        .then((s) => {
          if (cancelled) {
            s.release().catch(() => {});
            return;
          }
          sentinel = s;
        })
        .catch(() => {});
    };
    acquire();

    const onVis = () => {
      if (document.visibilityState === "visible" && !sentinel) acquire();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      sentinel?.release().catch(() => {});
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("screensaverAria")}
      onClick={handleClose}
      className="fixed inset-0 z-[9999] flex cursor-pointer items-center justify-center bg-black"
    >
      <style>{`
        @keyframes ctyr-ss-countdown {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
        .ctyr-ss-countdown-fill {
          transform-origin: left center;
          animation: ctyr-ss-countdown ${rotationMs}ms linear forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .ctyr-ss-countdown-fill { animation: none; transform: scaleX(1); }
        }
      `}</style>

      <button
        type="button"
        onClick={handleClose}
        aria-label={t("screensaverCloseAria")}
        title={t("screensaverCloseAria")}
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white/70 backdrop-blur transition hover:bg-white/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40"
      >
        <X className="h-6 w-6" aria-hidden />
      </button>

      {find.primaryImage ? (
        // Served by Nginx; the Next image optimizer isn't in play here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={find.primaryImage.webPath}
          alt=""
          aria-hidden
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <span aria-hidden className="text-7xl opacity-30">
          🍀
        </span>
      )}

      {/* Bottom countdown strip — same idea as the inline widget; `key`
          on the fill remounts it so the CSS animation restarts on each
          new find. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 overflow-hidden bg-white/15"
      >
        <div
          key={find.id}
          className="ctyr-ss-countdown-fill h-full bg-brand-500"
        />
      </div>
    </div>,
    document.body,
  );
}
