"use client";

import { Download } from "lucide-react";

/**
 * Inline export-button row rendered inside `<summary>` elements on
 * /admin/audit/blocklist. Lives as its own client island because the
 * surrounding page is a Server Component — `onClick` can't be wired
 * directly there. The handler stops propagation so a click on a TSV
 * link doesn't re-toggle the parent `<details>` open state (operators
 * grabbing a CSV mid-review would otherwise lose their place).
 */
export function ExportButtonRow({
  items,
}: {
  items: ReadonlyArray<{ href: string; label: string; ext: string }>;
}) {
  return (
    <span
      className="inline-flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] uppercase tracking-wide text-gray-400">
        export:
      </span>
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          download
          title={it.label}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
        >
          <Download className="h-3 w-3" aria-hidden />
          <span className="font-mono uppercase">{it.ext}</span>
        </a>
      ))}
    </span>
  );
}
