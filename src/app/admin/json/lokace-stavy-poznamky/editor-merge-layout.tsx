"use client";

import { useState } from "react";
import type { SectionKey } from "@/lib/admin/jsonSchema";
import { LokaceStavyPoznamkyEditor } from "./editor";
import type { JsonInconsistencies } from "./inconsistencies";
import { MergeSectionForm } from "./merge-form";

/**
 * Two-column layout wrapper that holds the shared `activeTab` state
 * for the editor (left) and merge form (right). Lifting state here so
 * the merge form's section toggles can switch the editor's tab in
 * one click — clicking "Stavy" on the right immediately scrolls the
 * left editor to the same section so the operator can see what
 * they're about to merge into.
 *
 * The "Celý soubor" merge tab doesn't fire `onSectionChange` — that
 * mode operates over the whole JSON, not a single section, so
 * switching the editor's tab would be arbitrary.
 *
 * Layout: xl+ grid 3fr/2fr (editor wider than merge form); below xl
 * the cards stack vertically with the editor on top. `items-start`
 * keeps each card sized to its own content instead of stretching to
 * the taller sibling.
 */
export function EditorMergeLayout({
  initialSections,
  fileMtime,
  initialTab,
  inconsistencies,
}: {
  initialSections: React.ComponentProps<
    typeof LokaceStavyPoznamkyEditor
  >["initialSections"];
  fileMtime: string | null;
  initialTab?: SectionKey;
  inconsistencies: JsonInconsistencies | null;
}) {
  const [activeTab, setActiveTab] = useState<SectionKey>(
    initialTab ?? "lokace",
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[3fr_2fr] xl:items-start">
      {/* Key the editor by file mtime so it re-seeds its section
          textareas from disk after every write (save / merge / CLI
          edit). The merge form on the right is intentionally NOT keyed
          — that's what keeps its post-merge result summary on screen
          across the router.refresh() instead of flashing and vanishing. */}
      <LokaceStavyPoznamkyEditor
        key={fileMtime ?? "empty"}
        initialSections={initialSections}
        fileMtime={fileMtime}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        inconsistencies={inconsistencies}
      />

      <MergeSectionForm onSectionChange={setActiveTab} />
    </div>
  );
}
