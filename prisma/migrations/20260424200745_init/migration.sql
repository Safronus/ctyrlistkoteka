-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "FindState" AS ENUM ('NORMAL', 'ANONYMIZED', 'DONATED', 'LOST', 'NO_GPS', 'NO_PHOTO', 'LOCATION_MISSING', 'NOT_PICKED');

-- CreateEnum
CREATE TYPE "ImageType" AS ENUM ('ORIGINAL', 'CROP');

-- CreateTable
CREATE TABLE "locations" (
    "id" INTEGER NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "code_transliterated" VARCHAR(100) NOT NULL,
    "cadastral_area" VARCHAR(100) NOT NULL,
    "location_type" VARCHAR(50) NOT NULL,
    "number" SMALLINT NOT NULL,
    "subpart" CHAR(1),
    "display_name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "center_point" geometry(Point, 4326),
    "polygon" geometry(Polygon, 4326),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_maps" (
    "id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "location_code" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "center_lat" DOUBLE PRECISION NOT NULL,
    "center_lng" DOUBLE PRECISION NOT NULL,
    "zoom" SMALLINT NOT NULL,
    "image_path" VARCHAR(500) NOT NULL,
    "image_bounds" JSONB,
    "image_width" INTEGER,
    "image_height" INTEGER,
    "has_polygon" BOOLEAN NOT NULL DEFAULT false,
    "is_anonymized" BOOLEAN NOT NULL DEFAULT false,
    "original_filename" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finds" (
    "id" INTEGER NOT NULL,
    "location_id" INTEGER,
    "map_id" INTEGER,
    "found_at" DATE,
    "leaf_count" SMALLINT NOT NULL DEFAULT 4,
    "notes" TEXT,
    "is_anonymized" BOOLEAN NOT NULL DEFAULT false,
    "coordinates" geometry(Point, 4326),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "finds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "find_images" (
    "id" SERIAL NOT NULL,
    "find_id" INTEGER NOT NULL,
    "image_type" "ImageType" NOT NULL DEFAULT 'ORIGINAL',
    "original_filename" VARCHAR(500) NOT NULL,
    "original_sha1" CHAR(40) NOT NULL,
    "web_path" VARCHAR(500) NOT NULL,
    "thumb_path" VARCHAR(500) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "find_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "find_state_assignments" (
    "find_id" INTEGER NOT NULL,
    "state" "FindState" NOT NULL,

    CONSTRAINT "find_state_assignments_pkey" PRIMARY KEY ("find_id","state")
);

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_transliterated_key" ON "locations"("code_transliterated");

-- CreateIndex
CREATE INDEX "locations_cadastral_area_idx" ON "locations"("cadastral_area");

-- CreateIndex
CREATE INDEX "locations_location_type_idx" ON "locations"("location_type");

-- CreateIndex
CREATE INDEX "location_maps_location_id_idx" ON "location_maps"("location_id");

-- CreateIndex
CREATE INDEX "location_maps_location_code_idx" ON "location_maps"("location_code");

-- CreateIndex
CREATE INDEX "finds_location_id_idx" ON "finds"("location_id");

-- CreateIndex
CREATE INDEX "finds_map_id_idx" ON "finds"("map_id");

-- CreateIndex
CREATE INDEX "finds_found_at_idx" ON "finds"("found_at" DESC);

-- CreateIndex
CREATE INDEX "finds_leaf_count_idx" ON "finds"("leaf_count");

-- CreateIndex
CREATE INDEX "finds_is_anonymized_idx" ON "finds"("is_anonymized");

-- CreateIndex
CREATE INDEX "find_images_find_id_idx" ON "find_images"("find_id");

-- CreateIndex
CREATE INDEX "find_images_is_primary_idx" ON "find_images"("is_primary");

-- CreateIndex
CREATE INDEX "find_state_assignments_state_idx" ON "find_state_assignments"("state");

-- AddForeignKey
ALTER TABLE "location_maps" ADD CONSTRAINT "location_maps_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finds" ADD CONSTRAINT "finds_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finds" ADD CONSTRAINT "finds_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "location_maps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "find_images" ADD CONSTRAINT "find_images_find_id_fkey" FOREIGN KEY ("find_id") REFERENCES "finds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "find_state_assignments" ADD CONSTRAINT "find_state_assignments_find_id_fkey" FOREIGN KEY ("find_id") REFERENCES "finds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
