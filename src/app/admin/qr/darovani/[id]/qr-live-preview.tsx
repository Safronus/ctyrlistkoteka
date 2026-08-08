"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { previewDropQrAction } from "../../drop-actions";
import type { QrDesign } from "./qr-design-fields";

/**
 * The card as it will print, redrawn while the design is being edited.
 *
 * Rendered on the server like every other code here — same renderer, so
 * the preview cannot flatter the result. Debounced, because dragging a
 * segmented control fires a change per click and each one is a round
 * trip.
 */
export function QrLivePreview({
  design,
  findId,
  label,
}: {
  design: QrDesign;
  /** Number to draw with; the preview never needs a real card. */
  findId: number;
  label: string;
}) {
  // `{ svg, forKey }` in one piece of state: the "is this preview stale"
  // question is answered by comparing keys at render time, which keeps the
  // effect free of the extra setState that made it cascade.
  const [state, setState] = useState<{ svg: string; forKey: string } | null>(
    null,
  );
  const key = JSON.stringify(design);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const r = await previewDropQrAction(findId, JSON.parse(key) as QrDesign);
      // A slower earlier request must not overwrite a newer preview.
      if (mine !== seq.current || !r.ok) return;
      setState({ svg: r.svg, forKey: key });
    }, 250);
    return () => clearTimeout(t);
  }, [key, findId]);

  const svg = state?.svg ?? null;
  const pending = state?.forKey !== key;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-gray-700">{label}</p>
      <div className="relative flex min-h-[12rem] items-center justify-center rounded-lg border border-gray-200 bg-white p-2">
        {svg ? (
          <div
            className="w-full [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-gray-300" aria-hidden />
        )}
        {pending && svg && (
          <Loader2
            className="absolute right-2 top-2 h-3.5 w-3.5 animate-spin text-gray-300"
            aria-hidden
          />
        )}
      </div>
      <p className="text-[11px] text-gray-400">
        Ukázkový kód, ne skutečný odkaz — vzhled ale sedí přesně.
      </p>
    </div>
  );
}
