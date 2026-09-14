"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  Download,
  ExternalLink,
  FileDown,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  CASQB_DEFAULT_STYLE,
  CASQB_EYE_SHAPES,
  CASQB_LOGO_SCALES,
  CASQB_MODULE_SHAPES,
  CASQB_PRESETS,
  CASQB_SWATCHES,
  casqbLogoHeightMm,
  casqbLogoMinHeightMm,
  contrastRatio,
  type CasqbEyeShape,
  type CasqbLogoKind,
  type CasqbLogoScale,
  type CasqbModuleShape,
  type CasqbStyle,
} from "@/lib/admin/casqbQr";
import {
  createCasqbAction,
  deleteCasqbAction,
  getCasqbSvgAction,
  previewCasqbAction,
  resetCasqbScansAction,
  restoreCasqbAction,
  retireCasqbAction,
  updateCasqbAction,
  uploadCasqbLogoAction,
} from "./casqb-actions";
import type { CasqbListItem } from "./casqb-types";
import { generateCasqbVectorPdf } from "./casqb-pdf";
import { downloadPng, downloadSvg } from "./qr-download";
import { QrPdfButton } from "./qr-pdf-button";
import { CONTROL_H, Field, INPUT_CLS, Seg } from "./qr-ui";

const MODULE_LABELS: Record<CasqbModuleShape, string> = {
  square: "Čtverec",
  rounded: "Zaoblený",
  dot: "Tečky",
  fluid: "Plynulý",
};
const EYE_LABELS: Record<CasqbEyeShape, string> = {
  square: "Čtverec",
  rounded: "Zaoblené",
  circle: "Kruh",
};
const LOGO_LABELS: Record<CasqbLogoKind, string> = {
  symbol: "Symbol Q",
  wordmark: "Základní logo",
  custom: "Vlastní",
  none: "Žádné",
};
const SCALE_LABELS: Record<CasqbLogoScale, string> = { sm: "Menší", md: "Střední" };

/** Widths the vector PDF offers; the wordmark needs the larger ones to
 *  clear the manual's 5 mm. */
const PDF_WIDTHS_MM = [30, 40, 50, 60, 80, 100];

interface FormState {
  label: string;
  targetUrl: string;
  style: CasqbStyle;
}

const EMPTY_FORM: FormState = {
  label: "",
  targetUrl: "https://casqb.org/",
  style: CASQB_DEFAULT_STYLE,
};

export function CasqbPanel({
  items,
  encodedBase,
  last,
}: {
  items: CasqbListItem[];
  /** Prefix the codes encode, e.g. `https://ctyrlistkoteka.cz/go` — the
   *  server decides (lib/admin/casqbEncoded.ts); the client only shows it. */
  encodedBase: string;
  /** The destination and look of the last saved code (server-side prefs),
   *  so the form opens where the previous one ended. */
  last: { targetUrl: string; style: CasqbStyle } | null;
}) {
  const encodedHost = encodedBase.replace(/^https:\/\//, "");
  const startForm: FormState = last
    ? { label: "", targetUrl: last.targetUrl, style: last.style }
    : EMPTY_FORM;
  const router = useRouter();
  const [form, setForm] = useState<FormState>(startForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [decode, setDecode] = useState<{ verdict: "ok" | "risky" | "fail"; okCount: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: number; token: string; svg: string; encodedUrl: string } | null>(null);
  const [busy, startBusy] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const setStyle = (patch: Partial<CasqbStyle>) =>
    setForm((f) => ({ ...f, style: { ...f.style, ...patch } }));

  // Live preview, debounced: the picker changes several fields in a
  // row and the render is a server round-trip.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      const r = await previewCasqbAction(form.style);
      if (cancelled) return;
      if (r.ok) {
        setPreview(r.svg);
        setBlockers(r.blockers);
        setWarnings(r.warnings);
        setDecode({
          verdict: r.decode.verdict,
          okCount: r.decode.sizes.filter((s) => s.ok).length,
          total: r.decode.sizes.length,
        });
      } else {
        setBlockers([r.error]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [form.style]);

  const onSubmit = () => {
    setError(null);
    startBusy(async () => {
      if (editingId === null) {
        const r = await createCasqbAction(form);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setCreated({ id: r.id, token: r.token, svg: r.svg, encodedUrl: r.encodedUrl });
        // Label cleared for the next code; destination and look stay —
        // the server remembers them too, so a reload starts the same way.
        setForm((f) => ({ ...f, label: "" }));
      } else {
        const r = await updateCasqbAction(editingId, form);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setEditingId(null);
        setForm((f) => ({ ...f, label: "" }));
      }
      router.refresh();
    });
  };

  const startEdit = (item: CasqbListItem) => {
    setCreated(null);
    setError(null);
    setEditingId(item.id);
    setForm({ label: item.label, targetUrl: item.targetUrl, style: item.style });
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(startForm);
    setError(null);
  };

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const r = await uploadCasqbLogoAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setStyle({
        logo: "custom",
        custom: { data: r.data, width: r.width, height: r.height },
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const fgContrast = contrastRatio(form.style.fg, form.style.bg);
  const active = items.filter((i) => !i.archived);
  const retired = items.filter((i) => i.archived);
  const fileBase = created ? `casqb-qr-${created.token}` : null;

  return (
    <div className="space-y-6" ref={topRef}>
      <section className="space-y-4 rounded-xl border border-[#FAC1BC] bg-[#FBDFDB]/30 p-4 sm:p-5">
        <p className="text-xs text-gray-600">
          Kód pro <strong>Czech and Slovak Quality Board</strong>. Kóduje{" "}
          <span className="font-mono">{encodedHost}/&lt;token&gt;</span> — to je
          adresa, kterou telefon ukáže po naskenování —, aby šlo počítat
          naskenování, a hned přesměruje na zadanou adresu — s{" "}
          <span className="font-mono">utm_source=qr</span>, takže si ho analytika
          cílového webu spočítá taky. Vzhled podle design manuálu: barvy z palety,
          tvar modulů, oficiální logo uprostřed s ochrannou zónou. Uložený kód se
          stáhne jako SVG, PNG i PDF a jeho adresa i vzhled jdou kdykoli změnit bez
          přetisku — token zůstává.
        </p>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
          <div className="space-y-4">
            {editingId !== null && (
              <div className="flex items-center justify-between rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                <span>
                  Upravuješ kód <strong>#{editingId}</strong>. Token a vytištěný kód se
                  nemění, jen popisek, adresa a vzhled.
                </span>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-sky-800 hover:bg-sky-100"
                >
                  <X className="h-3.5 w-3.5" aria-hidden /> Zrušit
                </button>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Popisek">
                <input
                  className={`${INPUT_CLS} ${CONTROL_H}`}
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="Vizitka – konference jaro 2027"
                  maxLength={200}
                />
              </Field>
              <Field
                label="Cílová adresa"
                hint="Jen https. Změna platí okamžitě pro všechny už vytištěné kódy."
              >
                <input
                  className={`${INPUT_CLS} ${CONTROL_H} font-mono text-[13px]`}
                  value={form.targetUrl}
                  onChange={(e) => setForm((f) => ({ ...f, targetUrl: e.target.value }))}
                  placeholder="https://casqb.org/"
                  inputMode="url"
                  maxLength={2048}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Přednastavený styl" hint="Nastaví osy níže — dá se pak doladit.">
                <Seg
                  value={
                    CASQB_PRESETS.find(
                      (p) => JSON.stringify(p.style) === JSON.stringify(form.style),
                    )?.key ?? ""
                  }
                  onChange={(k) => {
                    const p = CASQB_PRESETS.find((x) => x.key === k);
                    if (p) setStyle(p.style);
                  }}
                  options={CASQB_PRESETS.map((p) => ({ v: p.key, l: p.label }))}
                />
              </Field>
              <Field label="Střed kódu">
                <div className="flex flex-wrap items-center gap-2">
                  <Seg
                    value={form.style.logo}
                    onChange={(v) => setStyle({ logo: v as CasqbLogoKind })}
                    options={(Object.keys(LOGO_LABELS) as CasqbLogoKind[]).map((k) => ({
                      v: k,
                      l: LOGO_LABELS[k],
                    }))}
                  />
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".svg,.png,image/svg+xml,image/png"
                    className="hidden"
                    onChange={(e) => void onUpload(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                  >
                    {uploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Upload className="h-3.5 w-3.5" aria-hidden />
                    )}
                    Nahrát SVG / PNG
                  </button>
                </div>
                {form.style.logo === "custom" && form.style.custom && (
                  <span className="mt-1 block text-[11px] text-gray-500">
                    Vlastní obrázek {form.style.custom.width} × {form.style.custom.height} px —
                    uloží se jako PNG uvnitř kódu.
                  </span>
                )}
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Tvar modulů">
                <Seg
                  value={form.style.modules}
                  onChange={(v) => setStyle({ modules: v as CasqbModuleShape })}
                  options={CASQB_MODULE_SHAPES.map((k) => ({ v: k, l: MODULE_LABELS[k] }))}
                />
              </Field>
              <Field label="Oči">
                <Seg
                  value={form.style.eyes}
                  onChange={(v) => setStyle({ eyes: v as CasqbEyeShape })}
                  options={CASQB_EYE_SHAPES.map((k) => ({ v: k, l: EYE_LABELS[k] }))}
                />
              </Field>
              <Field label="Velikost loga">
                <Seg
                  value={form.style.logoScale}
                  onChange={(v) => setStyle({ logoScale: v as CasqbLogoScale })}
                  options={CASQB_LOGO_SCALES.map((k) => ({ v: k, l: SCALE_LABELS[k] }))}
                />
              </Field>
            </div>

            <Field
              label="Barvy"
              hint="Z palety manuálu. Kontrast se hlídá — pod 3 : 1 se kód neuloží. Logo si barvu volí samo: červené na světlém, bílé na tmavém."
            >
              <div className="grid grid-cols-[6rem_1fr] items-center gap-y-2">
                <SwatchRow label="Moduly" kind="fg" value={form.style.fg} onPick={(hex) => setStyle({ fg: hex })} />
                <SwatchRow label="Oči" kind="eye" value={form.style.eyeOuter} onPick={(hex) => setStyle({ eyeOuter: hex })} />
                <SwatchRow label="Zornice" kind="eye" value={form.style.eyeInner} onPick={(hex) => setStyle({ eyeInner: hex })} />
                <SwatchRow label="Pozadí" kind="bg" value={form.style.bg} onPick={(hex) => setStyle({ bg: hex })} />
              </div>
            </Field>

            {blockers.length > 0 && (
              <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                {blockers.join(" ")}
              </p>
            )}
            {blockers.length === 0 && (warnings.length > 0 || decode?.verdict === "risky") && (
              <p className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                {decode?.verdict === "risky" && (
                  <>
                    <strong>Čtečka přečetla {decode.okCount} ze {decode.total} velikostí</strong> — kód
                    jde uložit, ale před tiskem ho vyzkoušej na telefonu, ideálně na dvou.{" "}
                  </>
                )}
                {warnings.join(" ")}
              </p>
            )}
            {blockers.length === 0 && warnings.length === 0 && decode?.verdict === "ok" && (
              <p className="text-xs text-brand-800">
                Čtečka přečetla všechny {decode.total} zkoušené velikosti.
              </p>
            )}
            {error && (
              <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onSubmit}
                disabled={busy || !form.label.trim() || blockers.length > 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : editingId !== null ? (
                  <Pencil className="h-4 w-4" aria-hidden />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden />
                )}
                {editingId !== null
                  ? decode?.verdict === "risky"
                    ? "Uložit i tak"
                    : "Uložit změny"
                  : decode?.verdict === "risky"
                    ? "Vytvořit i tak"
                    : "Vytvořit QR kód"}
              </button>
              {editingId === null && (
                <span className="text-xs text-gray-500">
                  Token se vylosuje při uložení; do té doby náhled kóduje ukázkovou adresu.
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-col items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
              {created ? (
                <div
                  className="w-full max-w-[280px]"
                  dangerouslySetInnerHTML={{ __html: fitSvg(created.svg) }}
                />
              ) : preview ? (
                <div className="w-full max-w-[280px]" dangerouslySetInnerHTML={{ __html: fitSvg(preview) }} />
              ) : (
                <div className="flex h-[280px] w-full items-center justify-center text-gray-400">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                </div>
              )}
              <div className="text-center">
                <p className="font-mono text-xs text-gray-600">
                  {created ? created.encodedUrl.replace(/^https:\/\//, "") : `${encodedHost}/xxxxxx`}
                </p>
                <p className="truncate text-xs text-gray-500">→ {form.targetUrl || "…"}</p>
              </div>
              <p className="flex flex-wrap justify-center gap-x-3 text-[11px] text-gray-500">
                <span>
                  Kontrast{" "}
                  <strong className={fgContrast >= 3 ? "text-brand-800" : "text-rose-700"}>
                    {fgContrast.toFixed(1).replace(".", ",")} : 1
                  </strong>
                </span>
                <span>korekce H</span>
              </p>
            </div>
            {created && fileBase && (
              <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                <p>
                  Uloženo jako <strong>#{created.id}</strong>, token{" "}
                  <span className="font-mono">{created.token}</span>. Stáhni si ho:
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <SmallButton onClick={() => downloadSvg(created.svg, `${fileBase}.svg`)} icon={<Download className="h-3.5 w-3.5" aria-hidden />} text="SVG" />
                  <SmallButton onClick={() => void downloadPng(created.svg, `${fileBase}.png`, 2)} icon={<Download className="h-3.5 w-3.5" aria-hidden />} text="PNG 2048 px" />
                  <CasqbVectorPdfButton
                    svg={created.svg}
                    token={created.token}
                    style={form.style}
                    url={created.encodedUrl}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <CodeList title="Aktivní" items={active} onEdit={startEdit} onChanged={() => router.refresh()} />
      <CodeList title="Vyřazené" items={retired} onEdit={startEdit} onChanged={() => router.refresh()} />

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600 sm:p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Jak to vidět v analytice casqb.org
        </h3>
        <p>
          Každé naskenování dorazí na cílový web s parametry{" "}
          <span className="font-mono">utm_source=qr</span>,{" "}
          <span className="font-mono">utm_medium=casqb</span> a{" "}
          <span className="font-mono">utm_campaign=&lt;popisek kódu&gt;</span>. Jako
          odkazovač cílový web dostane jen doménu ctyrlistkoteka.cz, nikdy adresu{" "}
          <span className="font-mono">/go/…</span>. Nic dalšího instalovat netřeba:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Google Analytics 4</strong> — UTM čte samo. Zprávy → Akvizice → Akvizice
            návštěvnosti; zdroj/médium bude <span className="font-mono">qr / casqb</span>,
            kampaň = popisek kódu.
          </li>
          <li>
            <strong>Plausible</strong> — Top Sources → záložka UTM Sources / Campaigns.
          </li>
          <li>
            <strong>Matomo</strong> — Akvizice → Kampaně (UTM se mapuje na kampaň, zdroj i médium).
          </li>
          <li>
            <strong>Bez analytiky</strong> — počty skenů jsou tady, v Statistikách u každého kódu;
            k tomu nic na casqb.org potřeba není.
          </li>
        </ul>
        <p className="text-gray-500">
          Když do cílové adresy napíšeš vlastní <span className="font-mono">utm_*</span>, má
          přednost — naše se doplní jen tam, kde chybí.
        </p>
      </section>
    </div>
  );
}

/** The SVG comes with a fixed px width; here it fills its box. */
function fitSvg(svg: string): string {
  return svg.replace(/<svg([^>]*)\swidth="\d+"\sheight="\d+"/, '<svg$1 width="100%" height="100%"');
}

function SwatchRow({
  label,
  kind,
  value,
  onPick,
}: {
  label: string;
  kind: "fg" | "eye" | "bg";
  value: string;
  onPick: (hex: string) => void;
}) {
  return (
    <>
      <span className="text-xs text-gray-700">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {CASQB_SWATCHES.filter((s) => s.roles.includes(kind)).map((s) => {
          const selected = s.hex.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={s.hex}
              type="button"
              title={`${s.name} ${s.hex}`}
              aria-label={`${label}: ${s.name}`}
              aria-pressed={selected}
              onClick={() => onPick(s.hex)}
              className={`h-7 w-7 rounded-md border border-black/10 transition ${
                selected ? "ring-2 ring-gray-900 ring-offset-2 ring-offset-white" : "hover:scale-105"
              }`}
              style={{ background: s.hex }}
            />
          );
        })}
      </div>
    </>
  );
}

function SmallButton({
  onClick,
  icon,
  text,
  tone = "default",
  disabled,
  title,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  text?: string;
  tone?: "default" | "warn" | "danger";
  disabled?: boolean;
  title?: string;
}) {
  const cls =
    tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
      : tone === "danger"
        ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
        : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={text ? undefined : title}
      className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition disabled:opacity-50 ${cls}`}
    >
      {icon}
      {text && <span>{text}</span>}
    </button>
  );
}

/** Vector PDF with a size picker — and the manual's 5 mm logo minimum
 *  checked against the chosen size before anything is generated. */
function CasqbVectorPdfButton({
  svg,
  token,
  style,
  url,
  load,
}: {
  svg?: string;
  token: string;
  style: CasqbStyle;
  url: string;
  /** Lazy source for list rows (the SVG is not held client-side). */
  load?: () => Promise<{ ok: true; svg: string } | { ok: false; error: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [widthMm, setWidthMm] = useState(40);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoMm = casqbLogoHeightMm(style, url, widthMm);
  const minMm = casqbLogoMinHeightMm(style);
  const tooSmall = logoMm !== null && logoMm < minMm;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      let src = svg;
      if (!src && load) {
        const r = await load();
        if (!r.ok) {
          setError(r.error);
          return;
        }
        src = r.svg;
      }
      if (!src) return;
      await generateCasqbVectorPdf(src, `casqb-qr-${token}-${widthMm}mm.pdf`, { widthMm });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF se nepodařilo vytvořit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SmallButton
        onClick={() => setOpen(true)}
        icon={<FileDown className="h-3.5 w-3.5" aria-hidden />}
        text="PDF"
        title="Vektorové PDF — křivky, stránka na míru kódu"
      />
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Vektorové PDF"
            className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900">Vektorové PDF</h4>
              <button type="button" onClick={() => setOpen(false)} aria-label="Zavřít" className="rounded p-1 text-gray-500 hover:bg-gray-100">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <p className="text-xs text-gray-600">
              Stránka je přesně kód plus 5 mm okraj — křivky, ne obrázek. Šířka
              kódu včetně klidové zóny:
            </p>
            <Seg
              value={String(widthMm)}
              onChange={(v) => setWidthMm(Number(v))}
              options={PDF_WIDTHS_MM.map((w) => ({ v: String(w), l: `${w} mm` }))}
            />
            {logoMm !== null && (
              <p className={`text-xs ${tooSmall ? "text-rose-700" : "text-gray-500"}`}>
                Logo vyjde {logoMm.toFixed(1).replace(".", ",")} mm vysoké
                {tooSmall
                  ? ` — manuál chce aspoň ${minMm} mm. Zvol větší šířku.`
                  : ` (minimum manuálu ${minMm} mm).`}
              </p>
            )}
            {error && <p className="text-xs text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                Zrušit
              </button>
              <button
                type="button"
                onClick={() => void run()}
                disabled={busy || tooSmall}
                className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FileDown className="h-3.5 w-3.5" aria-hidden />}
                Stáhnout PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Spark({ values, muted }: { values: number[]; muted: boolean }) {
  const w = 84;
  const h = 22;
  const max = Math.max(1, ...values);
  const n = values.length;
  const bw = Math.floor((w - (n - 1) * 2) / n);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      {values.map((v, i) => {
        const bh = v === 0 ? 1 : Math.max(2, Math.round((v / max) * h));
        return (
          <rect
            key={i}
            x={i * (bw + 2)}
            y={h - bh}
            width={bw}
            height={bh}
            rx={1.5}
            fill={v === 0 ? "#e5e7eb" : muted ? "#d1d5db" : "#EF4635"}
          />
        );
      })}
    </svg>
  );
}

function Stat({ value, label, muted }: { value: number; label: string; muted?: boolean }) {
  return (
    <div className="min-w-[2.6rem] text-center">
      <span className={`block font-mono text-sm font-semibold tabular-nums ${muted ? "text-gray-400" : "text-gray-900"}`}>
        {value.toLocaleString("cs-CZ")}
      </span>
      <span className="block text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
    </div>
  );
}

function CodeList({
  title,
  items,
  onEdit,
  onChanged,
}: {
  title: string;
  items: CasqbListItem[];
  onEdit: (item: CasqbListItem) => void;
  onChanged: () => void;
}) {
  if (items.length === 0 && title === "Vyřazené") return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title} <span className="font-normal text-gray-400">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
          Zatím žádný kód. První vytvoříš nahoře.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <CodeRow key={item.id} item={item} onEdit={() => onEdit(item)} onChanged={onChanged} />
          ))}
        </ul>
      )}
      {title === "Vyřazené" && items.length > 0 && (
        <p className="text-xs text-gray-500">
          Vyřazený kód dál přesměrovává — vizitka na stole někomu funguje i za rok — jen se
          nepočítá mezi aktivní a nedotiskuje se. Skeny po vyřazení se evidují zvlášť.
        </p>
      )}
    </section>
  );
}

function CodeRow({
  item,
  onEdit,
  onChanged,
}: {
  item: CasqbListItem;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const url = item.encodedUrl;

  const load = async () => {
    const r = await getCasqbSvgAction(item.id);
    return r.ok ? { ok: true as const, svg: r.svg, token: r.token, label: r.label } : r;
  };

  useEffect(() => {
    let cancelled = false;
    void load().then((r) => {
      if (!cancelled && r.ok) setThumb(fitSvg(r.svg));
    });
    return () => {
      cancelled = true;
    };
    // The thumbnail follows the stored style; item.style changes when
    // the row is re-fetched after an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.style]);

  const act = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Akce selhala");
      else onChanged();
    } finally {
      setBusy(null);
    }
  };

  const download = async (kind: "svg" | "png") => {
    const r = await load();
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const base = `casqb-qr-${r.token}`;
    if (kind === "svg") downloadSvg(r.svg, `${base}.svg`);
    else await downloadPng(r.svg, `${base}.png`, 2);
  };

  return (
    <li
      className={`rounded-lg border p-3 ${
        item.archived ? "border-gray-200 bg-gray-50 opacity-80" : "border-[#FAC1BC] bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-white">
          {thumb && <div className="h-full w-full" dangerouslySetInnerHTML={{ __html: thumb }} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-semibold text-gray-900">{item.label}</span>
            {item.archived && (
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-800">
                Vyřazený
              </span>
            )}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 truncate text-xs text-gray-500">
            <ExternalLink className="h-3 w-3 text-gray-400" aria-hidden />
            <span className="text-gray-700">{item.targetUrl}</span>
            <span className="text-gray-400">·</span>
            <span className="font-mono text-gray-600">{item.encodedUrl.replace(/^https:\/\//, "")}</span>
            <span className="text-gray-400">· {item.createdAt}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Spark values={item.spark} muted={item.archived} />
          <Stat value={item.scans7} label="7 dní" muted={item.archived} />
          <Stat value={item.scans30} label="30 dní" muted={item.archived} />
          <Stat value={item.scansTotal} label="celkem" muted={item.archived} />
          {item.archived && item.afterRetire > 0 && (
            <Stat value={item.afterRetire} label="po vyřazení" />
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <SmallButton onClick={() => void download("svg")} icon={<Download className="h-3.5 w-3.5" aria-hidden />} text="SVG" />
          <SmallButton onClick={() => void download("png")} icon={<Download className="h-3.5 w-3.5" aria-hidden />} text="PNG" />
          <CasqbVectorPdfButton token={item.token} style={item.style} url={url} load={load} />
          <QrPdfButton id={item.id} load={load} filePrefix="casqb-qr" text="Arch A4" />
          <span className="mx-0.5 h-5 w-px bg-gray-200" aria-hidden />
          <Link
            href={`/admin/qr/casqb/${item.id}`}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-[11px] font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <BarChart3 className="h-3.5 w-3.5" aria-hidden /> Statistiky
          </Link>
          <SmallButton onClick={onEdit} icon={<Pencil className="h-3.5 w-3.5" aria-hidden />} title="Upravit popisek, adresu nebo vzhled" />
          <SmallButton
            tone="warn"
            title="Vynulovat skeny"
            disabled={busy !== null || item.scansTotal === 0}
            onClick={() => {
              if (
                window.confirm(
                  `Smazat všech ${item.scansTotal.toLocaleString("cs-CZ")} skenů kódu „${item.label}“? Nejde to vrátit.`,
                )
              ) {
                void act("reset", () => resetCasqbScansAction(item.id));
              }
            }}
            icon={busy === "reset" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
          />
          <SmallButton
            title={item.archived ? "Obnovit mezi aktivní" : "Vyřadit (přesměrování zůstává)"}
            disabled={busy !== null}
            onClick={() =>
              void act("archive", () =>
                item.archived ? restoreCasqbAction(item.id) : retireCasqbAction(item.id),
              )
            }
            icon={
              busy === "archive" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : item.archived ? (
                <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Archive className="h-3.5 w-3.5" aria-hidden />
              )
            }
          />
          <SmallButton
            tone="danger"
            title="Smazat kód — token přestane fungovat"
            disabled={busy !== null}
            onClick={() => {
              if (
                window.confirm(
                  `Smazat kód „${item.label}“ i s jeho skeny? Vytištěné kódy přestanou fungovat. Pokud je někde venku, radši ho vyřaď.`,
                )
              ) {
                void act("delete", () => deleteCasqbAction(item.id));
              }
            }}
            icon={busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
          />
        </div>
      </div>
      {error && (
        <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">{error}</p>
      )}
    </li>
  );
}
