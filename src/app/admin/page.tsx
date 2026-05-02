import Link from "next/link";
import {
  Activity,
  Camera,
  CheckCircle2,
  Clock,
  Database,
  FileCog,
  FolderTree,
  MapPinned,
  Map as MapIcon,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { listCredentials } from "@/lib/admin/credentials";
import { readRecentAudit } from "@/lib/admin/audit";

export default async function AdminHomePage() {
  await ensureAdminAuth();
  const [credentials, recent] = await Promise.all([
    listCredentials(),
    readRecentAudit(20),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Přehled</h1>
        <p className="text-sm text-gray-600">
          Fáze 1–6 — auth, audit, prohlížeč souborů, uploady, JSON editor a
          reálné fotky.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FeatureCard
          icon={ShieldCheck}
          title="Bezpečnost"
          status="ok"
          href="/admin/audit"
          lines={[
            `${credentials.length} ${credentials.length === 1 ? "passkey" : "passkeys"}`,
            "Session 1h sliding TTL",
          ]}
        />
        <FeatureCard
          icon={FolderTree}
          title="Soubory (read-only)"
          status="ok"
          href="/admin/files"
          lines={["data/ + generated/", "Browser, preview, download"]}
        />
        <FeatureCard
          icon={Upload}
          title="Upload nálezů"
          status="ok"
          href="/admin/files/finds"
          lines={["Originály + crops", "Drag-drop, EXIF, bulk delete"]}
        />
        <FeatureCard
          icon={MapIcon}
          title="Lokační mapy"
          status="ok"
          href="/admin/files/maps"
          lines={["Add / replace / delete", "Detekce duplikátů"]}
        />
        <FeatureCard
          icon={FileCog}
          title="LokaceStavyPoznamky.json"
          status="ok"
          href="/admin/json/lokace-stavy-poznamky"
          lines={["Editor se 4 sekcemi", "Zod validace, atomic write"]}
        />
        <FeatureCard
          icon={Camera}
          title="Reálné fotky darů"
          status="ok"
          href="/admin/files/donation-photos"
          lines={[
            "generated/find-photos/",
            "Konvence: <id><slot>_DAR[_ANON]",
          ]}
        />
        <FeatureCard
          icon={MapPinned}
          title="Reálné fotky lokalit"
          status="ok"
          href="/admin/files/location-photos"
          lines={[
            "generated/location-photos/",
            "Konvence: <mapa>_reálné foto…",
          ]}
        />
        <FeatureCard
          icon={Database}
          title="Sync"
          status="todo"
          lines={["Trigger pnpm sync", "Plánováno: Fáze 7"]}
        />
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-gray-500" aria-hidden />
          <h2 className="text-sm font-semibold text-gray-900">
            Poslední aktivita
          </h2>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-500">Zatím žádné záznamy.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recent.map((row, i) => (
              <li
                key={`${row.ts}-${i}`}
                className="flex items-baseline gap-3 py-1.5 text-sm"
              >
                <Clock
                  className="h-3.5 w-3.5 shrink-0 text-gray-400"
                  aria-hidden
                />
                <span className="font-mono text-xs tabular-nums text-gray-500">
                  {new Date(row.ts).toLocaleString("cs-CZ", {
                    timeZone: "Europe/Prague",
                  })}
                </span>
                <span className="font-medium text-gray-900">{row.action}</span>
                {row.credentialLabel && (
                  <span className="text-gray-600">{row.credentialLabel}</span>
                )}
                <span className="ml-auto font-mono text-xs text-gray-400">
                  {row.ip}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  status,
  lines,
  href,
}: {
  icon: typeof ShieldCheck;
  title: string;
  status: "ok" | "todo";
  lines: string[];
  /** When set, the card becomes an interactive link to the section.
   *  TODO cards stay as static blocks — no destination yet. */
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-brand-600" aria-hidden />
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        </div>
        {status === "ok" ? (
          <CheckCircle2
            className="h-4 w-4 text-emerald-500"
            aria-label="aktivní"
          />
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
            TODO
          </span>
        )}
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:bg-brand-50/30"
      >
        {body}
      </Link>
    );
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {body}
    </div>
  );
}
