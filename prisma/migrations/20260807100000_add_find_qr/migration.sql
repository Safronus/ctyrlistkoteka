-- Find QR codes: pinned finds shown in the /admin/qr list, and scan log
-- for the /n/<find id> redirect.
--
-- No table of generated codes: a find QR always encodes /n/<id>, so the
-- find id is the code's identity. `find_qr_pins` is UI bookkeeping only
-- (which non-donated finds the operator wants listed).

-- Page QR codes gain the same density (error-correction) option, stored
-- so a re-download from the evidence list reproduces the exact image.
ALTER TABLE "qr_codes" ADD COLUMN "density" VARCHAR(8) NOT NULL DEFAULT 'dense';

CREATE TABLE "find_qr_pins" (
    "find_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "find_qr_pins_pkey" PRIMARY KEY ("find_id")
);

CREATE TABLE "find_qr_scans" (
    "id" SERIAL NOT NULL,
    "find_id" INTEGER NOT NULL,
    "scanned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "find_qr_scans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "find_qr_scans_find_id_idx" ON "find_qr_scans"("find_id");
CREATE INDEX "find_qr_scans_scanned_at_idx" ON "find_qr_scans"("scanned_at");

ALTER TABLE "find_qr_pins" ADD CONSTRAINT "find_qr_pins_find_id_fkey"
    FOREIGN KEY ("find_id") REFERENCES "finds"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "find_qr_scans" ADD CONSTRAINT "find_qr_scans_find_id_fkey"
    FOREIGN KEY ("find_id") REFERENCES "finds"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
