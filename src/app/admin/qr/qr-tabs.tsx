"use client";

import { useState } from "react";
import { QrCode, Leaf } from "lucide-react";

/**
 * Tab shell for the two independent QR worlds (finds vs. pages).
 *
 * Both panels are rendered on the server and handed in as props — only
 * the visibility toggle is client-side. Keeping the inactive panel
 * mounted preserves its state (filters, typed numbers) when switching
 * back, which matters because the find panel's list carries a selection.
 */
export function QrTabs({
  findLabel,
  findSummary,
  findPanel,
  pageLabel,
  pageSummary,
  pagePanel,
}: {
  findLabel: string;
  findSummary: React.ReactNode;
  findPanel: React.ReactNode;
  pageLabel: string;
  pageSummary: React.ReactNode;
  pagePanel: React.ReactNode;
}) {
  const [tab, setTab] = useState<"finds" | "pages">("finds");

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Druhy QR kódů"
        className="flex flex-wrap gap-2 border-b border-gray-200"
      >
        <Tab
          active={tab === "finds"}
          onClick={() => setTab("finds")}
          icon={<Leaf className="h-4 w-4" aria-hidden />}
          label={findLabel}
        />
        <Tab
          active={tab === "pages"}
          onClick={() => setTab("pages")}
          icon={<QrCode className="h-4 w-4" aria-hidden />}
          label={pageLabel}
        />
        <div className="ml-auto flex items-center gap-4 pb-2 text-center">
          {tab === "finds" ? findSummary : pageSummary}
        </div>
      </div>

      <div role="tabpanel" hidden={tab !== "finds"}>
        {findPanel}
      </div>
      <div role="tabpanel" hidden={tab !== "pages"}>
        {pagePanel}
      </div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition ${
        active
          ? "border-brand-600 text-brand-800"
          : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
