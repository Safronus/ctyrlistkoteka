"use client";

import { useMemo, useState } from "react";
import { parseRanges, compactToRanges } from "@/lib/parseRanges";
import { FindQrForm } from "./find-qr-form";
import { FindQrList, type FindQrListItem } from "./find-qr-list";
import { FindQrExportDialog } from "./find-qr-export";
import type { FindQrInput } from "./qr-types";

/**
 * Owns the state the find-QR form and its list SHARE.
 *
 * The number field and the list checkboxes are one thing wearing two
 * faces: the spec string is the single source of truth, and a row is
 * checked exactly when its id parses out of that string. Keeping two
 * separate states in sync would drift the moment someone typed a range
 * that overlapped their selection.
 */
export function FindQrSection({
  items,
  pxPerCm,
  calibrated,
  initialCfg,
  initialSizeCm,
  initialSpec,
}: {
  items: FindQrListItem[];
  pxPerCm: number;
  calibrated: boolean;
  initialCfg: FindQrInput;
  initialSizeCm: number;
  initialSpec: string;
}) {
  const [spec, setSpec] = useState(initialSpec);
  const [cfg, setCfg] = useState<FindQrInput>(initialCfg);
  const [sizeCm, setSizeCm] = useState(initialSizeCm);
  const [exportIds, setExportIds] = useState<number[] | null>(null);

  /** Ids the spec currently names. Mid-typing garbage parses to nothing
   *  rather than throwing — the form shows the parse error separately. */
  const selected = useMemo(() => {
    const parts = spec.split(/[\s,;]+/).filter(Boolean);
    try {
      return new Set(parseRanges(parts));
    } catch {
      return new Set<number>();
    }
  }, [spec]);

  const writeSelection = (next: Set<number>) =>
    setSpec(compactToRanges([...next]).join(", "));

  const toggle = (findId: number) => {
    const next = new Set(selected);
    if (next.has(findId)) next.delete(findId);
    else next.add(findId);
    writeSelection(next);
  };

  const setMany = (findIds: number[], checked: boolean) => {
    const next = new Set(selected);
    for (const id of findIds) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    writeSelection(next);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <FindQrForm
          spec={spec}
          onSpecChange={setSpec}
          cfg={cfg}
          onCfgChange={setCfg}
          sizeCm={sizeCm}
          onSizeCmChange={setSizeCm}
          pxPerCm={pxPerCm}
          calibrated={calibrated}
          onExport={setExportIds}
        />
      </div>

      <FindQrList
        items={items}
        cfg={cfg}
        selected={selected}
        onToggle={toggle}
        onSetMany={setMany}
        onDownloadSelection={() => setExportIds([...selected])}
      />

      {exportIds && (
        <FindQrExportDialog
          ids={exportIds}
          cfg={cfg}
          sizeCm={sizeCm}
          onClose={() => setExportIds(null)}
        />
      )}
    </div>
  );
}
