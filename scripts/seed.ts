/**
 * Seeds the local development database with a small, realistic set of
 * locations, maps, finds, images and states. Safe to re-run: uses upserts.
 *
 * Run with: pnpm db:seed
 */

import { FindState, ImageType } from "@/generated/prisma/enums";
import { createPrismaClient } from "@/lib/prismaClient";

const prisma = createPrismaClient();

type LocationSeed = {
  id: number;
  code: string;
  codeTransliterated: string;
  cadastralArea: string;
  locationType: string;
  number: number;
  subpart: string | null;
  displayName: string;
  centerLat: number;
  centerLng: number;
};

type MapSeed = {
  id: number;
  locationId: number;
  locationCode: string;
  description: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
  imagePath: string;
  imageWidth: number;
  imageHeight: number;
  originalFilename: string;
};

type FindSeed = {
  id: number;
  locationId: number | null;
  mapId: number | null;
  foundAt: string | null; // ISO date
  notes: string | null;
  isAnonymized: boolean;
  lat: number | null;
  lng: number | null;
  states: FindState[];
  images: Array<{
    type: ImageType;
    filename: string;
    sha1: string;
    webPath: string;
    thumbPath: string;
    width: number;
    height: number;
    isPrimary: boolean;
  }>;
};

const LOCATIONS: LocationSeed[] = [
  {
    id: 26,
    code: "RATIBOŘ_POLE001a",
    codeTransliterated: "RATIBOR__POLE001a",
    cadastralArea: "RATIBOŘ",
    locationType: "POLE",
    number: 1,
    subpart: "a",
    displayName: "Pole nad penzionem HORA — levá hrana",
    centerLat: 49.36668,
    centerLng: 17.88867,
  },
  {
    id: 31,
    code: "RATIBOŘ_POLE001f",
    codeTransliterated: "RATIBOR__POLE001f",
    cadastralArea: "RATIBOŘ",
    locationType: "POLE",
    number: 1,
    subpart: "f",
    displayName: "Pole nad penzionem HORA — severní cíp",
    centerLat: 49.36712,
    centerLng: 17.88901,
  },
  {
    id: 55,
    code: "ZLÍN_LES003a",
    codeTransliterated: "ZLIN__LES003a",
    cadastralArea: "ZLÍN",
    locationType: "LES",
    number: 3,
    subpart: "a",
    displayName: "Lesní palouk nad přehradou",
    centerLat: 49.22543,
    centerLng: 17.66720,
  },
  {
    id: 100,
    code: "PRAHA_PARK012b",
    codeTransliterated: "PRAHA_PARK012b",
    cadastralArea: "PRAHA",
    locationType: "PARK",
    number: 12,
    subpart: "b",
    displayName: "Park Stromovka — jižní část",
    centerLat: 50.10589,
    centerLng: 14.41244,
  },
];

const MAPS: MapSeed[] = LOCATIONS.map((loc) => ({
  id: loc.id,
  locationId: loc.id,
  locationCode: loc.code,
  description: loc.displayName,
  centerLat: loc.centerLat,
  centerLng: loc.centerLng,
  zoom: 16,
  imagePath: `/generated/maps/seed-${loc.id}.webp`,
  imageWidth: 1280,
  imageHeight: 960,
  originalFilename: `${loc.codeTransliterated}_seed_GPS${loc.centerLat}S_${loc.centerLng}V_Z16_${String(loc.id).padStart(5, "0")}.png`,
}));

const FINDS: FindSeed[] = [
  // RATIBOŘ_POLE001a (26): 4 běžné nálezy
  {
    id: 101,
    locationId: 26,
    mapId: 26,
    foundAt: "2023-05-12",
    notes: null,
    isAnonymized: false,
    lat: 49.36670,
    lng: 17.88870,
    states: [FindState.NORMAL],
    images: [seedImage(101, "a", true)],
  },
  {
    id: 102,
    locationId: 26,
    mapId: 26,
    foundAt: "2023-05-12",
    notes: "Druhý čtyřlístek, nalezen pár metrů od prvního",
    isAnonymized: false,
    lat: 49.36672,
    lng: 17.88868,
    states: [FindState.NORMAL],
    images: [seedImage(102, "a", true), seedImage(102, "b", false)],
  },
  {
    id: 103,
    locationId: 26,
    mapId: 26,
    foundAt: "2023-06-03",
    notes: null,
    isAnonymized: false,
    lat: 49.36664,
    lng: 17.88872,
    states: [FindState.NORMAL],
    images: [seedImage(103, "a", true)],
  },
  // RATIBOŘ_POLE001f (31): anonymizovaný + NO_PHOTO
  {
    id: 150,
    locationId: 31,
    mapId: 31,
    foundAt: "2023-07-14",
    notes: "Na zahradě Nováků (tajné)",
    isAnonymized: true,
    lat: 49.36712,
    lng: 17.88901,
    states: [FindState.ANONYMIZED],
    images: [seedImage(150, "a", true)],
  },
  {
    id: 151,
    locationId: 31,
    mapId: 31,
    foundAt: "2023-07-20",
    notes: null,
    isAnonymized: false,
    lat: null,
    lng: null,
    states: [FindState.NO_PHOTO],
    images: [],
  },
  // ZLÍN_LES003a (55): NO_GPS, darovaný, ztracený
  {
    id: 200,
    locationId: 55,
    mapId: 55,
    foundAt: "2022-08-01",
    notes: null,
    isAnonymized: false,
    lat: null,
    lng: null,
    states: [FindState.NO_GPS],
    images: [seedImage(200, "a", true)],
  },
  {
    id: 201,
    locationId: 55,
    mapId: 55,
    foundAt: "2022-08-15",
    notes: "DAR — Brášule a jeho rodinka",
    isAnonymized: false,
    lat: 49.22540,
    lng: 17.66715,
    states: [FindState.DONATED, FindState.NORMAL],
    images: [seedImage(201, "a", true)],
  },
  {
    id: 202,
    locationId: 55,
    mapId: 55,
    foundAt: "2022-09-03",
    notes: "Ztraceno při stěhování 2024",
    isAnonymized: false,
    lat: 49.22548,
    lng: 17.66724,
    states: [FindState.LOST],
    images: [seedImage(202, "a", true)],
  },
  // PRAHA_PARK012b (100): běžné
  {
    id: 300,
    locationId: 100,
    mapId: 100,
    foundAt: "2024-04-22",
    notes: null,
    isAnonymized: false,
    lat: 50.10590,
    lng: 14.41245,
    states: [FindState.NORMAL],
    images: [seedImage(300, "a", true)],
  },
  {
    id: 301,
    locationId: 100,
    mapId: 100,
    foundAt: "2024-04-22",
    notes: "Druhý čtyřlístek z téhož místa — týž den",
    isAnonymized: false,
    lat: 50.10592,
    lng: 14.41248,
    states: [FindState.NORMAL],
    images: [seedImage(301, "a", true), seedImage(301, "b", false)],
  },
  // LOCATION_MISSING: bez lokality a mapy
  {
    id: 999,
    locationId: null,
    mapId: null,
    foundAt: "2021-10-10",
    notes: "Nalezeno v Irsku v Dublinu",
    isAnonymized: false,
    lat: 53.34976,
    lng: -6.26028,
    states: [FindState.LOCATION_MISSING],
    images: [seedImage(999, "a", true)],
  },
];

function seedImage(findId: number, suffix: string, isPrimary: boolean) {
  const sha1 = `seed${String(findId).padStart(5, "0")}${suffix}${"0".repeat(32)}`.slice(0, 40);
  return {
    type: ImageType.ORIGINAL,
    filename: `${findId}_00000_SEED_NORMA_LNI__NE_BezPozna_mky_${suffix}.HEIC`,
    sha1,
    webPath: `/generated/web/${sha1}.webp`,
    thumbPath: `/generated/thumb/${sha1}.webp`,
    width: 1600,
    height: 1200,
    isPrimary,
  };
}

async function main() {
  console.log("🌱 Seeding database…");

  // --- Locations ---
  for (const loc of LOCATIONS) {
    await prisma.location.upsert({
      where: { id: loc.id },
      create: {
        id: loc.id,
        code: loc.code,
        codeTransliterated: loc.codeTransliterated,
        cadastralArea: loc.cadastralArea,
        locationType: loc.locationType,
        number: loc.number,
        subpart: loc.subpart,
        displayName: loc.displayName,
      },
      update: {
        code: loc.code,
        codeTransliterated: loc.codeTransliterated,
        cadastralArea: loc.cadastralArea,
        locationType: loc.locationType,
        number: loc.number,
        subpart: loc.subpart,
        displayName: loc.displayName,
      },
    });

    // Geometry (PostGIS) — raw SQL, Prisma ji nezná
    await prisma.$executeRaw`
      UPDATE locations
      SET center_point = ST_SetSRID(ST_MakePoint(${loc.centerLng}, ${loc.centerLat}), 4326)
      WHERE id = ${loc.id}
    `;
  }
  console.log(`  ✓ ${LOCATIONS.length} locations`);

  // --- Location maps ---
  for (const map of MAPS) {
    const bounds = computeBounds(map);
    await prisma.locationMap.upsert({
      where: { id: map.id },
      create: {
        id: map.id,
        locationId: map.locationId,
        locationCode: map.locationCode,
        description: map.description,
        centerLat: map.centerLat,
        centerLng: map.centerLng,
        zoom: map.zoom,
        imagePath: map.imagePath,
        imageBounds: bounds,
        imageWidth: map.imageWidth,
        imageHeight: map.imageHeight,
        hasPolygon: false,
        isAnonymized: false,
        originalFilename: map.originalFilename,
      },
      update: {
        description: map.description,
        imageBounds: bounds,
      },
    });
  }
  console.log(`  ✓ ${MAPS.length} location maps`);

  // --- Finds + images + states ---
  for (const find of FINDS) {
    await prisma.find.upsert({
      where: { id: find.id },
      create: {
        id: find.id,
        locationId: find.locationId,
        mapId: find.mapId,
        foundAt: find.foundAt ? new Date(find.foundAt) : null,
        notes: find.notes,
        isAnonymized: find.isAnonymized,
      },
      update: {
        locationId: find.locationId,
        mapId: find.mapId,
        foundAt: find.foundAt ? new Date(find.foundAt) : null,
        notes: find.notes,
        isAnonymized: find.isAnonymized,
      },
    });

    if (find.lat !== null && find.lng !== null) {
      await prisma.$executeRaw`
        UPDATE finds
        SET coordinates = ST_SetSRID(ST_MakePoint(${find.lng}, ${find.lat}), 4326)
        WHERE id = ${find.id}
      `;
    } else {
      await prisma.$executeRaw`UPDATE finds SET coordinates = NULL WHERE id = ${find.id}`;
    }

    // Reset images + states for clean re-seed
    await prisma.findImage.deleteMany({ where: { findId: find.id } });
    await prisma.findStateAssignment.deleteMany({ where: { findId: find.id } });

    for (let i = 0; i < find.images.length; i++) {
      const img = find.images[i]!;
      await prisma.findImage.create({
        data: {
          findId: find.id,
          imageType: img.type,
          originalFilename: img.filename,
          originalSha1: img.sha1,
          webPath: img.webPath,
          thumbPath: img.thumbPath,
          width: img.width,
          height: img.height,
          isPrimary: img.isPrimary,
          sortOrder: i,
        },
      });
    }

    for (const state of find.states) {
      await prisma.findStateAssignment.create({
        data: { findId: find.id, state },
      });
    }
  }
  console.log(`  ✓ ${FINDS.length} finds (with images + states)`);

  // --- Summary ---
  const stats = {
    locations: await prisma.location.count(),
    maps: await prisma.locationMap.count(),
    finds: await prisma.find.count(),
    images: await prisma.findImage.count(),
    stateAssignments: await prisma.findStateAssignment.count(),
  };
  console.log("\n📊 Database totals:", stats);
  console.log("✅ Seed complete.");
}

/**
 * Approximate Leaflet imageOverlay bounds from GPS center + zoom + px size.
 * Same formula as in docs/filename-convention.md.
 */
function computeBounds(map: MapSeed): [[number, number], [number, number]] {
  const resolution = (156543.03 * Math.cos((map.centerLat * Math.PI) / 180)) / Math.pow(2, map.zoom);
  const widthM = map.imageWidth * resolution;
  const heightM = map.imageHeight * resolution;
  const dLat = heightM / 111320;
  const dLng = widthM / (111320 * Math.cos((map.centerLat * Math.PI) / 180));
  return [
    [map.centerLat - dLat / 2, map.centerLng - dLng / 2],
    [map.centerLat + dLat / 2, map.centerLng + dLng / 2],
  ];
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
