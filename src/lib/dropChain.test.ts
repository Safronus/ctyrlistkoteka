import { describe, expect, it } from "vitest";
import { makeRng } from "./collage";
import {
  buildChainOrder,
  chainStep,
  isChainEnd,
  resolveChainHint,
  type ChainItem,
} from "./dropChain";

const NO_CAMPAIGN_HINT = { hintCs: null, hintEn: null };

const item = (
  findId: number,
  chainOrder: number | null,
  extra: Partial<ChainItem> = {},
): ChainItem => ({
  id: findId * 10,
  findId,
  chainOrder,
  hintCs: `nápověda k ${findId}`,
  hintEn: null,
  foundAt: null,
  ...extra,
});

describe("chainStep", () => {
  const area = [item(101, 1), item(202, 2), item(303, 3)];

  it("points at the next link and says where in the chain we are", () => {
    const s = chainStep(area[0]!, area, NO_CAMPAIGN_HINT, "cs");
    expect(s?.next.findId).toBe(202);
    expect(s?.hint).toBe("nápověda k 202");
    expect(s?.position).toBe(1);
    expect(s?.total).toBe(3);
  });

  it("ends at the last link instead of wrapping round", () => {
    expect(chainStep(area[2]!, area, NO_CAMPAIGN_HINT, "cs")).toBeNull();
    expect(isChainEnd(area[2]!, area)).toBe(true);
    expect(isChainEnd(area[0]!, area)).toBe(false);
  });

  it("ignores cards that are not in the chain", () => {
    // A card outside the chain must not shift anybody's position, and must
    // not get a step of its own.
    const mixed = [...area, item(999, null)];
    expect(chainStep(item(999, null), mixed, NO_CAMPAIGN_HINT, "cs")).toBeNull();
    expect(chainStep(area[1]!, mixed, NO_CAMPAIGN_HINT, "cs")?.total).toBe(3);
  });

  it("survives gaps in the order — the chain is a sequence, not an index", () => {
    const sparse = [item(1, 5), item(2, 40), item(3, 41)];
    const s = chainStep(sparse[0]!, sparse, NO_CAMPAIGN_HINT, "cs");
    expect(s?.next.findId).toBe(2);
    expect(s?.total).toBe(3);
  });

  it("flags a next card somebody has already found", () => {
    const found = [item(101, 1), item(202, 2, { foundAt: new Date() })];
    expect(chainStep(found[0]!, found, NO_CAMPAIGN_HINT, "cs")?.alreadyFound).toBe(
      true,
    );
    expect(chainStep(area[0]!, area, NO_CAMPAIGN_HINT, "cs")?.alreadyFound).toBe(
      false,
    );
  });

  it("has no step for a card with no chain position", () => {
    expect(chainStep({ chainOrder: null }, area, NO_CAMPAIGN_HINT, "cs")).toBeNull();
  });

  it("treats a MISSING chain position as 'not in the chain'", () => {
    // A query that forgets to select chainOrder yields undefined, and a
    // strict !== null would read every card as chained — switching a hunt
    // on for a whole wave. Belt and braces, because the failure is silent.
    const undef = { chainOrder: undefined } as unknown as ChainItem;
    expect(chainStep(undef, area, NO_CAMPAIGN_HINT, "cs")).toBeNull();
    expect(isChainEnd(undef, area)).toBe(false);
    expect(
      chainStep(area[0]!, [...area, undef], NO_CAMPAIGN_HINT, "cs")?.total,
    ).toBe(3);
  });
});

describe("resolveChainHint", () => {
  const campaign = { hintCs: "hledej u laviček", hintEn: "look by the benches" };

  it("prefers the card's own hint over the wave's", () => {
    expect(
      resolveChainHint({ hintCs: "u kašny", hintEn: null }, campaign, "cs"),
    ).toBe("u kašny");
  });

  it("falls back to the wave, then across languages", () => {
    expect(resolveChainHint({ hintCs: null, hintEn: null }, campaign, "en")).toBe(
      "look by the benches",
    );
    // No English anywhere → Czech beats an empty box.
    expect(
      resolveChainHint({ hintCs: null, hintEn: null }, { hintCs: "u kašny", hintEn: null }, "en"),
    ).toBe("u kašny");
  });

  it("treats whitespace as no hint at all", () => {
    expect(
      resolveChainHint({ hintCs: "   ", hintEn: null }, NO_CAMPAIGN_HINT, "cs"),
    ).toBeNull();
  });
});

describe("buildChainOrder", () => {
  const items = [
    { id: 5, findId: 303 },
    { id: 1, findId: 101 },
    { id: 3, findId: 202 },
  ];

  it("walks find numbers in order when asked to", () => {
    expect(buildChainOrder(items, "findId")).toEqual([1, 3, 5]);
  });

  it("keeps every card exactly once when shuffling", () => {
    for (let seed = 0; seed < 20; seed++) {
      const out = buildChainOrder(items, "random", makeRng(seed));
      expect([...out].sort((a, b) => a - b)).toEqual([1, 3, 5]);
    }
  });

  it("actually reshuffles — two draws are not the same walk", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      findId: 100 + i,
    }));
    const a = buildChainOrder(many, "random", makeRng(1));
    const b = buildChainOrder(many, "random", makeRng(2));
    expect(a).not.toEqual(b);
  });

  it("is deterministic for a given seed", () => {
    expect(buildChainOrder(items, "random", makeRng(7))).toEqual(
      buildChainOrder(items, "random", makeRng(7)),
    );
  });

  it("handles one card and none at all", () => {
    expect(buildChainOrder([{ id: 9, findId: 1 }], "random")).toEqual([9]);
    expect(buildChainOrder([], "random")).toEqual([]);
  });
});
