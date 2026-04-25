-- Adds the LOCATION_GONE find state. Kept in its own migration because
-- PostgreSQL forbids using a freshly added enum value in the same
-- transaction that introduces it — the data migration that promotes
-- existing LOCATION_MISSING rows to LOCATION_GONE lives in the next
-- migration.

ALTER TYPE "FindState" ADD VALUE IF NOT EXISTS 'LOCATION_GONE';
