"use client";

import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Check, Crop as CropIcon, Loader2, X } from "lucide-react";
import { recropFindAction } from "./crop-action";

export interface CropRow {
  findId: number;
  locationCode: string;
  detail: string;
  filename?: string;
  cropFilename?: string;
  originalThumb?: string;
  cropThumb?: string;
  originalWeb?: string;
}

/**
 * Client table for the "crop is really the whole photo" check. Each row has
 * an "Ořezat" button that opens a square-crop dialog; saving re-crops the
 * find server-side and advances to the next row so the operator can sweep
 * the whole list. Rows cropped this session get a green ✓ (they drop off on
 * the next page load, when the check re-runs).
 */
export function CropOffenderTable({ offenders }: { offenders: CropRow[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());

  const markDone = useCallback((findId: number) => {
    setDone((prev) => new Set(prev).add(findId));
  }, []);

  return (
    <div className="mt-4 max-h-[28rem] overflow-auto rounded-md border border-amber-200 bg-white">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-gray-50 text-gray-600">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Náhled</th>
            <th className="px-2 py-1.5 text-left font-medium">ID nálezu</th>
            <th className="px-2 py-1.5 text-left font-medium">Lokalita</th>
            <th className="px-2 py-1.5 text-right font-medium">Akce</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {offenders.map((o, i) => {
            const isDone = done.has(o.findId);
            return (
              <tr
                key={o.findId}
                className={isDone ? "bg-emerald-50/60" : "hover:bg-amber-50/40"}
              >
                <td className="px-2 py-1.5 align-top">
                  <div className="flex items-center gap-2">
                    {o.originalThumb && (
                      <Thumb src={o.originalThumb} label="orig" />
                    )}
                    {o.cropThumb && <Thumb src={o.cropThumb} label="ořez" />}
                  </div>
                </td>
                <td className="px-2 py-1.5 align-top">
                  <a
                    href={`/sbirka/${o.findId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono tabular-nums text-brand-700 hover:underline"
                  >
                    #{o.findId}
                  </a>
                  {o.cropFilename && (
                    <div
                      className="mt-0.5 break-all font-mono text-[10px] text-gray-400"
                      title={o.cropFilename}
                    >
                      {o.cropFilename}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5 align-top font-mono text-gray-800">
                  {o.locationCode}
                </td>
                <td className="px-2 py-1.5 text-right align-top">
                  {isDone ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      Ořezáno
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpenIdx(i)}
                      disabled={!o.originalWeb}
                      title={
                        o.originalWeb
                          ? "Ořezat"
                          : "Originál nemá web verzi — nelze ořezat"
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-brand-300 bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-40"
                    >
                      <CropIcon className="h-3.5 w-3.5" aria-hidden />
                      Ořezat
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {openIdx !== null && (
        <CropDialog
          offenders={offenders}
          startIndex={openIdx}
          done={done}
          onDone={markDone}
          onClose={() => setOpenIdx(null)}
        />
      )}
    </div>
  );
}

function Thumb({ src, label }: { src: string; label: string }) {
  return (
    <figure className="shrink-0 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        className="h-14 w-14 rounded border border-gray-300 object-cover"
      />
      <figcaption className="text-[9px] uppercase tracking-wide text-gray-400">
        {label}
      </figcaption>
    </figure>
  );
}

function CropDialog({
  offenders,
  startIndex,
  done,
  onDone,
  onClose,
}: {
  offenders: CropRow[];
  startIndex: number;
  done: ReadonlySet<number>;
  onDone: (findId: number) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cur = offenders[idx];

  const reset = useCallback(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    setError(null);
  }, []);

  const advance = useCallback(() => {
    // Jump to the next row that isn't done yet; close when none remain.
    for (let j = idx + 1; j < offenders.length; j++) {
      const o = offenders[j];
      if (o && !done.has(o.findId)) {
        setIdx(j);
        reset();
        return;
      }
    }
    onClose();
  }, [idx, offenders, done, reset, onClose]);

  const onCropComplete = useCallback((areaPct: Area) => setArea(areaPct), []);

  const save = useCallback(async () => {
    if (!area || saving || !cur) return;
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("findId", String(cur.findId));
      // react-easy-crop reports the crop area as PERCENTAGES of the image;
      // the server wants fractions of the upright image (0..1).
      fd.append("x", String(area.x / 100));
      fd.append("y", String(area.y / 100));
      fd.append("size", String(area.width / 100));
      const r = await recropFindAction(fd);
      if (!r.ok) {
        setError(r.error ?? "Ořez selhal");
        setSaving(false);
        return;
      }
      onDone(cur.findId);
      setSaving(false);
      advance();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ořez selhal");
      setSaving(false);
    }
  }, [area, saving, cur, onDone, advance]);

  if (!cur) return null;
  const remaining = offenders.filter((o) => !done.has(o.findId)).length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 p-3 sm:p-6">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-lg bg-white">
        <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">
              Ořezat #{cur.findId}
            </h2>
            <p className="text-xs text-gray-500">
              zbývá {remaining} · {cur.locationCode}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100"
            aria-label="Zavřít"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Square cropper — zoom + pan to frame the four-leaf clover. */}
        <div className="relative flex-1 bg-gray-900">
          {cur.originalWeb && (
            <Cropper
              image={cur.originalWeb}
              crop={crop}
              zoom={zoom}
              minZoom={1}
              maxZoom={8}
              aspect={1}
              restrictPosition={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          )}
        </div>

        <div className="space-y-2 border-t border-gray-200 px-4 py-3">
          <label className="flex items-center gap-2 text-xs text-gray-600">
            Přiblížení
            <input
              type="range"
              min={1}
              max={8}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="h-1 flex-1 cursor-pointer"
            />
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={advance}
              disabled={saving}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Přeskočit
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !area}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <CropIcon className="h-4 w-4" aria-hidden />
              )}
              Uložit ořez a další
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
