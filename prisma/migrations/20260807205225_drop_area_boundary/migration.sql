-- AlterTable
ALTER TABLE "drop_areas" ADD COLUMN     "boundary" JSONB,
ADD COLUMN     "boundary_label" VARCHAR(300);
