-- Two-level location hierarchy. Parents and children share the same
-- table; depth is enforced in application code (sync.ts validates max
-- depth 2 + no cycles when reading data/meta/LokaceHierarchie.json).
-- ON DELETE SET NULL keeps children alive when a parent disappears
-- — they fall back to behaving as standalone locations.

ALTER TABLE "locations" ADD COLUMN "parent_id" INTEGER;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "locations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "locations_parent_id_idx" ON "locations"("parent_id");
