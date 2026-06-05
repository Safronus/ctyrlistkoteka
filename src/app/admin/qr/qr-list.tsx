"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Download,
  Loader2,
  QrCode,
} from "lucide-react";
import {
  archiveQrAction,
  getQrSvgAction,
  restoreQrAction,
} from "./qr-actions";
import { downloadPng, downloadSvg } from "./qr-download";

export interface QrListItem {
  id: number;
  label: string;
  token: string;
  targetLabel: string;
  locale: string;
  createdAt: string;
  archived: boolean;
  scansTotal: number;
  scans30: number;
  scans7: number;
}

export function QrList({ items }: { items: QrListItem[] }) {
  const active = items.filter((i) => !i.archived);
  const archived = items.filter((i) => i.archived);

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
        Zatím žádné vygenerované QR kódy.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Section title="Aktivní" items={active} />
      {archived.length > 0 && (
        <Section title="Zničené" items={archived} muted />
      )}
    </div>
  );
}

function Section({
  title,
  items,
  muted = false,
}: {
  title: string;
  items: QrListItem[];
  muted?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {title}
        </h3>
        <p className="text-sm text-gray-400">Žádné.</p>
      </div>
    );
  }
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title} <span className="font-normal text-gray-400">({items.length})</span>
      </h3>
      <ul className="space-y-2">
        {items.map((it) => (
          <Row key={it.id} item={it} muted={muted} />
        ))}
      </ul>
    </div>
  );
}

function Row({ item, muted }: { item: QrListItem; muted: boolean }) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [dl, setDl] = useState<"svg" | "png" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (kind: "svg" | "png") => {
    setError(null);
    setDl(kind);
    try {
      const r = await getQrSvgAction(item.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const base = `ctyrlistkoteka-qr-${r.token}`;
      if (kind === "svg") downloadSvg(r.svg, `${base}.svg`);
      else await downloadPng(r.svg, `${base}.png`, 2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stažení selhalo");
    } finally {
      setDl(null);
    }
  };

  const toggleArchive = () => {
    startBusy(async () => {
      const r = item.archived
        ? await restoreQrAction(item.id)
        : await archiveQrAction(item.id);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <li
      className={`rounded-lg border p-3 ${
        muted
          ? "border-gray-200 bg-gray-50 opacity-80"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-semibold text-gray-900">
              {item.label}
            </span>
            {item.archived && (
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-800">
                Zničený
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-gray-500">
            {item.targetLabel}
            <span className="text-gray-400"> · {item.locale}</span>
            {" · "}
            <span className="font-mono text-gray-600">/go/{item.token}</span>
            <span className="text-gray-400"> · {item.createdAt}</span>
          </p>
        </div>

        {/* scan stats */}
        <div className="flex shrink-0 items-center gap-3 text-center">
          <Stat value={item.scansTotal} label="celkem" strong />
          <Stat value={item.scans30} label="30 d" />
          <Stat value={item.scans7} label="7 d" />
        </div>

        {/* actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          <IconBtn
            onClick={() => handleDownload("svg")}
            busy={dl === "svg"}
            label="Stáhnout SVG"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            <span className="ml-1 text-[11px]">SVG</span>
          </IconBtn>
          <IconBtn
            onClick={() => handleDownload("png")}
            busy={dl === "png"}
            label="Stáhnout PNG"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            <span className="ml-1 text-[11px]">PNG</span>
          </IconBtn>
          <button
            type="button"
            onClick={toggleArchive}
            disabled={busy}
            title={item.archived ? "Obnovit" : "Označit jako zničený"}
            aria-label={item.archived ? "Obnovit" : "Označit jako zničený"}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white p-1.5 text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : item.archived ? (
              <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Archive className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
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
    <div className="min-w-[2.5rem]">
      <p
        className={`font-mono tabular-nums ${
          strong ? "text-sm font-semibold text-brand-700" : "text-xs text-gray-700"
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
      title={label}
      aria-label={label}
      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1.5 text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        children
      )}
    </button>
  );
}
