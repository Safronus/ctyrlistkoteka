-- CaSQB QR codes share the qr_codes table with the site's own page codes.
--
-- `kind` tells the two apart; `target_url` holds the external https
-- destination a casqb code redirects to (page codes keep using `target`);
-- `style` carries the brand-manual look (shapes, colours, centre logo) so
-- a stored code re-renders identically for every download.
ALTER TABLE "qr_codes"
  ADD COLUMN "kind" VARCHAR(8) NOT NULL DEFAULT 'page',
  ADD COLUMN "target_url" VARCHAR(2048),
  ADD COLUMN "style" JSONB;

CREATE INDEX "qr_codes_kind_idx" ON "qr_codes"("kind");
