-- Cosmetic find state: "GIGANT" marks a clover of unusually large size.
-- Stored exactly like the other states — in LokaceStavyPoznamky.json
-- under `stavy.GIGANT: [find ids]` and folded into find_state_assignments
-- by sync.ts. No effect on visibility or counts; purely a flag the UI
-- surfaces as a badge.

ALTER TYPE "FindState" ADD VALUE 'GIGANT';
