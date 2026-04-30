/**
 * Tiny "Návštěv: 1 234" badge rendered in the site footer. Reads the
 * total from the self-hosted GoatCounter via getTotalVisits(); on any
 * failure (network, missing key, malformed response) it falls back to
 * "Návštěv: ???" with a tooltip explaining the outage.
 *
 * Server component — the fetch call is cached at the Next.js layer
 * (10 min TTL) so renders stay cheap regardless of pageload volume.
 */
import { getTotalVisits, VISIT_TRACKING_START } from "@/lib/queries/visits";
import { formatDateCs } from "@/lib/format";

const FORMAT = new Intl.NumberFormat("cs-CZ");

function startedAtLabel(iso: string): string {
  // ISO YYYY-MM-DD → Date in UTC noon to avoid TZ-flip edge cases.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return formatDateCs(new Date(Date.UTC(y, m - 1, d, 12)));
}

const TOOLTIP_FAIL =
  "Statistiky momentálně nejsou dostupné — instance GoatCounter pravděpodobně nereaguje. Sběr přes pixel běží dál a počet se vrátí, jakmile bude API zpět.";

export async function VisitCounter() {
  const data = await getTotalVisits();
  const since = startedAtLabel(VISIT_TRACKING_START);
  if (data) {
    return (
      <span
        title={`Počet návštěv od ${since}. Aktualizováno cca každých 10 minut z GoatCounter (stats.ctyrlistkoteka.cz). Filtruje boty a IP autora.`}
        className="inline-flex items-center gap-1.5"
      >
        <span>Návštěv:</span>
        <span className="font-mono font-medium tabular-nums text-gray-700">
          {FORMAT.format(data.total)}
        </span>
      </span>
    );
  }
  return (
    <span
      title={TOOLTIP_FAIL}
      className="inline-flex items-center gap-1.5"
    >
      <span>Návštěv:</span>
      <span className="font-mono text-gray-400">???</span>
    </span>
  );
}
