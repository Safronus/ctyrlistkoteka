-- CreateTable
CREATE TABLE "qr_codes" (
    "id" SERIAL NOT NULL,
    "token" VARCHAR(16) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "target" VARCHAR(20) NOT NULL,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'cs',
    "theme" VARCHAR(16) NOT NULL DEFAULT 'brand',
    "module_style" VARCHAR(16) NOT NULL DEFAULT 'clover',
    "center_image" VARCHAR(16) NOT NULL DEFAULT 'clover',
    "center_scale" VARCHAR(8) NOT NULL DEFAULT 'md',
    "show_title" BOOLEAN NOT NULL DEFAULT true,
    "title_text" VARCHAR(200),
    "show_caption" BOOLEAN NOT NULL DEFAULT false,
    "size" VARCHAR(8) NOT NULL DEFAULT 'md',
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_scans" (
    "id" SERIAL NOT NULL,
    "qr_code_id" INTEGER NOT NULL,
    "scanned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_token_key" ON "qr_codes"("token");

-- CreateIndex
CREATE INDEX "qr_codes_archived_at_idx" ON "qr_codes"("archived_at");

-- CreateIndex
CREATE INDEX "qr_scans_qr_code_id_idx" ON "qr_scans"("qr_code_id");

-- CreateIndex
CREATE INDEX "qr_scans_scanned_at_idx" ON "qr_scans"("scanned_at");

-- AddForeignKey
ALTER TABLE "qr_scans" ADD CONSTRAINT "qr_scans_qr_code_id_fkey" FOREIGN KEY ("qr_code_id") REFERENCES "qr_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

