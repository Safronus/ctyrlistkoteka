-- AlterTable
ALTER TABLE "qr_codes" ADD COLUMN     "border" VARCHAR(12) NOT NULL DEFAULT 'none',
ADD COLUMN     "border_color" VARCHAR(8) NOT NULL DEFAULT 'theme',
ADD COLUMN     "border_radius" VARCHAR(8) NOT NULL DEFAULT 'soft';

