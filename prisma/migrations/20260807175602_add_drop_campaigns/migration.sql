-- CreateEnum
CREATE TYPE "DropStatus" AS ENUM ('PREPARED', 'PRINTED', 'HIDDEN', 'FOUND');

-- CreateTable
CREATE TABLE "drop_campaigns" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "note" TEXT,
    "heading_cs" VARCHAR(200) NOT NULL,
    "heading_en" VARCHAR(200),
    "body_cs" TEXT NOT NULL,
    "body_en" TEXT,
    "bonus_cs" TEXT,
    "bonus_en" TEXT,
    "qr_title" VARCHAR(200),
    "qr_options" JSONB,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "drop_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drop_areas" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "center_lat" DOUBLE PRECISION NOT NULL,
    "center_lng" DOUBLE PRECISION NOT NULL,
    "zoom" SMALLINT NOT NULL DEFAULT 14,
    "scatter_radius_m" DOUBLE PRECISION,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drop_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drop_items" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "area_id" INTEGER,
    "find_id" INTEGER NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "status" "DropStatus" NOT NULL DEFAULT 'PREPARED',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "heading_cs" VARCHAR(200),
    "heading_en" VARCHAR(200),
    "body_cs" TEXT,
    "body_en" TEXT,
    "bonus_cs" TEXT,
    "bonus_en" TEXT,
    "qr_title" VARCHAR(200),
    "qr_options" JSONB,
    "image_path" VARCHAR(500),
    "hint_cs" TEXT,
    "hint_en" TEXT,
    "hint_published" BOOLEAN NOT NULL DEFAULT false,
    "placed_at" TIMESTAMPTZ,
    "found_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "drop_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drop_scans" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "scanned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drop_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drop_areas_campaign_id_idx" ON "drop_areas"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "drop_items_find_id_key" ON "drop_items"("find_id");

-- CreateIndex
CREATE UNIQUE INDEX "drop_items_token_key" ON "drop_items"("token");

-- CreateIndex
CREATE INDEX "drop_items_campaign_id_idx" ON "drop_items"("campaign_id");

-- CreateIndex
CREATE INDEX "drop_items_area_id_idx" ON "drop_items"("area_id");

-- CreateIndex
CREATE INDEX "drop_items_status_idx" ON "drop_items"("status");

-- CreateIndex
CREATE INDEX "drop_scans_item_id_idx" ON "drop_scans"("item_id");

-- CreateIndex
CREATE INDEX "drop_scans_scanned_at_idx" ON "drop_scans"("scanned_at");

-- AddForeignKey
ALTER TABLE "drop_areas" ADD CONSTRAINT "drop_areas_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "drop_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drop_items" ADD CONSTRAINT "drop_items_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "drop_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drop_items" ADD CONSTRAINT "drop_items_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "drop_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drop_items" ADD CONSTRAINT "drop_items_find_id_fkey" FOREIGN KEY ("find_id") REFERENCES "finds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drop_scans" ADD CONSTRAINT "drop_scans_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "drop_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
