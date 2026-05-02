import { promises as fs } from "node:fs";
import {
  AlertTriangle,
  EyeOff,
  Map as MapIcon,
  Sigma,
} from "lucide-react";
import {
  computeMapBounds,
  parsePngTextChunks,
  readAnonymizedFlag,
} from "@/lib/images";
import { parseMapFilename } from "@/lib/parseFilename";

interface Props {
  filename: string;
  absolutePath: string;
}

interface AoiSummary {
  pointCount: number;
  /** [minLng, minLat, maxLng, maxLat] in GPS degrees. */
  bbox: [number, number, number, number];
  preview: Array<[number, number]>;
}

const NONEXISTENT_PREFIX = "NEEXISTUJE-";
const AOI_PREVIEW_POINTS = 4;

/** Renders a compact metadata card for a location-map PNG. Reads the
 *  filename (which already carries lat/lng/zoom/MAP_ID) plus PNG tEXt
 *  chunks for AOI_POLYGON + AnonymizovanLokace. The image dimensions
 *  are taken from the IHDR chunk directly so we don't pull sharp into
 *  the request path — the IHDR is always at byte offset 16 in a PNG,
 *  so a 24-byte read is enough. */
export async function MapMetadataPreview({ filename, absolutePath }: Props) {
  const parsed = parseMapFilename(filename);
  // tEXt + IHDR live in the front of the file; read enough to cover
  // the metadata block before any IDAT noise. 64 KB matches what
  // src/lib/admin/mapAnon.ts uses for the bulk listing.
  const head = await readHead(absolutePath, 64 * 1024);

  const ihdr = readPngIhdr(head);
  const tags = parsePngTextChunks(head);
  const isAnonymizedFromTags = readAnonymizedFlag(tags);

  let aoi: AoiSummary | null = null;
  if (parsed.ok && ihdr) {
    const bounds = computeMapBounds({
      centerLat: parsed.value.centerLat,
      centerLng: parsed.value.centerLng,
      zoom: parsed.value.zoom,
      width: ihdr.width,
      height: ihdr.height,
    });
    aoi = computeAoiSummary(tags.AOI_POLYGON, bounds, ihdr.width, ihdr.height);
  }

  const isNonExistent = filename.startsWith(NONEXISTENT_PREFIX);

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          <MapIcon className="h-4 w-4 text-brand-600" aria-hidden />
          Metadata lokační mapy
        </h2>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium">
          {isAnonymizedFromTags && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
              <EyeOff className="h-3 w-3" aria-hidden />
              anonymizovaná (tEXt)
            </span>
          )}
          {isNonExistent && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-red-800">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              zaniklá (NEEXISTUJE-)
            </span>
          )}
        </div>
      </header>

      {!parsed.ok && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Název souboru se nepodařilo rozparsovat:{" "}
          <span className="font-mono">{parsed.error}</span>
        </p>
      )}

      {parsed.ok && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <Field label="MAP_ID">
            <span className="font-mono tabular-nums">
              {String(parsed.value.mapId).padStart(5, "0")}
            </span>
          </Field>
          <Field label="Zoom">
            <span className="font-mono tabular-nums">
              {parsed.value.zoom}
            </span>
          </Field>
          <Field label="GPS střed">
            <span className="font-mono tabular-nums">
              {parsed.value.centerLat.toFixed(5)}°,{" "}
              {parsed.value.centerLng.toFixed(5)}°
            </span>
          </Field>
          <Field label="Rozměr (px)">
            <span className="font-mono tabular-nums">
              {ihdr ? `${ihdr.width} × ${ihdr.height}` : "—"}
            </span>
          </Field>
          <Field label="Lokalita (kód)" wide>
            <span className="break-words font-mono">
              {parsed.value.locationCode}
            </span>
          </Field>
          <Field label="Popisek" wide>
            <span className="break-words">
              {parsed.value.description || (
                <span className="text-gray-400">—</span>
              )}
            </span>
          </Field>
        </dl>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <h3 className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700">
            <Sigma className="h-3.5 w-3.5" aria-hidden />
            AOI polygon
          </h3>
          {aoi ? (
            <dl className="space-y-0.5 text-[11px] text-gray-700">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-gray-400">Bodů</dt>
                <dd className="font-mono tabular-nums">
                  {aoi.pointCount.toLocaleString("cs-CZ")}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-gray-400">BBox lat</dt>
                <dd className="font-mono tabular-nums">
                  {aoi.bbox[1].toFixed(5)}° – {aoi.bbox[3].toFixed(5)}°
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-gray-400">BBox lng</dt>
                <dd className="font-mono tabular-nums">
                  {aoi.bbox[0].toFixed(5)}° – {aoi.bbox[2].toFixed(5)}°
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-gray-400">Náhled</dt>
                <dd className="font-mono text-[10px] tabular-nums leading-snug">
                  {aoi.preview
                    .map(
                      ([lng, lat]) =>
                        `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
                    )
                    .join(" · ")}
                  {aoi.pointCount > aoi.preview.length && (
                    <span className="text-gray-400">{` … +${(
                      aoi.pointCount - aoi.preview.length
                    ).toLocaleString("cs-CZ")}`}</span>
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-[11px] text-gray-500">
              Žádný AOI polygon v tEXt. Mapa nemá vykreslený obrys lokality.
            </p>
          )}
        </div>

        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <h3 className="mb-1.5 text-xs font-semibold text-gray-700">
            PNG tEXt / iTXt
          </h3>
          {Object.keys(tags).length === 0 ? (
            <p className="text-[11px] text-gray-500">
              Žádné textové chunky.
            </p>
          ) : (
            <ul className="space-y-1 text-[11px]">
              {Object.entries(tags).map(([key, value]) => (
                <li key={key} className="flex gap-2">
                  <span className="w-32 shrink-0 truncate font-medium text-gray-600">
                    {key}
                  </span>
                  <span
                    className="flex-1 break-all font-mono text-gray-800"
                    title={value}
                  >
                    {summarizeTagValue(key, value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "col-span-2 sm:col-span-2" : undefined}>
      <dt className="text-[10px] uppercase tracking-wide text-gray-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-gray-800">{children}</dd>
    </div>
  );
}

async function readHead(absolutePath: string, bytes: number): Promise<Buffer> {
  const fh = await fs.open(absolutePath, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Reads width + height from a PNG header without pulling sharp. The
 *  IHDR chunk is the first chunk after the 8-byte PNG signature, so
 *  the dimensions live at fixed offsets 16 (width) and 20 (height). */
function readPngIhdr(buf: Buffer): { width: number; height: number } | null {
  if (
    buf.length < 24 ||
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47
  ) {
    return null;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

function computeAoiSummary(
  raw: string | undefined,
  bounds: [[number, number], [number, number]],
  width: number,
  height: number,
): AoiSummary | null {
  if (!raw) return null;
  let parsed: { points?: unknown };
  try {
    parsed = JSON.parse(raw) as { points?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.points) || parsed.points.length < 3) return null;

  const [[swLat, swLng], [neLat, neLng]] = bounds;
  const gps: Array<[number, number]> = [];
  for (const pt of parsed.points) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const px = Number(pt[0]);
    const py = Number(pt[1]);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const lng = swLng + (px / width) * (neLng - swLng);
    const lat = neLat - (py / height) * (neLat - swLat);
    gps.push([lng, lat]);
  }
  if (gps.length < 3) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of gps) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return {
    pointCount: gps.length,
    bbox: [minLng, minLat, maxLng, maxLat],
    preview: gps.slice(0, AOI_PREVIEW_POINTS),
  };
}

function summarizeTagValue(key: string, value: string): string {
  // The AOI polygon JSON is the one tag that's too long to dump
  // inline — replace the points array with a count so the table
  // stays readable. The full polygon already gets a dedicated panel
  // alongside this list.
  if (key === "AOI_POLYGON") {
    try {
      const parsed = JSON.parse(value) as { points?: unknown };
      if (Array.isArray(parsed.points)) {
        return `{ points: [${parsed.points.length} bodů] }`;
      }
    } catch {
      // fall through to length-truncated display
    }
  }
  if (value.length > 200) return `${value.slice(0, 200)}…`;
  return value;
}
