-- Promote `finds.found_at` from DATE to TIMESTAMPTZ(6) so EXIF time-of-day
-- (hours, minutes, seconds) survives import. Existing DATE values are
-- interpreted as midnight in the server's local timezone — re-running
-- `pnpm sync --only=finds` after this migration will overwrite them with
-- full timestamps re-extracted from EXIF.

ALTER TABLE "finds"
  ALTER COLUMN "found_at" TYPE TIMESTAMPTZ(6)
  USING "found_at"::timestamptz;
