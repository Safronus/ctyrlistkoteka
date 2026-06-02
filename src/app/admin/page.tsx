import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Camera,
  CheckCircle2,
  Clock,
  Crop,
  Database,
  FileCog,
  HardDrive,
  Image as ImageIcon,
  Images as ImagesIcon,
  ListChecks,
  MapPinned,
  Map as MapIcon,
  Network,
  ShieldCheck,
  Sticker,
  Timer,
  Trophy,
} from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { listCredentials } from "@/lib/admin/credentials";
import { readRecentAudit } from "@/lib/admin/audit";
import { runChecksSummary } from "@/lib/admin/checks";
import { checkSyncNeeded } from "@/lib/admin/syncNeeded";
import { getDiskUsage, type DiskUsage } from "@/lib/admin/scopes";

/** Time window for collapsing consecutive file.upload entries from the
 *  same operator + scope into one summary row. Match the upload form's
 *  rough "single batch" duration — a 50-file batch usually finishes
 *  inside ~2 minutes, so 3 min leaves margin for slow batches without
 *  bridging into a genuinely separate upload session. */
const UPLOAD_BATCH_WINDOW_MS = 3 * 60 * 1000;

interface UploadBatchExtra {
  /** Number of file.upload entries merged into this row. 1 = single
   *  upload (no aggregation), >1 = batch. */
  batchCount: number;
  /** Earliest timestamp in the batch (the row's `ts` is the latest). */
  batchEarliestTs: string;
  /** Scope value pulled from `details.scope` — finds / crops / maps. */
  batchScope?: string;
}

type ActivityRow = Awaited<ReturnType<typeof readRecentAudit>>[number] &
  Partial<UploadBatchExtra>;

/** Folds consecutive file.upload entries from the same operator +
 *  scope within UPLOAD_BATCH_WINDOW_MS into a single summary row.
 *
 *  `recent` arrives newest-first (readRecentAudit reverses the file
 *  tail), so when walking the array `last` is more recent than `row`
 *  and a "within batch" predicate compares `last.ts - row.ts`. */
function aggregateUploadBatches(
  recent: Awaited<ReturnType<typeof readRecentAudit>>,
): ActivityRow[] {
  const out: ActivityRow[] = [];
  for (const row of recent) {
    const last = out[out.length - 1];
    const scope =
      typeof row.details?.scope === "string" ? row.details.scope : undefined;
    if (
      row.action === "file.upload" &&
      last?.action === "file.upload" &&
      last.credentialLabel === row.credentialLabel &&
      last.batchScope === scope &&
      Date.parse(last.ts) - Date.parse(row.ts) < UPLOAD_BATCH_WINDOW_MS
    ) {
      // Merge into the existing batch row. The display row keeps the
      // newest `ts` (so it sorts to the top) and tracks the earliest
      // for the time range.
      last.batchCount = (last.batchCount ?? 1) + 1;
      last.batchEarliestTs = row.ts;
    } else {
      out.push({
        ...row,
        batchCount: 1,
        batchEarliestTs: row.ts,
        batchScope: scope,
      });
    }
  }
  return out;
}

function formatActivityTs(ts: string): string {
  return new Date(ts).toLocaleString("cs-CZ", {
    timeZone: "Europe/Prague",
  });
}

function formatActivityTimeOnly(ts: string): string {
  return new Date(ts).toLocaleTimeString("cs-CZ", {
    timeZone: "Europe/Prague",
  });
}

export default async function AdminHomePage() {
  await ensureAdminAuth();
  const [
    credentials,
    recentRaw,
    checks,
    syncFinds,
    syncMaps,
    syncMeta,
    diskUsage,
  ] = await Promise.all([
    listCredentials(),
    // Pull a larger tail than we ultimately display — when a single
    // batch upload writes 50 rows, we still want 20 logical events on
    // screen after aggregation.
    readRecentAudit(200),
    runChecksSummary(),
    // Per-scope sync-needed checks for the tile indicators below.
    // Each call does a dir-mtime vs. last-sync-success comparison —
    // bounded by the directory count for the scope (1–2 dirs),
    // negligible overhead even on cold cache.
    checkSyncNeeded(["finds"]),
    checkSyncNeeded(["maps"]),
    checkSyncNeeded(["meta"]),
    getDiskUsage(),
  ]);
  const recent = aggregateUploadBatches(recentRaw).slice(0, 20);
  const checksOk = checks.totalIssues === 0;
  const findsNeedSync = syncFinds.needed;
  const mapsNeedSync = syncMaps.needed;
  const metaNeedSync = syncMeta.needed;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Přehled</h1>
        <p className="text-sm text-gray-600">
          Fáze 1–7 — auth, audit, prohlížeč souborů, uploady, JSON editor,
          reálné fotky a sync trigger.
        </p>
      </header>

      {/* Section 1 — Soubory sbírky.
          Everything the rsync pipeline ships from the user's Mac to
          the VPS and that sync.ts processes into the DB. Originály +
          Výřezy form a tight pair (find originals + their crops),
          Lokační mapy define the location universe, real-photo
          uploads sit in generated/ and are an admin-only overlay. */}
      <Group title="Soubory sbírky">
        <FeatureCard
          icon={ImageIcon}
          title="Originály nálezů"
          status="ok"
          syncNeeded={findsNeedSync}
          href="/admin/files/finds"
          lines={["data/finds/", "Drag-drop, EXIF, bulk delete"]}
        />
        <FeatureCard
          icon={Crop}
          title="Výřezy nálezů"
          status="ok"
          syncNeeded={findsNeedSync}
          href="/admin/files/crops"
          lines={["data/crops/", "Akceptuje i zkrácené <id>.jpg"]}
        />
        <FeatureCard
          icon={MapIcon}
          title="Lokační mapy"
          status="ok"
          syncNeeded={mapsNeedSync}
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
          icon={ImagesIcon}
          title="Volné fotky nálezů"
          status="ok"
          href="/admin/files/free-photos"
          lines={[
            "generated/find-free-photos/",
            "Konvence: <id><slot>_FOTO • >2 MB → WebP",
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
      </Group>

      {/* Section 2 — Strukturovaný obsah.
          JSON editors + content authoring surfaces. Admin edits via
          UI, runtime loaders pick changes up without rebuild. */}
      <Group title="Strukturovaný obsah">
        <FeatureCard
          icon={FileCog}
          title="LokaceStavyPoznamky.json"
          status="ok"
          syncNeeded={metaNeedSync}
          href="/admin/files/meta/LokaceStavyPoznamky.json"
          lines={[
            "Náhled + statistiky + lookup",
            "Z náhledu krok do editoru",
          ]}
        />
        <FeatureCard
          icon={Network}
          title="Hierarchie lokalit"
          status="ok"
          syncNeeded={metaNeedSync}
          href="/admin/json/lokace-hierarchie"
          lines={[
            "data/meta/LokaceHierarchie.json",
            "Rodič / dítě, max. hloubka 2",
          ]}
        />
        <FeatureCard
          icon={Sticker}
          title="Textové lístečky"
          status="ok"
          href="/admin/clover-texts"
          lines={[
            "data/meta/clover-texts.json + .en.json",
            "CRUD rotujících faktů na homepage",
          ]}
        />
        <FeatureCard
          icon={Trophy}
          title="Hlasování"
          status="ok"
          href="/admin/votes"
          lines={[
            "Audit + mazání hlasů (single / fp / uuid)",
            "Tlačítko pro kompletní reset",
          ]}
        />
      </Group>

      {/* Section 3 — Provoz.
          Operational surfaces: trigger sync, look at consistency
          state, manage credentials + audit. Sync first because it's
          the most frequent action, then checks (verify), then
          security (housekeeping). */}
      <Group title="Provoz">
        <DiskUsageCard usage={diskUsage} />
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
        <FeatureCard
          icon={BarChart3}
          title="Návštěvnost"
          status="ok"
          href="/admin/visitors"
          lines={[
            "GoatCounter — denní graf + top stránky",
            "7d / 30d / 365d / vše + země a prohlížeče",
          ]}
        />
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
          icon={Timer}
          title="Rotace na hlavní stránce"
          status="ok"
          href="/admin/settings"
          lines={[
            "Délky rotace lístečků, náhodného čtyřlístku",
            "a full-screen spořiče (v sekundách)",
          ]}
        />
      </Group>

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
            {recent.map((row, i) => {
              const isBatch = (row.batchCount ?? 1) > 1;
              return (
                <li
                  key={`${row.ts}-${i}`}
                  className="flex items-baseline gap-3 py-1.5 text-sm"
                >
                  <Clock
                    className="h-3.5 w-3.5 shrink-0 text-gray-400"
                    aria-hidden
                  />
                  <span className="font-mono text-xs tabular-nums text-gray-500">
                    {isBatch
                      ? `${formatActivityTs(row.batchEarliestTs!)}–${formatActivityTimeOnly(row.ts)}`
                      : formatActivityTs(row.ts)}
                  </span>
                  <span className="font-medium text-gray-900">{row.action}</span>
                  {isBatch && (
                    <span
                      className="inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800"
                      title={
                        row.batchScope
                          ? `Dávka ${row.batchCount} souborů (${row.batchScope})`
                          : `Dávka ${row.batchCount} souborů`
                      }
                    >
                      ×{row.batchCount}
                      {row.batchScope ? ` ${row.batchScope}` : ""}
                    </span>
                  )}
                  {row.credentialLabel && (
                    <span className="text-gray-600">{row.credentialLabel}</span>
                  )}
                  <span className="ml-auto font-mono text-xs text-gray-400">
                    {row.ip}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Section wrapper for the admin tile grid. Each call renders a small
 *  uppercase section title + a responsive grid of FeatureCard children.
 *  The page composes three such groups (Soubory sbírky / Strukturovaný
 *  obsah / Provoz) so the tiles read as themed clusters instead of one
 *  long undifferentiated wall. */
function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  status,
  syncNeeded = false,
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
  /** Soft amber pill rendered next to the title when set — for
   *  scopes whose data dir has changed since the last successful
   *  `pnpm sync`. Doesn't escalate to `warn` because a pending sync
   *  is a reminder, not a problem. */
  syncNeeded?: boolean;
  lines: string[];
  /** When set, the card becomes an interactive link to the section.
   *  TODO cards stay as static blocks — no destination yet. */
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            className={`h-4 w-4 shrink-0 ${status === "warn" ? "text-red-700" : "text-brand-600"}`}
            aria-hidden
          />
          <h3
            className={`truncate text-sm font-semibold ${status === "warn" ? "text-red-900" : "text-gray-900"}`}
          >
            {title}
          </h3>
          {syncNeeded && (
            <span
              title="Změny od posledního syncu — spusť sync"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-amber-500"
              />
              sync
            </span>
          )}
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

/** Compact byte size for the storage tile — GB once past ~1 GB, MB
 *  below that. cs-CZ formatting (admin is Czech-only). */
function formatDiskBytes(bytes: number): string {
  const gb = bytes / 1_073_741_824;
  if (gb >= 1) {
    return `${new Intl.NumberFormat("cs-CZ", {
      maximumFractionDigits: 1,
    }).format(gb)} GB`;
  }
  const mb = bytes / 1_048_576;
  return `${new Intl.NumberFormat("cs-CZ", {
    maximumFractionDigits: 0,
  }).format(mb)} MB`;
}

/** Storage tile for the Provoz group — disk usage with a graduated
 *  warning: green under 75 % used, amber 75–90 %, red at/above 90 %.
 *  Informational (no link); renders a usage bar + figures. */
function DiskUsageCard({ usage }: { usage: DiskUsage | null }) {
  if (!usage) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
          <h3 className="truncate text-sm font-semibold text-gray-900">
            Místo na disku
          </h3>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Údaj o disku není k dispozici.
        </p>
      </div>
    );
  }

  const pct = Math.round(usage.usedFraction * 100);
  const level: "ok" | "caution" | "critical" =
    usage.usedFraction >= 0.9
      ? "critical"
      : usage.usedFraction >= 0.75
        ? "caution"
        : "ok";

  const chrome =
    level === "critical"
      ? "border-red-300 bg-red-50"
      : level === "caution"
        ? "border-amber-300 bg-amber-50"
        : "border-gray-200 bg-white";
  const iconColor =
    level === "critical"
      ? "text-red-700"
      : level === "caution"
        ? "text-amber-700"
        : "text-brand-600";
  const titleColor =
    level === "critical"
      ? "text-red-900"
      : level === "caution"
        ? "text-amber-900"
        : "text-gray-900";
  const textColor =
    level === "critical"
      ? "text-red-900"
      : level === "caution"
        ? "text-amber-900"
        : "text-gray-600";
  const barColor =
    level === "critical"
      ? "bg-red-500"
      : level === "caution"
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${chrome}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <HardDrive className={`h-4 w-4 shrink-0 ${iconColor}`} aria-hidden />
          <h3 className={`truncate text-sm font-semibold ${titleColor}`}>
            Místo na disku
          </h3>
        </div>
        {level === "ok" ? (
          <CheckCircle2
            className="h-4 w-4 text-emerald-500"
            aria-label="dostatek místa"
          />
        ) : (
          <AlertTriangle
            className={`h-4 w-4 ${level === "critical" ? "text-red-600" : "text-amber-600"}`}
            aria-label="málo místa"
          />
        )}
      </div>
      <div
        className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-gray-200"
        role="img"
        aria-label={`Obsazeno ${pct} %`}
      >
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
        />
      </div>
      <ul className={`mt-2 space-y-0.5 text-xs ${textColor}`}>
        <li>
          Obsazeno {formatDiskBytes(usage.usedBytes)} z{" "}
          {formatDiskBytes(usage.totalBytes)} ({pct} %)
        </li>
        <li>Zbývá {formatDiskBytes(usage.freeBytes)} volných</li>
        {level === "critical" && (
          <li className="font-medium">
            Kriticky málo místa — ukliď nebo rozšiř disk.
          </li>
        )}
        {level === "caution" && (
          <li className="font-medium">Místo dochází — sleduj kapacitu.</li>
        )}
      </ul>
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
