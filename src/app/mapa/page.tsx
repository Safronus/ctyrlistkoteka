import type { Metadata } from "next";
import { getMapData } from "@/lib/queries/map";
import { listLocations } from "@/lib/queries/locations";
import { MapaShell } from "@/components/map/mapa-shell";

export const metadata: Metadata = {
  title: "Mapa",
  description: "Interaktivní mapa lokalit sbírky čtyřlístků.",
};

// `focus` opts the page out of static caching so the focused location is
// honoured on every navigation rather than baked into a single ISR copy.
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function MapaPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const focusRaw = pickString(sp.focus);
  const focusLocationId =
    focusRaw && /^\d+$/.test(focusRaw) ? Number(focusRaw) : null;

  // Sidebar shows the same shape of data as /lokality, including
  // anonymized rows (rendered with redacted info + a badge). The map
  // itself still hides anonymized polygons/overlays via getMapData.
  const [data, sidebarLocations] = await Promise.all([
    getMapData(),
    listLocations({ showAnonymized: true, showGone: true }),
  ]);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 125px)" }}>
      <div className="flex-1 overflow-hidden">
        <MapaShell
          mapData={data}
          sidebarLocations={sidebarLocations}
          initialFocusId={focusLocationId}
        />
      </div>
    </div>
  );
}
