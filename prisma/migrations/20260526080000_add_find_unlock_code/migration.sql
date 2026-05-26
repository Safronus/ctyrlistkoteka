-- Per-find unlock code for anonymized donation photos. NULL means the
-- find inherits the global FIND_PHOTO_UNLOCK_CODE env var; a non-null
-- value overrides it for THIS find only — recipients of a specific
-- gift get a personal code while the rest of the collection stays on
-- the shared default. Set / cleared from the admin donation-photo
-- detail page; the value is compared in constant time at unlock time.
ALTER TABLE "finds" ADD COLUMN "unlock_code" VARCHAR(256);
