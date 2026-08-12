"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Power,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import { saveCrewMapAction } from "../../drop-actions";
import { CONTROL_H, CONTROL_H_SM, INPUT_CLS } from "../../qr-ui";

/**
 * The switch that puts one area's hiding places on a link the crew can open.
 *
 * Everywhere else in this admin the rule is absolute: coordinates never
 * leave /admin. This is the deliberate exception, so the panel says so out
 * loud rather than looking like one more setting.
 *
 * It lives in the area's ROW, not in its edit form, and for two reasons the
 * first version got wrong: the link and the password are things you come
 * here to READ (to send them to somebody), and a second "Uložit" inside a
 * form that already has one is a coin toss about which button saves what.
 * So this block owns its own state entirely — the area's own Uložit never
 * touches it, and nothing here is a draft waiting to be confirmed
 * elsewhere.
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
  const on = token !== null;
  return on ? (
    <CrewMapOn
      campaignId={campaignId}
      areaId={areaId}
      token={token}
      password={password ?? ""}
      siteOrigin={siteOrigin}
    />
  ) : (
    <CrewMapOff
      campaignId={campaignId}
      areaId={areaId}
      areaName={areaName}
    />
  );
}

/** Not switched on: one line, and a button that opens the one field it
 *  needs. Nothing to "uncheck" — there is nothing on yet. */
function CrewMapOff({
  campaignId,
  areaId,
  areaName,
}: {
  campaignId: number;
  areaId: number;
  areaName: string;
}) {
  const router = useRouter();
  const [arming, setArming] = useState(false);
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const turnOn = () => {
    setError(null);
    start(async () => {
      const r = await saveCrewMapAction(campaignId, areaId, {
        enabled: true,
        password: pw,
        regenerate: true,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  };

  if (!arming) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
        <Users className="h-4 w-4 text-gray-400" aria-hidden />
        <p className="text-xs text-gray-500">
          Mapa pro tým je vypnutá — nikdo se na úkryty téhle oblasti nedostane.
        </p>
        <button
          type="button"
          onClick={() => setArming(true)}
          className={`${CONTROL_H_SM} ml-auto inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50`}
        >
          <Power className="h-3.5 w-3.5" aria-hidden />
          Zapnout
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/70 p-3">
      <p className="flex items-center gap-2 text-xs font-semibold text-amber-900">
        <Users className="h-4 w-4" aria-hidden />
        Zapnout mapu pro tým — {areaName}
      </p>
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-900">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Vznikne veřejná adresa, na které jsou pozice <strong>všech</strong>{" "}
        schovaných kartiček téhle oblasti. Chrání ji jen náhodnost té adresy
        a tohle heslo.
      </p>
      <label className="block text-[11px] font-medium text-gray-700">
        Heslo pro tým
        <input
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="např. ctyrlistek-zlin"
          autoComplete="off"
          className={`${INPUT_CLS} ${CONTROL_H} mt-1`}
        />
      </label>
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={turnOn}
          disabled={busy}
          className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-white px-2.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50`}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Power className="h-3.5 w-3.5" aria-hidden />
          )}
          Zapnout a vytvořit odkaz
        </button>
        <button
          type="button"
          onClick={() => {
            setArming(false);
            setError(null);
          }}
          className="text-xs text-gray-500 underline-offset-2 hover:underline"
        >
          Zrušit
        </button>
      </div>
    </div>
  );
}

/** Switched on: the link and the password are here to be READ and copied,
 *  so they are plain text with copy buttons, not a form to fill in again. */
function CrewMapOn({
  campaignId,
  areaId,
  token,
  password,
  siteOrigin,
}: {
  campaignId: number;
  areaId: number;
  token: string;
  password: string;
  siteOrigin: string;
}) {
  const router = useRouter();
  const [pw, setPw] = useState(password);
  // Visible by default: this is an authenticated, IP-cloaked admin page,
  // and the whole reason to come here is to READ the password and tell
  // somebody. The toggle is for hiding it while sharing a screen.
  const [showPw, setShowPw] = useState(true);
  const [confirmOff, setConfirmOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const url = `${siteOrigin}/tym/${token}`;
  const dirty = pw !== password;

  const act = (
    input: { enabled: boolean; password: string; regenerate: boolean },
    done: string,
  ) => {
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await saveCrewMapAction(campaignId, areaId, input);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNotice(done);
      setConfirmOff(false);
      router.refresh();
    });
  };

  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="h-4 w-4 text-amber-700" aria-hidden />
        <p className="text-xs font-semibold text-amber-900">
          Mapa pro tým je zapnutá
        </p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-amber-900 underline-offset-2 hover:underline"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          otevřít
        </a>
      </div>

      <CopyRow label="Odkaz" value={url} mono />
      <CopyRow
        label="Heslo"
        value={pw}
        onChange={setPw}
        secret={!showPw}
        onToggleSecret={() => setShowPw((v) => !v)}
      />

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-900">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Na odkazu jsou pozice <strong>všech</strong> schovaných kartiček téhle
        oblasti. Posílej ho jen lidem, kteří kartičky schovávají.
      </p>

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
        {dirty && (
          <button
            type="button"
            onClick={() =>
              act(
                { enabled: true, password: pw, regenerate: false },
                "Heslo změněno — kdo měl mapu otevřenou, musí ho zadat znovu.",
              )
            }
            disabled={busy}
            className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-white px-2.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50`}
          >
            {busy && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            Uložit nové heslo
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            act(
              { enabled: true, password: pw, regenerate: true },
              "Nový odkaz vytvořen — ten starý okamžitě přestal platit.",
            )
          }
          disabled={busy}
          title="Vytvoří novou náhodnou adresu — starý odkaz přestane fungovat"
          className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 text-xs text-gray-700 transition hover:bg-gray-50 disabled:opacity-50`}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Nový odkaz
        </button>
        {confirmOff ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] text-red-900">
            Vypnout? Odkaz i heslo se smažou.
            <button
              type="button"
              onClick={() =>
                act(
                  { enabled: false, password: "", regenerate: false },
                  "Mapa pro tým je vypnutá, odkaz už nefunguje.",
                )
              }
              disabled={busy}
              className="font-semibold underline-offset-2 hover:underline"
            >
              Ano
            </button>
            <button
              type="button"
              onClick={() => setConfirmOff(false)}
              className="underline-offset-2 hover:underline"
            >
              Ne
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmOff(true)}
            disabled={busy}
            className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 text-xs text-gray-500 transition hover:bg-gray-50 disabled:opacity-50`}
          >
            <Power className="h-3.5 w-3.5" aria-hidden />
            Vypnout
          </button>
        )}
      </div>
    </div>
  );
}

/** A value to read and hand on: shown, selectable, copyable in one click. */
function CopyRow({
  label,
  value,
  mono = false,
  secret = false,
  onChange,
  onToggleSecret,
}: {
  label: string;
  value: string;
  mono?: boolean;
  secret?: boolean;
  onChange?: (v: string) => void;
  onToggleSecret?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused (permissions, insecure origin) — the field is
      // selectable, so this quietly does nothing rather than shouting.
    }
  };

  return (
    <label className="block text-[11px] font-medium text-gray-700">
      {label}
      <span className="mt-1 flex items-center gap-1.5">
        <input
          value={value}
          readOnly={!onChange}
          type={secret ? "password" : "text"}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={(e) => !onChange && e.currentTarget.select()}
          autoComplete="off"
          className={`${INPUT_CLS} ${CONTROL_H} ${mono ? "font-mono text-[11px]" : ""}`}
        />
        {onToggleSecret && (
          <button
            type="button"
            onClick={onToggleSecret}
            title={secret ? "Zobrazit heslo" : "Skrýt heslo"}
            aria-label={secret ? "Zobrazit heslo" : "Skrýt heslo"}
            className={`${CONTROL_H} inline-flex shrink-0 items-center rounded-md border border-gray-300 bg-white px-2 text-gray-600 transition hover:bg-gray-50`}
          >
            {secret ? (
              <Eye className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <EyeOff className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          title={`Zkopírovat: ${label.toLowerCase()}`}
          className={`${CONTROL_H} inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs text-gray-700 transition hover:bg-gray-50`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </span>
    </label>
  );
}
