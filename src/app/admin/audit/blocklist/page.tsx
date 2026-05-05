import {
  AlertTriangle,
  Ban,
  ChevronDown,
  Download,
  FileWarning,
  Flag,
  Lock,
  ShieldX,
} from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import {
  describeCategories,
  loadAbuseIpdbSummary,
  type AbuseIpdbSummary,
} from "@/lib/admin/abuseipdb";
import {
  loadPermabanSnapshot,
  type PermabanSnapshot,
} from "@/lib/admin/permaban";
import {
  aggregateByIp,
  computePermabanCandidates,
  computeStats,
  DEFAULT_PERMABAN_THRESHOLD,
  DEFAULT_PERMABAN_WINDOW_DAYS,
  NGINX_PERMABAN_JAIL,
  readBlocklistLog,
  renderNginxDenyConfig,
  type BlocklistEntry,
  type BlocklistReadResult,
  type IpAggregate,
  type PermabanCandidate,
} from "@/lib/admin/blocklist";
import { AuditSubNav } from "../_subnav";
import { ExportButtonRow } from "./_export-button-row";

export const dynamic = "force-dynamic";

const RECENT_DEFAULT = 50;
const IPS_DEFAULT_LIMIT = 100;

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function pickPositiveInt(
  v: string | string[] | undefined,
  fallback: number,
  max?: number,
): number {
  const raw = pickString(v);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return max ? Math.min(n, max) : n;
}

export default async function AdminAuditBlocklistPage({
  searchParams,
}: PageProps) {
  await ensureAdminAuth();
  const sp = await searchParams;

  const recentLimit = pickPositiveInt(sp.recent, RECENT_DEFAULT, 500);
  const ipsLimit = pickPositiveInt(sp.limit, IPS_DEFAULT_LIMIT, 2000);
  const threshold = pickPositiveInt(sp.threshold, DEFAULT_PERMABAN_THRESHOLD);
  const windowDays = pickPositiveInt(
    sp.window,
    DEFAULT_PERMABAN_WINDOW_DAYS,
  );
  const jail = pickString(sp.jail) ?? NGINX_PERMABAN_JAIL;

  const data = await readBlocklistLog();

  return (
    <div className="space-y-4">
      <AuditSubNav active="blocklist" />

      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <ShieldX className="h-5 w-5 text-brand-600" aria-hidden />
          Fail2ban blocklist
        </h1>
        <p className="text-sm text-gray-500">
          Statistiky a exporty nad <code>{data.path}</code>. Webapp jen čte;
          permaban list (nginx <code>deny</code>) nikdy nezapisuje do{" "}
          <code>/etc/nginx/</code> — vygenerovaný <code>.conf</code> stáhni a
          aplikuj přes <code>sudo blocklist-tools.sh nginx-deny</code> z
          Termiusu.
        </p>
      </header>

      {data.entries === null ? (
        <PermissionHint result={data} />
      ) : (
        <ReadyView
          entries={data.entries}
          mtime={data.mtime}
          size={data.size}
          path={data.path}
          recentLimit={recentLimit}
          ipsLimit={ipsLimit}
          threshold={threshold}
          windowDays={windowDays}
          jail={jail}
          abuseIpdb={await loadAbuseIpdbSummary(data.entries)}
          permaban={await loadPermabanSnapshot()}
        />
      )}
    </div>
  );
}

function PermissionHint({ result }: { result: BlocklistReadResult }) {
  if (result.error === "missing") {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
        <p className="font-medium text-gray-900">Log soubor neexistuje</p>
        <p className="mt-1">
          <code>{result.path}</code> zatím neexistuje. fail2ban ještě nikoho
          nebanoval, nebo blocklist akce není aktivní. Zkontroluj{" "}
          <code>/etc/fail2ban/action.d/</code> a status fail2ban-clientu.
        </p>
      </div>
    );
  }
  if (result.error === "permission") {
    return (
      <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-2">
          <FileWarning
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
            aria-hidden
          />
          <div>
            <p className="font-medium">
              Webapp nemůže log přečíst (Permission denied)
            </p>
            <p className="mt-0.5 text-xs text-amber-800/90">
              Soubor <code>{result.path}</code> není přístupný uživateli, pod
              kterým běží Next.js. Nastav ACL v Termiusu (jednorázově) — drží
              i přes log-rotate.
            </p>
          </div>
        </div>
        <pre className="overflow-x-auto rounded-md border border-amber-300 bg-amber-100/60 p-2 font-mono text-[11px] leading-relaxed text-amber-950">
{`# Zjisti, pod jakým uživatelem běží PM2:
ps -o user= -p $(pgrep -f 'next-server' | head -1)

# Dej tomu uživateli read právo na log + adresář:
sudo setfacl -m u:NODE_USER:r ${result.path}
sudo setfacl -m u:NODE_USER:rx $(dirname ${result.path})

# Aby ACL přežilo logrotate, přidej do logrotate snippetu:
#   create 644 root adm
# nebo:
#   postrotate
#       setfacl -m u:NODE_USER:r ${result.path}
#   endscript`}
        </pre>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <p className="font-medium">Log se nepodařilo načíst (I/O chyba)</p>
      <p className="mt-1">
        Cesta: <code>{result.path}</code>. Zkus zopakovat; pokud chyba
        přetrvává, mrkni do <code>journalctl -u fail2ban</code>.
      </p>
    </div>
  );
}

interface ReadyViewProps {
  entries: BlocklistEntry[];
  mtime: string | null;
  size: number | null;
  path: string;
  recentLimit: number;
  ipsLimit: number;
  threshold: number;
  windowDays: number;
  jail: string;
  abuseIpdb: AbuseIpdbSummary;
  permaban: PermabanSnapshot;
}

function ReadyView({
  entries,
  mtime,
  size,
  path,
  recentLimit,
  ipsLimit,
  threshold,
  windowDays,
  jail,
  abuseIpdb,
  permaban,
}: ReadyViewProps) {
  const stats = computeStats(entries);
  const aggregates = aggregateByIp(entries);
  const visibleAggregates = aggregates.slice(0, ipsLimit);
  const recent = entries.slice(-recentLimit).reverse();
  const permabanWhatIf = computePermabanCandidates(entries, {
    threshold,
    windowDays,
    jail,
  });
  const permabanPreview = renderNginxDenyConfig(permabanWhatIf, {
    sourcePath: path,
  });

  return (
    <>
      <SourceMeta mtime={mtime} size={size} path={path} />
      <StatsBlock stats={stats} />
      <TopLists
        topJails={stats.topJails}
        topIps={stats.topIps}
        totalIps={stats.uniqueIps}
      />
      <PermabanLivePanel snapshot={permaban} />
      <AbuseIpdbPanel summary={abuseIpdb} />
      <PermabanWhatIfPanel
        threshold={threshold}
        windowDays={windowDays}
        jail={jail}
        candidates={permabanWhatIf.candidates}
        preview={permabanPreview}
      />
      <RecentTable rows={recent} limit={recentLimit} total={entries.length} />
      <IpsTable
        rows={visibleAggregates}
        totalRows={aggregates.length}
        limit={ipsLimit}
      />
      <ExportRow
        threshold={threshold}
        windowDays={windowDays}
        jail={jail}
      />
    </>
  );
}

/** Native disclosure for long IP / ban tables — uses <details> so it
 *  works without client JS and respects ESC / Tab semantics. The
 *  chevron rotation is purely cosmetic; older browsers without :open
 *  support fall back to a static down-arrow with no behavioural
 *  impact. */
function CollapsibleSection({
  title,
  count,
  hint,
  defaultOpen = false,
  exports,
  children,
}: {
  title: string;
  count?: string;
  hint?: string;
  defaultOpen?: boolean;
  /** Optional download links rendered next to the disclosure chevron.
   *  Click stops propagation so it doesn't toggle the <details> open
   *  state — operators can grab a CSV without re-collapsing the panel. */
  exports?: ReadonlyArray<{ href: string; label: string; ext: string }>;
  children: React.ReactNode;
}) {
  return (
    <details
      className="group overflow-hidden rounded-xl border border-gray-200 bg-white"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">
            {title}
            {count !== undefined && (
              <span className="ml-2 text-xs font-normal text-gray-500">
                {count}
              </span>
            )}
          </h2>
          {hint && (
            <p className="mt-0.5 text-[11px] text-gray-500">{hint}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {exports && exports.length > 0 && (
            <ExportButtonRow items={exports} />
          )}
          <ChevronDown
            className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180"
            aria-hidden
          />
        </div>
      </summary>
      <div className="border-t border-gray-200">{children}</div>
    </details>
  );
}


function PermabanLivePanel({ snapshot }: { snapshot: PermabanSnapshot }) {
  const denyCount = snapshot.deny.deniedIps.length;
  const lastRefreshLine = snapshot.refreshLog.recentLines.at(-1) ?? null;
  return (
    <section className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Lock className="h-4 w-4 text-emerald-700" aria-hidden />
          Live permaban list (nginx deny)
        </h2>
        <span className="text-[11px] text-gray-500">
          file: <code>{snapshot.paths.deny}</code>
        </span>
      </header>

      <p className="text-[11px] leading-relaxed text-gray-600">
        Hybridní permaban. <strong>fail2ban action</strong>{" "}
        (<code>permaban-nginx</code>) appendne každý ban z reportable jailů
        (nginx-noscript, sshd, sshd-logger) do <code>permaban-list.conf</code>{" "}
        a debouncovaně reloadne nginx. <strong>Denní cron</strong>{" "}
        (<code>blocklist-tools.sh nginx-deny --apply</code> v 04:30) ho
        rebuilduje z celého TSV jako self-healing pojistka. Whitelist + RFC
        1918/5737/3849 rozsahy se filtrují vždy; snapshot předchozího
        souboru padá do <code>{snapshot.paths.backupDir}</code> (auto-prune
        po 30 dnech).
      </p>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Aktuálně permabanováno"
          value={
            snapshot.deny.error === null
              ? denyCount.toLocaleString("cs-CZ")
              : "?"
          }
        />
        <Stat
          label="Whitelist"
          value={
            snapshot.whitelist.error === null
              ? snapshot.whitelist.ips.length.toLocaleString("cs-CZ")
              : "?"
          }
        />
        <Stat
          label="Snapshotů zálohy"
          value={
            snapshot.backups.error === null
              ? snapshot.backups.count.toLocaleString("cs-CZ")
              : "?"
          }
        />
        <Stat
          label="Real-time událostí (log)"
          value={snapshot.realtimeLog.events.length.toLocaleString("cs-CZ")}
        />
      </ul>

      <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-md border border-gray-200 bg-white p-2">
          <dt className="text-[10px] uppercase tracking-wide text-gray-400">
            Deny soubor — změněn
          </dt>
          <dd className="mt-0.5 font-mono tabular-nums text-gray-800">
            {snapshot.deny.mtime
              ? formatDateTime(snapshot.deny.mtime)
              : "—"}
            {snapshot.deny.size !== null && (
              <span className="ml-2 text-gray-500">
                ({snapshot.deny.size.toLocaleString("cs-CZ")} B)
              </span>
            )}
          </dd>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-2">
          <dt className="text-[10px] uppercase tracking-wide text-gray-400">
            Poslední cron rebuild
          </dt>
          <dd
            className="mt-0.5 truncate font-mono text-gray-800"
            title={lastRefreshLine ?? ""}
          >
            {lastRefreshLine ?? "—"}
          </dd>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-2">
          <dt className="text-[10px] uppercase tracking-wide text-gray-400">
            Cron file / skript
          </dt>
          <dd className="mt-0.5 text-gray-700">
            <code>/etc/cron.d/permaban-refresh</code> →{" "}
            <code>blocklist-tools.sh nginx-deny --apply</code>
          </dd>
        </div>
      </dl>

      {(snapshot.deny.error ||
        snapshot.whitelist.error ||
        snapshot.refreshLog.error ||
        snapshot.realtimeLog.error ||
        snapshot.backups.error) && (
        <PermabanFileHints snapshot={snapshot} />
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <CollapsibleSection
          title="Whitelist"
          count={`${snapshot.whitelist.ips.length} IP`}
          hint="IP, které se nikdy nesmí dostat do deny listu."
          defaultOpen
          exports={[
            {
              href: "/api/admin/blocklist/export?kind=whitelist&format=txt",
              ext: "txt",
              label: "Stáhnout whitelist jako prostý text (1 IP / řádek)",
            },
            {
              href: "/api/admin/blocklist/export?kind=whitelist&format=json",
              ext: "json",
              label: "Stáhnout whitelist jako JSON",
            },
          ]}
        >
          {snapshot.whitelist.ips.length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-500">
              Whitelist je prázdný nebo soubor neexistuje. Synchronizuj se{" "}
              <code>{snapshot.paths.whitelist}</code>.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 text-xs">
              {snapshot.whitelist.ips.map((ip) => (
                <li
                  key={ip}
                  className="px-4 py-1.5 font-mono tabular-nums text-gray-800"
                >
                  {ip}
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Posledních 5 backup snapshotů"
          count={`${snapshot.backups.count} celkem`}
          defaultOpen={false}
        >
          {snapshot.backups.recent.length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-500">
              Žádné snapshoty. Zatím neproběhl žádný rebuild, který by{" "}
              změnil obsah deny listu (jinak by skript snapshotnul původní
              stav).
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 text-xs">
              {snapshot.backups.recent.slice(0, 5).map((b) => (
                <li
                  key={b.name}
                  className="flex items-center justify-between gap-3 px-4 py-1.5"
                >
                  <span className="truncate font-mono text-gray-800" title={b.name}>
                    {b.name}
                  </span>
                  <span className="font-mono tabular-nums text-gray-500">
                    {formatDateTime(b.mtime)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>
      </div>

      {snapshot.realtimeLog.events.length > 0 && (
        <CollapsibleSection
          title="Real-time log událostí"
          count={`posledních ${snapshot.realtimeLog.events.length}`}
          hint="Z /var/log/permaban-nginx.log — append akce z fail2ban chainu."
        >
          <ul className="divide-y divide-gray-100 font-mono text-[11px] leading-snug">
            {snapshot.realtimeLog.events.map((e, i) => (
              <li
                key={`${e.ts}-${i}`}
                className="flex gap-3 px-3 py-1"
                title={e.message}
              >
                <span className="shrink-0 text-gray-500">
                  {formatDateTime(e.ts)}
                </span>
                <span
                  className={`min-w-0 flex-1 ${
                    e.kind === "added"
                      ? "text-emerald-700"
                      : e.kind === "skip"
                        ? "text-gray-500"
                        : e.kind === "error"
                          ? "text-red-700"
                          : "text-gray-700"
                  }`}
                >
                  {e.message}
                </span>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {snapshot.refreshLog.recentLines.length > 0 && (
        <CollapsibleSection
          title="Posledních 20 řádků cron rebuild logu"
          hint="Z /var/log/permaban-refresh.log — výstup denního blocklist-tools.sh."
        >
          <pre className="max-h-72 overflow-auto bg-gray-900 px-3 py-2 text-[11px] leading-snug text-gray-100">
            {snapshot.refreshLog.recentLines.join("\n")}
          </pre>
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title="Všechny aktuálně blokované IP"
        count={`${denyCount} celkem`}
        hint="Obsah permaban-list.conf — každý řádek = `deny <ip>;`."
        exports={[
          {
            href: "/api/admin/blocklist/export?kind=denied&format=txt",
            ext: "txt",
            label: "Stáhnout aktuálně blokované IP jako prostý text",
          },
          {
            href: "/api/admin/blocklist/export?kind=denied&format=csv",
            ext: "csv",
            label: "Stáhnout aktuálně blokované IP jako CSV",
          },
          {
            href: "/api/admin/blocklist/export?kind=denied&format=json",
            ext: "json",
            label: "Stáhnout aktuálně blokované IP jako JSON",
          },
        ]}
      >
        {denyCount === 0 ? (
          <p className="px-4 py-3 text-xs text-gray-500">
            Deny list je prázdný (nebo soubor není čitelný — viz hint výše).
          </p>
        ) : (
          <div className="max-h-96 overflow-auto">
            <ul className="divide-y divide-gray-100 text-xs">
              {snapshot.deny.deniedIps.map((ip) => (
                <li
                  key={ip}
                  className="px-4 py-1 font-mono tabular-nums text-gray-800"
                >
                  {ip}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CollapsibleSection>
    </section>
  );
}

function PermabanFileHints({ snapshot }: { snapshot: PermabanSnapshot }) {
  interface Item {
    label: string;
    path: string;
    error: string;
    /** Adresáře potřebují pro Next.js read právo navíc execute (rx)
     *  + default ACL ať noví obyvatelé (rotace, snapshoty) zdědí
     *  read pro stejného uživatele. */
    isDir: boolean;
    /** Které kroky `pnpm sync` / cron akce ten soubor vytvoří —
     *  manualní run zkratka pro operatera. */
    createsWith?: string;
  }
  const items: Item[] = [];
  if (snapshot.deny.error)
    items.push({
      label: "Deny list",
      path: snapshot.paths.deny,
      error: snapshot.deny.error,
      isDir: false,
      createsWith:
        "fail2ban action permaban-nginx (při prvním banu) nebo denní cron",
    });
  if (snapshot.whitelist.error)
    items.push({
      label: "Whitelist",
      path: snapshot.paths.whitelist,
      error: snapshot.whitelist.error,
      isDir: false,
      createsWith: "ručně přes `sudo cp deploy/permaban-whitelist.conf …`",
    });
  if (snapshot.refreshLog.error)
    items.push({
      label: "Cron log",
      path: snapshot.paths.refreshLog,
      error: snapshot.refreshLog.error,
      isDir: false,
      createsWith:
        "denní cron 04:30, nebo manuálně `sudo /usr/local/sbin/blocklist-tools.sh nginx-deny --apply >> /var/log/permaban-refresh.log 2>&1`",
    });
  if (snapshot.realtimeLog.error)
    items.push({
      label: "Real-time log",
      path: snapshot.paths.realtimeLog,
      error: snapshot.realtimeLog.error,
      isDir: false,
      createsWith:
        "fail2ban action permaban-nginx při prvním banu (resp. testem ze setupu)",
    });
  if (snapshot.backups.error)
    items.push({
      label: "Backup dir",
      path: snapshot.paths.backupDir,
      error: snapshot.backups.error,
      isDir: true,
      createsWith:
        "blocklist-tools.sh při prvním rebuildu (chmod 750 root:root)",
    });
  if (items.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="font-medium">Některé soubory nelze načíst</p>
      <p className="text-[11px] leading-snug">
        Nahraď <code>NODE_USER</code> uživatelem, pod kterým běží Next.js
        (z PM2 typicky <code>app</code>) — zjistíš{" "}
        <code>ps -o user= -p $(pgrep -f next-server | head -1)</code>.
      </p>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it.path} className="space-y-0.5">
            <div>
              <strong>{it.label}</strong> — <code>{it.path}</code> (
              {it.error}).
            </div>
            {it.error === "permission" ? (
              <pre className="overflow-x-auto rounded bg-amber-100/60 px-2 py-1 font-mono text-[11px]">
                {it.isDir
                  ? `sudo setfacl -m u:NODE_USER:rx ${it.path}\nsudo setfacl -d -m u:NODE_USER:r ${it.path}\nsudo setfacl -m u:NODE_USER:r ${it.path}/*.conf 2>/dev/null || true`
                  : `sudo setfacl -m u:NODE_USER:r ${it.path}`}
              </pre>
            ) : it.error === "missing" ? (
              <div className="text-[11px] text-amber-800">
                Soubor zatím neexistuje. Vznikne přes:{" "}
                <em>{it.createsWith ?? "—"}</em>
                {it.createsWith?.includes("cron") && (
                  <>
                    {" "}— pak ještě{" "}
                    <code>sudo setfacl -m u:NODE_USER:r {it.path}</code>.
                  </>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-amber-800">
                I/O chyba — mrkni do <code>journalctl</code> a do{" "}
                <code>dmesg</code>, jestli není problém s diskem.
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AbuseIpdbPanel({ summary }: { summary: AbuseIpdbSummary }) {
  const reportedCount = summary.reportedIps.length;
  const reportedBans = summary.reportedIps.reduce(
    (acc, r) => acc + r.count,
    0,
  );
  const tsLabel =
    summary.lastTimestampSource === "state"
      ? "ze state souboru"
      : summary.lastTimestampSource === "log"
        ? "odvozeno z logu"
        : "neznámý";
  // Only escalate to a warning when we genuinely couldn't compute the
  // cutoff. State-file permission errors are downgraded to a footnote
  // when the log already gave us a usable NewState= value.
  const lostSignal = summary.lastTimestamp === null;
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Flag className="h-4 w-4 text-brand-600" aria-hidden />
          AbuseIPDB reporty
        </h2>
        <span className="text-[11px] text-gray-500">
          stav: <code>{summary.statePath}</code> · log:{" "}
          <code>{summary.logPath}</code>
        </span>
      </header>

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Nahlášených IP"
          value={reportedCount.toLocaleString("cs-CZ")}
        />
        <Stat
          label="Z toho banů"
          value={reportedBans.toLocaleString("cs-CZ")}
        />
        <Stat
          label="Akceptováno API"
          value={summary.totalSaved.toLocaleString("cs-CZ")}
        />
        <Stat
          label="Odmítnuto API"
          value={summary.totalInvalid.toLocaleString("cs-CZ")}
        />
      </ul>

      <p className="rounded-md border border-gray-200 bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-600">
        <strong className="text-gray-800">Akceptováno API</strong> = kolik
        reportů AbuseIPDB přijalo do své DB. <strong className="text-gray-800">
          Odmítnuto API
        </strong>{" "}
        = kolik vrátilo jako <code>invalidReports</code> — typicky proto, že{" "}
        <em>tatáž IP byla tímto účtem nahlášená příliš nedávno</em>{" "}
        (AbuseIPDB má per-account cooldown ~15 min na IP), nebo malformed
        payload. Skript sám per-IP nededuplikuje, jen filtruje podle
        timestampu (neodešle stejný TSV řádek dvakrát) — takže IP zabanovaná
        opakovaně v různých dnech se reportuje pokaždé a duplicity dořeší
        AbuseIPDB.
      </p>

      <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
          <dt className="text-[10px] uppercase tracking-wide text-gray-400">
            Poslední state TS ({tsLabel})
          </dt>
          <dd className="mt-0.5 font-mono tabular-nums text-gray-800">
            {summary.lastTimestamp
              ? formatDateTime(summary.lastTimestamp)
              : "—"}
          </dd>
        </div>
        <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
          <dt className="text-[10px] uppercase tracking-wide text-gray-400">
            Pending IP (čekají na další běh)
          </dt>
          <dd className="mt-0.5 font-mono tabular-nums text-gray-800">
            {summary.pendingIps.length.toLocaleString("cs-CZ")} IP /{" "}
            {summary.pendingCount.toLocaleString("cs-CZ")} banů
          </dd>
        </div>
        <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
          <dt className="text-[10px] uppercase tracking-wide text-gray-400">
            Cron — viz <code>/etc/cron.d/abuseipdb-report</code>
          </dt>
          <dd className="mt-0.5 text-gray-700">
            Skript: <code>/usr/local/sbin/abuseipdb-report.sh</code>
          </dd>
        </div>
      </dl>

      {summary.lastTimestampMismatch && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          State soubor a poslední <code>NewState=</code> v logu se neshodují
          ({formatDateTime(summary.lastTimestamp ?? "")}). Buď proběhla
          rotace logu, nebo někdo state přepsal ručně — zkontroluj{" "}
          <code>journalctl -u cron</code>.
        </p>
      )}

      {lostSignal && (summary.stateError || summary.logError) && (
        <AbuseFileHints summary={summary} />
      )}
      {!lostSignal && summary.stateError === "permission" && (
        <p className="text-[11px] text-gray-500">
          State soubor není čitelný (700 dir od skriptu) — počítám cutoff z
          logu, ať to neblokuje. Pokud chceš state přečíst i z webu:{" "}
          <code>
            sudo setfacl -m u:NODE_USER:rx{" "}
            {summary.statePath.replace(/\/[^/]+$/, "")}
          </code>{" "}
          + <code>sudo setfacl -m u:NODE_USER:r {summary.statePath}</code>.
        </p>
      )}

      {summary.recentLog.length > 0 && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Posledních {summary.recentLog.length} log řádků
          </h3>
          <div className="max-h-48 overflow-auto rounded-md border border-gray-200 bg-gray-900">
            <ul className="divide-y divide-gray-800 font-mono text-[11px] leading-snug text-gray-100">
              {summary.recentLog.map((line, i) => (
                <li
                  key={`${line.ts}-${i}`}
                  className="flex gap-3 px-2 py-1"
                  title={line.message}
                >
                  <span className="shrink-0 text-gray-500">
                    {formatDateTime(line.ts)}
                  </span>
                  <span
                    className={
                      line.kind === "error"
                        ? "text-red-300"
                        : line.kind === "report"
                          ? "text-emerald-300"
                          : "text-gray-300"
                    }
                  >
                    {line.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {reportedCount > 0 ? (
        <CollapsibleSection
          title="Nahlášené IP — detail"
          count={`${reportedCount} IP / ${reportedBans} banů`}
          hint="Aggregace TSV řádků s ts ≤ poslední state TS, mapování jail → AbuseIPDB kategorie."
          exports={[
            {
              href: "/api/admin/blocklist/export?kind=abuseipdb&format=tsv",
              ext: "tsv",
              label: "Stáhnout AbuseIPDB reporty jako TSV",
            },
            {
              href: "/api/admin/blocklist/export?kind=abuseipdb&format=csv",
              ext: "csv",
              label: "Stáhnout AbuseIPDB reporty jako CSV",
            },
            {
              href: "/api/admin/blocklist/export?kind=abuseipdb&format=json",
              ext: "json",
              label: "Stáhnout AbuseIPDB reporty jako JSON",
            },
          ]}
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">IP</th>
                  <th className="px-3 py-2 font-medium">Banů</th>
                  <th className="px-3 py-2 font-medium">První</th>
                  <th className="px-3 py-2 font-medium">Naposledy</th>
                  <th className="px-3 py-2 font-medium">Jails</th>
                  <th className="px-3 py-2 font-medium">Kategorie</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summary.reportedIps.map((r) => (
                  <tr key={r.ip} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-gray-800">
                      {r.ip}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-gray-700">
                      {r.count.toLocaleString("cs-CZ")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-gray-500">
                      {formatDateTime(r.firstSeen)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-gray-500">
                      {formatDateTime(r.lastSeen)}
                    </td>
                    <td className="px-3 py-1.5 text-gray-700">
                      {r.jails.join(", ")}
                    </td>
                    <td
                      className="px-3 py-1.5 text-gray-700"
                      title={`AbuseIPDB categories: ${r.categories}`}
                    >
                      <span className="font-mono text-gray-500">
                        {r.categories}
                      </span>{" "}
                      <span className="text-gray-700">
                        {describeCategories(r.categories)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>
      ) : (
        <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-500">
          {lostSignal
            ? "State ani log se nepodařilo načíst — bez nich nejde určit, které řádky TSV už byly nahlášeny. Mrkni na hint výš."
            : "Žádné nahlášené IP zatím nejsou. Po prvním cron tiknutí se sem vyplní seznam."}
        </p>
      )}
    </section>
  );
}

function AbuseFileHints({ summary }: { summary: AbuseIpdbSummary }) {
  const items: { label: string; path: string; error: string }[] = [];
  if (summary.stateError) {
    items.push({
      label: "State",
      path: summary.statePath,
      error: summary.stateError,
    });
  }
  if (summary.logError) {
    items.push({
      label: "Log",
      path: summary.logPath,
      error: summary.logError,
    });
  }
  if (items.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="font-medium">Soubory nelze načíst</p>
      <ul className="space-y-0.5">
        {items.map((it) => (
          <li key={it.path}>
            <strong>{it.label}</strong> — <code>{it.path}</code> ({it.error}
            ). Pravděpodobně potřebuje setfacl: <code>{it.error === "permission"
              ? `sudo setfacl -m u:NODE_USER:r ${it.path}`
              : `Soubor zatím neexistuje — počkej na první cron běh.`}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceMeta({
  mtime,
  size,
  path,
}: {
  mtime: string | null;
  size: number | null;
  path: string;
}) {
  return (
    <dl className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 bg-white p-3 text-xs sm:grid-cols-3">
      <div>
        <dt className="text-gray-400">Cesta</dt>
        <dd className="break-all font-mono text-gray-700">{path}</dd>
      </div>
      <div>
        <dt className="text-gray-400">Velikost</dt>
        <dd className="font-mono tabular-nums text-gray-700">
          {size !== null ? `${size.toLocaleString("cs-CZ")} B` : "—"}
        </dd>
      </div>
      <div>
        <dt className="text-gray-400">Změněno</dt>
        <dd className="font-mono tabular-nums text-gray-700">
          {mtime
            ? new Date(mtime).toLocaleString("cs-CZ", {
                timeZone: "Europe/Prague",
              })
            : "—"}
        </dd>
      </div>
    </dl>
  );
}

function StatsBlock({
  stats,
}: {
  stats: ReturnType<typeof computeStats>;
}) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat
        label="Banů celkem"
        value={stats.totalBans.toLocaleString("cs-CZ")}
      />
      <Stat
        label="Unikátních IP"
        value={stats.uniqueIps.toLocaleString("cs-CZ")}
      />
      <Stat
        label="Jails"
        value={stats.uniqueJails.toLocaleString("cs-CZ")}
      />
      <Stat
        label="Rozsah"
        value={
          stats.firstTs && stats.lastTs
            ? `${formatDate(stats.firstTs)} – ${formatDate(stats.lastTs)}`
            : "—"
        }
        small
      />
    </ul>
  );
}

function Stat({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p
        className={`mt-1 font-mono tabular-nums text-gray-900 ${
          small ? "text-xs" : "text-lg font-semibold"
        }`}
      >
        {value}
      </p>
    </li>
  );
}

function TopLists({
  topJails,
  topIps,
  totalIps,
}: {
  topJails: Array<{ key: string; count: number }>;
  topIps: Array<{ key: string; count: number }>;
  totalIps: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <RankedList title="TOP 10 jails" items={topJails} valueLabel="banů" />
      <RankedList
        title={`TOP 10 IP (z ${totalIps.toLocaleString("cs-CZ")})`}
        items={topIps}
        valueLabel="banů"
        mono
      />
    </div>
  );
}

function RankedList({
  title,
  items,
  valueLabel,
  mono,
}: {
  title: string;
  items: Array<{ key: string; count: number }>;
  valueLabel: string;
  mono?: boolean;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">žádná data</p>
      ) : (
        <ol className="space-y-1 text-xs">
          {items.map((item, i) => (
            <li
              key={item.key}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-5 text-right font-mono tabular-nums text-gray-400">
                  {i + 1}.
                </span>
                <span
                  className={`truncate ${mono ? "font-mono" : ""} text-gray-800`}
                  title={item.key}
                >
                  {item.key}
                </span>
              </span>
              <span className="font-mono tabular-nums text-gray-700">
                {item.count.toLocaleString("cs-CZ")} {valueLabel}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PermabanWhatIfPanel({
  threshold,
  windowDays,
  jail,
  candidates,
  preview,
}: {
  threshold: number;
  windowDays: number;
  jail: string;
  candidates: PermabanCandidate[];
  preview: string;
}) {
  return (
    <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Ban className="h-4 w-4 text-brand-600" aria-hidden />
          Permaban what-if (alternativní práh)
        </h2>
        <span className="text-[11px] text-gray-500">
          {candidates.length.toLocaleString("cs-CZ")} IP by spadlo pod tento
          filtr
        </span>
      </header>
      <p className="text-[11px] text-gray-500">
        Live deny list běží s default parametrem (každý ban → permaban). Tahle
        sekce slouží jen jako simulace — &bdquo;co kdybych dal threshold=N
        pro jeden konkrétní jail?&ldquo; Stažený <code>.conf</code> nahradí
        live list, který drží denní cron — radši ho aplikuj jen pokud víš,
        proč to děláš.
      </p>
      <form
        method="get"
        className="flex flex-wrap items-end gap-2 text-xs text-gray-700"
      >
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-gray-400">
            Práh (počet banů)
          </span>
          <input
            type="number"
            name="threshold"
            defaultValue={threshold}
            min={1}
            className="mt-0.5 w-24 rounded-md border border-gray-300 px-2 py-1 font-mono tabular-nums"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-gray-400">
            Okno (dnů)
          </span>
          <input
            type="number"
            name="window"
            defaultValue={windowDays}
            min={1}
            className="mt-0.5 w-24 rounded-md border border-gray-300 px-2 py-1 font-mono tabular-nums"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-gray-400">
            Jail
          </span>
          <input
            type="text"
            name="jail"
            defaultValue={jail}
            className="mt-0.5 w-44 rounded-md border border-gray-300 px-2 py-1 font-mono"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-brand-300 bg-brand-50 px-3 py-1 font-medium text-brand-800 hover:border-brand-400 hover:bg-brand-100"
        >
          Přepočítat
        </button>
        <a
          href={`/api/admin/blocklist/export?kind=permaban&threshold=${threshold}&window=${windowDays}&jail=${encodeURIComponent(
            jail,
          )}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1 font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50"
          download
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Stáhnout .conf
        </a>
      </form>

      {candidates.length > 0 ? (
        <pre className="max-h-72 overflow-auto rounded-md border border-gray-200 bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">
          {preview}
        </pre>
      ) : (
        <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-500">
          Žádná IP nepřekročila práh ({threshold}× v posledních {windowDays}{" "}
          dnech, jail <code>{jail}</code>).
        </p>
      )}
    </section>
  );
}

function RecentTable({
  rows,
  limit,
  total,
}: {
  rows: BlocklistEntry[];
  limit: number;
  total: number;
}) {
  return (
    <CollapsibleSection
      title={`Posledních ${Math.min(limit, rows.length).toLocaleString("cs-CZ")} banů`}
      count={`z celkem ${total.toLocaleString("cs-CZ")}`}
      exports={[
        {
          href: `/api/admin/blocklist/export?kind=recent&format=tsv&limit=${limit}`,
          ext: "tsv",
          label: `Stáhnout posledních ${limit} banů jako TSV`,
        },
        {
          href: `/api/admin/blocklist/export?kind=recent&format=csv&limit=${limit}`,
          ext: "csv",
          label: `Stáhnout posledních ${limit} banů jako CSV`,
        },
        {
          href: `/api/admin/blocklist/export?kind=recent&format=json&limit=${limit}`,
          ext: "json",
          label: `Stáhnout posledních ${limit} banů jako JSON`,
        },
      ]}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Čas
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                IP
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Jail
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Důvod
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => (
              <tr key={`${r.ts}-${i}`} className="text-xs">
                <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-gray-500">
                  {formatDateTime(r.ts)}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-gray-800">
                  {r.ip}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-gray-700">
                  {r.jail}
                </td>
                <td className="px-3 py-1.5 text-gray-500" title={r.reason}>
                  {r.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

function IpsTable({
  rows,
  totalRows,
  limit,
}: {
  rows: IpAggregate[];
  totalRows: number;
  limit: number;
}) {
  return (
    <CollapsibleSection
      title="Všechny IP podle počtu banů"
      count={`zobrazeno ${rows.length.toLocaleString("cs-CZ")} z ${totalRows.toLocaleString("cs-CZ")} (limit ${limit})`}
      exports={[
        {
          href: "/api/admin/blocklist/export?kind=ips&format=tsv",
          ext: "tsv",
          label: "Stáhnout IP agregát jako TSV (všechny řádky)",
        },
        {
          href: "/api/admin/blocklist/export?kind=ips&format=csv",
          ext: "csv",
          label: "Stáhnout IP agregát jako CSV (všechny řádky)",
        },
        {
          href: "/api/admin/blocklist/export?kind=ips&format=json",
          ext: "json",
          label: "Stáhnout IP agregát jako JSON (všechny řádky)",
        },
      ]}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                IP
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Banů
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                První
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Naposledy
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Jails
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.ip}>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-gray-800">
                  {r.ip}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-gray-700">
                  {r.count.toLocaleString("cs-CZ")}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-gray-500">
                  {formatDateTime(r.firstSeen)}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-gray-500">
                  {formatDateTime(r.lastSeen)}
                </td>
                <td className="px-3 py-1.5 text-gray-700">
                  {r.jails.join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

function ExportRow({
  threshold,
  windowDays,
  jail,
}: {
  threshold: number;
  windowDays: number;
  jail: string;
}) {
  const items: Array<{ href: string; label: string; hint: string }> = [
    {
      href: "/api/admin/blocklist/export?kind=raw",
      label: "Stáhnout celý log (.tsv)",
      hint: "1:1 kopie /var/log/fail2ban-blocklist.tsv",
    },
    {
      href: "/api/admin/blocklist/export?kind=ips&format=tsv",
      label: "IP + počty (.tsv)",
      hint: "agregát: IP, banů, první/poslední, jails",
    },
    {
      href: "/api/admin/blocklist/export?kind=ips&format=csv",
      label: "IP + počty (.csv)",
      hint: "stejně, pro Excel/Numbers",
    },
    {
      href: "/api/admin/blocklist/export?kind=ips&format=json",
      label: "IP + počty (.json)",
      hint: "pro vlastní skripty",
    },
    {
      href: `/api/admin/blocklist/export?kind=permaban&threshold=${threshold}&window=${windowDays}&jail=${encodeURIComponent(
        jail,
      )}`,
      label: "Permaban list (.conf)",
      hint: `IPs ≥ ${threshold}× v ${windowDays} dnech, jail ${jail}`,
    },
  ];
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Download className="h-4 w-4 text-brand-600" aria-hidden />
        Exporty
      </h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.href}>
            <a
              href={it.href}
              className="flex items-start justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs transition hover:border-brand-300 hover:bg-brand-50/30"
              download
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{it.label}</p>
                <p className="truncate text-gray-500">{it.hint}</p>
              </div>
              <Download
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400"
                aria-hidden
              />
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-start gap-1.5 text-[11px] text-gray-500">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" aria-hidden />
        <span>
          Webapp do <code>/etc/nginx/snippets/</code> nikdy nezapisuje. Stáhni{" "}
          <code>permaban-list.conf</code> a v Termiusu spusť{" "}
          <code>sudo blocklist-tools.sh nginx-deny</code>, ten ho instaluje a
          provede <code>nginx -t && systemctl reload nginx</code>.
        </span>
      </p>
    </section>
  );
}

function formatDateTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("cs-CZ", { timeZone: "Europe/Prague" });
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" });
}
