-- Read-only crew map per area: an unlisted page listing every hiding spot of
-- one area so the team can check them on a map instead of reading GPS out of
-- a spreadsheet.
--
-- Two gates, both nullable so the feature is off until the operator turns it
-- on: an unguessable token in the URL and a shared password. The password is
-- stored in plain text on purpose — it is a word for a group chat, not a
-- login, and hashing it would only pretend otherwise (the operator has to be
-- able to read it back out of the admin to tell people).
ALTER TABLE "drop_areas"
  ADD COLUMN "crew_token" VARCHAR(64),
  ADD COLUMN "crew_password" VARCHAR(120);

CREATE UNIQUE INDEX "drop_areas_crew_token_key" ON "drop_areas"("crew_token");
