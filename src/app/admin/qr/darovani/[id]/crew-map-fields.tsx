"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import { saveCrewMapAction } from "../../drop-actions";
import { CONTROL_H, CONTROL_H_SM, Field, INPUT_CLS } from "../../qr-ui";

/**
 * The switch that puts one area's hiding places on a link the crew can open.
 *
 * Everywhere else in this admin the rule is absolute: coordinates never
 * leave /admin. This is the deliberate exception, so the panel says so out
 * loud rather than looking like one more setting. Off by default, needs a
 * password, and "Nový odkaz" is a one-click revoke.
 */
export function CrewMapFields({
  campaignId,
  areaId,
  areaName,
  token,
  password,
  siteOrigin,
}: {
  campaignId: number;
  areaId: number;
  areaName: string;
  token: string | null;
  password: string | null;
  /** Where the link points — resolved on the server so this component
   *  doesn't have to guess the deployment's own address. */
  siteOrigin: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(token !== null);
  const [pw, setPw] = useState(password ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, start] = useTransition();

  const url = token ? `${siteOrigin}/tym/${token}` : null;

  const save = (regenerate: boolean) => {
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await saveCrewMapAction(campaignId, areaId, {
        enabled,
        password: pw,
        regenerate,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNotice(
        !enabled
          ? "Mapa pro tým je vypnutá, odkaz už nefunguje."
          : regenerate
            ? "Nový odkaz vytvořen — ten starý okamžitě přestal platit."
            : "Uloženo.",
      );
      router.refresh();
    });
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused (permissions, insecure origin) — the field is
      // selectable, so this quietly does nothing rather than shouting.
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="h-4 w-4 text-amber-700" aria-hidden />
        <p className="text-xs font-semibold text-amber-900">Mapa pro tým</p>
        <label className="ml-auto inline-flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          Zapnout pro „{areaName}“
        </label>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-900">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Na odkazu jsou pozice <strong>všech</strong> schovaných kartiček téhle
        oblasti. Chrání ho jen náhodná adresa a tohle heslo — posílej ho jen
        lidem, kteří kartičky schovávají.
      </p>

      {enabled && (
        <Field
          label="Heslo"
          hint="Uvidí ho každý, komu ho pošleš. Změna hesla odhlásí všechny, kdo mapu měli otevřenou."
        >
          <input
            className={`${INPUT_CLS} ${CONTROL_H}`}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="např. ctyrlistek-zlin"
            autoComplete="off"
          />
        </Field>
      )}

      {enabled && url && (
        <Field label="Odkaz">
          <div className="flex items-center gap-1.5">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className={`${INPUT_CLS} ${CONTROL_H} font-mono text-[11px]`}
            />
            <button
              type="button"
              onClick={copy}
              title="Zkopírovat odkaz"
              className={`${CONTROL_H} inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs text-gray-700 transition hover:bg-gray-50`}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
              Kopírovat
            </button>
          </div>
        </Field>
      )}

      {notice && (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-900">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => save(false)}
          disabled={busy}
          className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50`}
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {enabled ? "Uložit mapu pro tým" : "Vypnout mapu pro tým"}
        </button>
        {enabled && token && (
          <button
            type="button"
            onClick={() => save(true)}
            disabled={busy}
            title="Vytvoří novou náhodnou adresu — starý odkaz přestane fungovat"
            className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 text-xs text-gray-700 transition hover:bg-gray-50 disabled:opacity-50`}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Nový odkaz
          </button>
        )}
      </div>
    </div>
  );
}
