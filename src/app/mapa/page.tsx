import type { Metadata } from "next";
import { getMapData } from "@/lib/queries/map";
import { MapLoader } from "@/components/map/map-loader";

export const metadata: Metadata = {
  title: "Mapa",
  description:
    "Interaktivní mapa lokalit a konkrétních nálezů sbírky čtyřlístků.",
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

  const data = await getMapData();

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 125px)" }}>
      <div className="flex-1 overflow-hidden">
        <MapLoader data={data} focusLocationId={focusLocationId} />
      </div>
    </div>
  );
}
