"use client";

import { useState } from "react";
import type { SectionKey } from "@/lib/admin/jsonSchema";

interface Section {
  key: SectionKey;
  label: string;
  content: string;
}

interface Props {
  sections: Section[];
}

/** Read-only preview of LokaceStavyPoznamky.json sections in a tabbed
 *  layout. Mirrors the editor's tab UI (active tab = brand fill, idle =
 *  hover-highlight) so the user keeps the same mental model whether
 *  they're viewing or editing. */
export function JsonSectionsPreview({ sections }: Props) {
  const [activeKey, setActiveKey] = useState<SectionKey>(
    sections[0]?.key ?? ("lokace" as SectionKey),
  );
  const active = sections.find((s) => s.key === activeKey) ?? sections[0];

  return (
    <div className="space-y-2">
      <nav
        aria-label="Sekce JSONu"
        className="flex flex-wrap items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 text-xs"
      >
        {sections.map((s) => {
          const isActive = s.key === activeKey;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setActiveKey(s.key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
                isActive
                  ? "bg-brand-600 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </nav>
      {active && (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre rounded-xl border border-gray-200 bg-gray-900 p-4 text-xs leading-relaxed text-gray-100">
          {active.content}
        </pre>
      )}
    </div>
  );
}
