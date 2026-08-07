-- find_qr_pins grows beyond "pinned" into the admin's per-find QR record:
-- a row now means pinned and/or revoked, so the table gets an honest name
-- and an explicit `pinned` flag instead of relying on row existence.
--
-- Revoking does NOT break a printed card: /n/<id> keeps redirecting to
-- the find detail (a card in someone's hands must never dead-end), it
-- just stops logging the scan and moves the row to the "Zrušené" list.

ALTER TABLE "find_qr_pins" RENAME TO "find_qr_codes";
ALTER TABLE "find_qr_codes" RENAME CONSTRAINT "find_qr_pins_pkey" TO "find_qr_codes_pkey";
ALTER TABLE "find_qr_codes" RENAME CONSTRAINT "find_qr_pins_find_id_fkey" TO "find_qr_codes_find_id_fkey";

-- Every pre-existing row was created by the "Přidat do seznamu" action,
-- so all of them are pins.
ALTER TABLE "find_qr_codes" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "find_qr_codes" ADD COLUMN "revoked_at" TIMESTAMPTZ;

CREATE INDEX "find_qr_codes_revoked_at_idx" ON "find_qr_codes"("revoked_at");
