import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Locale-aware navigation primitives.
 *
 * Replace direct imports of `next/link` and `next/navigation` with
 * these for every public-page link/redirect. They auto-prepend the
 * `/en` prefix when the current locale is English, so a single
 * `<Link href="/sbirka/123">` works for both `/sbirka/123` (cs) and
 * `/en/sbirka/123` (en) without per-call locale juggling.
 *
 * Admin pages and API routes don't import from here — they're
 * locale-agnostic and stick with `next/link` / `next/navigation`.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
