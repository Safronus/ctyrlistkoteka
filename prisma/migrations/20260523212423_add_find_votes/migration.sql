-- Public "thumbs up" voting on finds. Each vote keyed by (find_id,
-- voter_uuid) with a secondary uniqueness on (find_id, fingerprint)
-- so a single user can't easily double-vote by just clearing cookies
-- (still has the same IP+UA hash) or by VPN-switching (still has the
-- same cookie). Both have to change. For DIFFERENT finds the same
-- voter is allowed unlimited votes — that's by design.

CREATE TABLE "find_votes" (
    "find_id" INTEGER NOT NULL,
    "voter_uuid" UUID NOT NULL,
    "fingerprint" CHAR(40) NOT NULL,
    "voted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" CHAR(40) NOT NULL,
    "user_agent" VARCHAR(500),

    CONSTRAINT "find_votes_pkey" PRIMARY KEY ("find_id", "voter_uuid")
);

-- Secondary unique constraint: same fingerprint cannot vote for the
-- same find twice. Independent of the cookie UUID.
CREATE UNIQUE INDEX "find_votes_fingerprint_unique"
    ON "find_votes"("find_id", "fingerprint");

-- Audit / admin views index by recency
CREATE INDEX "find_votes_voted_at_idx" ON "find_votes"("voted_at" DESC);
CREATE INDEX "find_votes_fingerprint_idx" ON "find_votes"("fingerprint");
CREATE INDEX "find_votes_voter_uuid_idx" ON "find_votes"("voter_uuid");

ALTER TABLE "find_votes" ADD CONSTRAINT "find_votes_find_id_fkey"
    FOREIGN KEY ("find_id") REFERENCES "finds"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Denormalized cache on `finds`. Triggers below keep it in sync so
-- listing / leaderboard queries stay O(1) per row instead of needing
-- a group-by on find_votes for every render.
ALTER TABLE "finds" ADD COLUMN "vote_count" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "finds_vote_count_idx" ON "finds"("vote_count" DESC);

-- Trigger: increment on insert, decrement on delete. No update trigger
-- needed — we only ever INSERT or DELETE in this table, never UPDATE.
CREATE OR REPLACE FUNCTION find_votes_sync_count() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE "finds" SET "vote_count" = "vote_count" + 1 WHERE "id" = NEW."find_id";
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE "finds" SET "vote_count" = GREATEST("vote_count" - 1, 0) WHERE "id" = OLD."find_id";
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER find_votes_sync_count_trigger
    AFTER INSERT OR DELETE ON "find_votes"
    FOR EACH ROW EXECUTE FUNCTION find_votes_sync_count();
