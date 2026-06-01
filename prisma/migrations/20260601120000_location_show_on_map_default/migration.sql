-- Per-child "overlay the parent polygon on /mapa by default" flag.
-- Driven by the `{ "code": ..., "map": true }` form in
-- LokaceHierarchie.json (sync sets it). Top-level locations leave it
-- false — they're always shown regardless. Default false keeps every
-- existing child hidden-by-default until the operator opts it in via
-- the hierarchy editor, matching the prior /mapa behaviour.
ALTER TABLE "locations"
  ADD COLUMN "show_on_map_by_default" BOOLEAN NOT NULL DEFAULT false;
