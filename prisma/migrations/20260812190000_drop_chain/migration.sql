-- "Řetězec čtyřlístků": a hunt through a subset of one area, where each
-- card's landing page reveals a hint towards the next.
--
-- An order, not a next-item link: reshuffling rewrites N small integers
-- instead of a linked list that could grow a cycle or a fork, and "who
-- comes after me" stays one indexed query. Null = not in the chain, which
-- is every card until the operator picks some.
ALTER TABLE "drop_items" ADD COLUMN "chain_order" SMALLINT;
CREATE INDEX "drop_items_area_id_chain_order_idx" ON "drop_items"("area_id", "chain_order");

-- Off until switched on, per area.
ALTER TABLE "drop_areas" ADD COLUMN "chain_enabled" BOOLEAN NOT NULL DEFAULT false;
