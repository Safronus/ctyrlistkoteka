-- Whether the crew page may link to the shared Google Sheet.
--
-- Off by default and a switch of its own: the sheet URL is admin-only data
-- (CLAUDE.md §9) because the sheet holds EVERY area's coordinates and is
-- normally shared for editing — strictly more than one area's crew map
-- shows. Handing it to the crew has to be a decision, not a side effect.
ALTER TABLE "drop_campaigns"
  ADD COLUMN "sheet_share_crew" BOOLEAN NOT NULL DEFAULT false;
