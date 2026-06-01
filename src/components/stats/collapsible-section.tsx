import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Collapsible card for /statistiky sections. Native `<details>` so it
 * works without client JS — the title (+ optional subtitle) sit in the
 * always-visible `<summary>`, the body collapses. Default-collapsed
 * unless `defaultOpen`.
 *
 * No "use client" directive on purpose: this is a universal component,
 * rendered both by the server page (Geo / Calendar / Jubilee sections)
 * and inside client components (Top-locations / Top-finds cards, which
 * keep their interactive toggles in the body). `title` accepts a node
 * so client callers can pass a state-dependent heading.
 */
export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      // Named group ("section") so a nested unnamed `group` details
      // inside the body (e.g. jubilee "show more", calendar value
      // tables) keeps its own `group-open:` scope instead of reacting
      // to this card's open state.
      className="group/section rounded-xl border border-gray-200 bg-white p-5"
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          {typeof title === "string" ? (
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          ) : (
            title
          )}
          {subtitle && (
            <div className="mt-0.5 text-sm text-gray-500">{subtitle}</div>
          )}
        </div>
        <ChevronDown
          className="mt-1 h-5 w-5 shrink-0 text-gray-400 transition group-open/section:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
