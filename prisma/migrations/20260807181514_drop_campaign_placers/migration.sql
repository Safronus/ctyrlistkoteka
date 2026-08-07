-- AlterTable
ALTER TABLE "drop_campaigns" ADD COLUMN     "placers" TEXT[] DEFAULT ARRAY[]::TEXT[];
