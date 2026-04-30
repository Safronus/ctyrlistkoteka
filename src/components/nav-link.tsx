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
  const sizeClass =
    variant === "compact" ? "px-2 py-0.5 text-xs" : "px-3 py-2 text-sm";

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={
        isActive
          ? `inline-block rounded-md ${sizeClass} font-medium bg-brand-50 text-brand-700`
          : `inline-block rounded-md ${sizeClass} font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900`
      }
    >
      {children}
    </Link>
  );
}
