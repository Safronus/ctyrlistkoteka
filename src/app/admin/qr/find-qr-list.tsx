"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Download,
  ExternalLink,
  Gift,
  Loader2,
  Pin,
  PinOff,
  QrCode,
} from "lucide-react";
import { previewFindQrAction, unpinFindQrAction } from "./find-qr-actions";
import { downloadPng, downloadSvg } from "./qr-download";
import { Seg } from "./qr-ui";
import type { FindQrInput } from "./qr-types";

export interface FindQrListItem {
  findId: number;
  /** Location name, or null for finds with no location. */
  locationName: string | null;
  /** ISO-ish pre-formatted find date (server-formatted in the collection
   *  zone — never re-derive it here, see lib/collectionTime.ts). */
  foundAt: string | null;
  donated: boolean;
  pinned: boolean;
  scansTotal: number;
  scans30: number;
  scans7: number;
}

type Filter = "donated" | "pinned" | "all";

const FILTER_OPTS = [
  { v: "donated", l: "Darované" },
  { v: "pinned", l: "Vlastní" },
  { v: "all", l: "Všechny" },
];

/** Single-code downloads from the list use the section's default look —
 *  the batch form is where the styling knobs live. */
const LIST_CFG: FindQrInput = {
  titleMode: "id",
  theme: "brand",
  moduleStyle: "clover",
  center: "smiley",
  centerScale: "md",
  border: "none",
  borderRadius: "soft",
  borderColor: "theme",
  density: "dense",
};

export function FindQrList({ items }: { items: FindQrListItem[] }) {
  const [filter, setFilter] = useState<Filter>("donated");

  const shown = useMemo(() => {
    if (filter === "donated") return items.filter((i) => i.donated);
    if (filter === "pinned") return items.filter((i) => i.pinned && !i.donated);
    return items;
  }, [items, filter]);

  const totalScans = items.reduce((s, i) => s + i.scansTotal, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Seg
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={FILTER_OPTS}
        />
        <p className="text-xs text-gray-500">
          {shown.length.toLocaleString("cs-CZ")} z{" "}
          {items.length.toLocaleString("cs-CZ")} · {totalScans} naskenování
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
          {filter === "donated"
            ? "Žádný nález nemá stav Darovaný."
            : filter === "pinned"
              ? "Žádný nález nebyl přidán ručně. Použij „Přidat do seznamu“ ve formuláři výše."
              : "Zatím tu nic není."}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((it) => (
            <Row key={it.findId} item={it} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ item }: { item: FindQrListItem }) {
  const router = useRouter();
  const [dl, setDl] = useState<"svg" | "png" | null>(null);
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (kind: "svg" | "png") => {
    setError(null);
    setDl(kind);
    try {
      const r = await previewFindQrAction(item.findId, LIST_CFG);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const base = `ctyrlistek-${item.findId}`;
      if (kind === "svg") downloadSvg(r.svg, `${base}.svg`);
      else await downloadPng(r.svg, `${base}.png`, 2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stažení selhalo");
    } finally {
      setDl(null);
    }
  };

  const unpin = () => {
    startBusy(async () => {
      const r = await unpinFindQrAction(item.findId);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-start gap-3">
        <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-gray-900">
              🍀 #{item.findId}
            </span>
            {item.donated && (
              <span className="inline-flex items-center gap-1 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-800">
                <Gift className="h-3 w-3" aria-hidden />
                Darovaný
              </span>
            )}
            {item.pinned && !item.donated && (
              <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600">
                <Pin className="h-3 w-3" aria-hidden />
                Vlastní
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-gray-500">
            <span className="font-mono text-gray-600">/n/{item.findId}</span>
            {item.locationName && <> · {item.locationName}</>}
            {item.foundAt && (
              <span className="text-gray-400"> · {item.foundAt}</span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3 text-center">
          <Stat value={item.scansTotal} label="celkem" strong />
          <Stat value={item.scans30} label="30 d" />
          <Stat value={item.scans7} label="7 d" />
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <IconBtn
            onClick={() => handleDownload("svg")}
            busy={dl === "svg"}
            label={`Stáhnout SVG nálezu ${item.findId}`}
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            <span className="ml-1 text-[11px]">SVG</span>
          </IconBtn>
          <IconBtn
            onClick={() => handleDownload("png")}
            busy={dl === "png"}
            label={`Stáhnout PNG nálezu ${item.findId}`}
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            <span className="ml-1 text-[11px]">PNG</span>
          </IconBtn>
          <Link
            href={`/sbirka/${item.findId}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`Otevřít detail nálezu ${item.findId}`}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-600 transition hover:bg-gray-50"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
          {item.pinned && (
            <IconBtn
              onClick={unpin}
              busy={busy}
              label={`Odebrat nález ${item.findId} ze seznamu`}
            >
              <PinOff className="h-3.5 w-3.5" aria-hidden />
            </IconBtn>
          )}
        </div>
      </div>
      {error && (
        <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
          {error}
        </p>
      )}
    </li>
  );
}

function Stat({
  value,
  label,
  strong = false,
}: {
  value: number;
  label: string;
  strong?: boolean;
}) {
  return (
    <div>
      <p
        className={`font-mono text-sm tabular-nums ${
          strong ? "font-bold text-brand-700" : "text-gray-600"
        }`}
      >
        {value.toLocaleString("cs-CZ")}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-gray-400">
        {label}
      </p>
    </div>
  );
}

function IconBtn({
  onClick,
  busy,
  label,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        children
      )}
    </button>
  );
}
