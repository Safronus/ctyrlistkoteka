"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLinkProps {
  href: string;
  children: React.ReactNode;
  /** `compact` shrinks padding and font-size — used by the mobile
   *  dropdown panel where the items stack vertically and the default
   *  size made adjacent active/hover highlights visually run together. */
  variant?: "default" | "compact";
}

export function NavLink({ href, children, variant = "default" }: NavLinkProps) {
  const pathname = usePathname();
  const isActive =
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  // Default variant pins height to 34 px so the active highlight matches
  // the ThemeToggle panel sitting next to it (1 px border + 2 px padding
  // + 28 px h-7 buttons + same on the bottom = 34 px). Without the fixed
  // height the py-2/text-sm combo rendered at 36 px and the two controls
  // looked vertically off-by-2 even though every other proportion lined
  // up. Compact (mobile dropdown) keeps its own slimmer sizing.
  const sizeClass =
    variant === "compact"
      ? "inline-block px-2 py-0.5 text-xs"
      : "inline-flex h-[34px] items-center px-3 text-sm";

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={
        isActive
          ? `${sizeClass} rounded-md font-medium bg-brand-50 text-brand-700`
          : `${sizeClass} rounded-md font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900`
      }
    >
      {children}
    </Link>
  );
}
