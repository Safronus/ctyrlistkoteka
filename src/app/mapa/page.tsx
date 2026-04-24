import type { Metadata } from "next";
import { getMapData } from "@/lib/queries/map";
import { MapLoader } from "@/components/map/map-loader";

export const metadata: Metadata = {
  title: "Mapa",
  description:
    "Interaktivní mapa lokalit a konkrétních nálezů sbírky čtyřlístků.",
};

// Leaflet is client-only; the map itself ships via dynamic import. The
// enclosing page is still a Server Component that fetches once from the DB.
// Short revalidate so new finds appear on the map within ~5 minutes.
export const revalidate = 300;

export default async function MapaPage() {
  const data = await getMapData();

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 125px)" }}>
      <div className="flex-1 overflow-hidden">
        <MapLoader data={data} />
      </div>
    </div>
  );
}
