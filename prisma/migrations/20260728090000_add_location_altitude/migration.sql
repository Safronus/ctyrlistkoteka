-- Terrain elevation of a location's centre point, in metres above sea level.
--
-- Filled by scripts/fetch-elevations.ts from a digital elevation model, NOT
-- from the photos' EXIF GPSAltitude: measured over 29 068 real photos, the
-- per-location spread of phone altitude readings was 0.6–12 m (IQR) with
-- outliers 400 m off, so a DEM lookup at the centre is both more accurate and
-- far cheaper than re-reading every photo.
--
-- Nullable on purpose: anonymized locations are never looked up (their
-- coordinates must not leave the server), and locations with no centre point
-- have nothing to look up.
ALTER TABLE "locations" ADD COLUMN "altitude_m" DOUBLE PRECISION;
ALTER TABLE "locations" ADD COLUMN "altitude_source" VARCHAR(32);
