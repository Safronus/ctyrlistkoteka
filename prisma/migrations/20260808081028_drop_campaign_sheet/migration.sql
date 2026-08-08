-- AlterTable
ALTER TABLE "drop_campaigns" ADD COLUMN     "exported_at" TIMESTAMPTZ,
ADD COLUMN     "exported_defaults" JSONB,
ADD COLUMN     "sheet_changed_at" TIMESTAMPTZ,
ADD COLUMN     "sheet_error" TEXT,
ADD COLUMN     "sheet_hash" VARCHAR(64),
ADD COLUMN     "sheet_mode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sheet_synced_at" TIMESTAMPTZ,
ADD COLUMN     "sheet_url" VARCHAR(500);
