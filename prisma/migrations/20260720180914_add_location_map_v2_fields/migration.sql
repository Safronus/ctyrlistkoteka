-- AlterTable
ALTER TABLE "location_maps" ADD COLUMN     "render_zoom" SMALLINT;

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "aoi_area_m2" DOUBLE PRECISION,
ADD COLUMN     "country_code" VARCHAR(2),
ADD COLUMN     "geo_address" VARCHAR(255),
ADD COLUMN     "indicator" VARCHAR(16),
ADD COLUMN     "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "radius_m" DOUBLE PRECISION,
ADD COLUMN     "schema_version" SMALLINT;
