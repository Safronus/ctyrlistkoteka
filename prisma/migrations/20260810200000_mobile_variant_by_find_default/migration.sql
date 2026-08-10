-- Odd find numbers take the mosaic, even the scatter — the rule the owner
-- asked for "napevno". It shipped as one option among several and the
-- waves kept whatever they had, so it never took effect anywhere; six
-- consecutive cards all came out scatter because SCATTER was still stored.
--
-- This overwrites the per-wave choice ONCE. The setting stays in the admin,
-- so a wave can still be put back to a single texture or to nothing.
ALTER TABLE "drop_campaigns" ALTER COLUMN "bg_mobile_variant" SET DEFAULT 'BY_FIND';
UPDATE "drop_campaigns" SET "bg_mobile_variant" = 'BY_FIND';
