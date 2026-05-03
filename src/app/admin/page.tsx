import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Crop,
  Database,
  FileCog,
  Image as ImageIcon,
  ListChecks,
  MapPinned,
  Map as MapIcon,
  ShieldCheck,
} from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { listCredentials } from "@/lib/admin/credentials";
import { readRecentAudit } from "@/lib/admin/audit";
import { runChecksSummary } from "@/lib/admin/checks";

export default async function AdminHomePage() {
  await ensureAdminAuth();
  const [credentials, recent, checks] = await Promise.all([
    listCredentials(),
    readRecentAudit(20),
    runChecksSummary(),
  ]);
  const checksOk = checks.totalIssues === 0;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Přehled</h1>
        <p className="text-sm text-gray-600">
          Fáze 1–7 — auth, audit, prohlížeč souborů, uploady, JSON editor,
          reálné fotky a sync trigger.
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
          icon={ImageIcon}
          title="Originály nálezů"
          status="ok"
          href="/admin/files/finds"
          lines={["data/finds/", "Drag-drop, EXIF, bulk delete"]}
        />
        <FeatureCard
          icon={Crop}
          title="Výřezy nálezů"
          status="ok"
          href="/admin/files/crops"
          lines={["data/crops/", "Akceptuje i zkrácené <id>.jpg"]}
        />
        <FeatureCard
          icon={MapIcon}
          title="Lokační mapy"
          status="ok"
          href="/admin/files/maps"
          lines={["data/maps/", "Detekce duplikátů, bulk delete"]}
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
          icon={FileCog}
          title="LokaceStavyPoznamky.json"
          status="ok"
          href="/admin/files/meta/LokaceStavyPoznamky.json"
          lines={[
            "Náhled + statistiky + lookup",
            "Z náhledu krok do editoru",
          ]}
        />
        <FeatureCard
          icon={Database}
          title="Sync"
          status="ok"
          href="/admin/sync"
          lines={[
            "Trigger tsx scripts/sync.ts",
            "Live log, dry-run, --only filtr",
          ]}
        />
        <FeatureCard
          icon={ListChecks}
          title="Kontroly konzistence"
          status={checksOk ? "ok" : "warn"}
          href="/admin/checks"
          lines={
            checksOk
              ? [
                  `Vše OK — všech ${checks.totalChecks} kontrol prošlo`,
                  "Anonymizace, EXIF datum, originál ↔ výřez",
                ]
              : [
                  `${checks.totalIssues} ${pluralIssues(checks.totalIssues)} v ${checks.failedChecks} z ${checks.totalChecks} kontrol`,
                  "Klikni pro detail a opravu",
                ]
          }
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
  /** "ok" — green check, neutral bg.
   *  "warn" — red bg + amber triangle, used when the card surfaces
   *           an actionable problem (e.g. failed consistency checks).
   *  "todo" — placeholder card for sections not yet implemented. */
  status: "ok" | "warn" | "todo";
  lines: string[];
  /** When set, the card becomes an interactive link to the section.
   *  TODO cards stay as static blocks — no destination yet. */
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon
            className={`h-4 w-4 ${status === "warn" ? "text-red-700" : "text-brand-600"}`}
            aria-hidden
          />
          <h3
            className={`text-sm font-semibold ${status === "warn" ? "text-red-900" : "text-gray-900"}`}
          >
            {title}
          </h3>
        </div>
        {status === "ok" ? (
          <CheckCircle2
            className="h-4 w-4 text-emerald-500"
            aria-label="aktivní"
          />
        ) : status === "warn" ? (
          <AlertTriangle
            className="h-4 w-4 text-red-600"
            aria-label="problém"
          />
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
            TODO
          </span>
        )}
      </div>
      <ul
        className={`mt-2 space-y-0.5 text-xs ${status === "warn" ? "text-red-900" : "text-gray-600"}`}
      >
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </>
  );
  // Card chrome differs by status. Warn keeps the link affordance
  // but switches the background + border to a red wash so the
  // "click here to fix" intent is unmistakable from the home grid.
  const chromeBase = "block rounded-xl border p-4 shadow-sm transition";
  const chrome =
    status === "warn"
      ? `${chromeBase} border-red-300 bg-red-50 hover:border-red-400 hover:bg-red-100/70`
      : `${chromeBase} border-gray-200 bg-white hover:border-brand-300 hover:bg-brand-50/30`;
  if (href) {
    return (
      <Link href={href} className={chrome}>
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

/** Czech "1 problém" / "2 problémy" / "5 problémů" — kept inline
 *  because it's only used here and pluralCs in @/lib/format expects
 *  a 3-tuple per word, which is fine but heavier than needed. */
function pluralIssues(n: number): string {
  if (n === 1) return "problém";
  if (n >= 2 && n <= 4) return "problémy";
  return "problémů";
}
