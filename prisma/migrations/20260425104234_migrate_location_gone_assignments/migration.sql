-- Backfill: every find currently flagged LOCATION_MISSING whose linked
-- location code starts with "NEEXISTUJE-" should actually be
-- LOCATION_GONE. The previous JSON_STATE_MAP collapsed both meanings
-- into LOCATION_MISSING; this query splits them so the UI can render
-- the two cases distinctly.

UPDATE "find_state_assignments" AS fsa
SET "state" = 'LOCATION_GONE'
FROM "finds" AS f
JOIN "locations" AS l ON l."id" = f."location_id"
WHERE fsa."find_id" = f."id"
  AND fsa."state" = 'LOCATION_MISSING'
  AND l."code" LIKE 'NEEXISTUJE-%';
