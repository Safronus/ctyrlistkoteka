import { describe, expect, it } from "vitest";
import { planDropImport, type PlanCampaign, type PlanItem } from "./dropPlan";
import type { ParsedDropRow } from "./dropXlsx";

const CAMPAIGN: PlanCampaign = {
  placers: ["Míša", "Leonka"],
  qrOptions: { sizeCm: 4.5 },
  headingCs: "Našel jsi čtyřlístek",
  headingEn: null,
  bodyCs: "Je tvůj.",
  bodyEn: null,
  bonusCs: null,
  bonusEn: null,
  qrTitle: null,
  qrCaption: "ctyrlistkoteka.cz",
  hintCs: "Hledej v parku.",
  hintEn: null,
};

function item(over: Partial<PlanItem> = {}): PlanItem {
  return {
    id: 1,
    findId: 30001,
    areaId: null,
    placedBy: null,
    lat: null,
    lng: null,
    status: "PREPARED",
    foundAt: null,
    hintPublished: false,
    qrOptions: null,
    headingCs: null,
    headingEn: null,
    bodyCs: null,
    bodyEn: null,
    bonusCs: null,
    bonusEn: null,
    qrTitle: null,
    qrCaption: null,
    hintCs: null,
    hintEn: null,
    teamNote: null,
    ...over,
  };
}

function row(values: ParsedDropRow["values"]): ParsedDropRow {
  return { findId: 30001, values };
}

const AREAS = [{ id: 7, name: "Zlín" }];

describe("planDropImport — inheritance", () => {
  it("treats a cell equal to the campaign as still inheriting", () => {
    // This is the whole reason the pre-filled sheet is safe: an untouched
    // export must not turn every card into an override.
    const plan = planDropImport(
      [row({ headingCs: "Našel jsi čtyřlístek", bodyCs: "Je tvůj." })],
      [item()],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.report.changed).toBe(0);
    expect(plan.updates).toHaveLength(0);
  });

  it("stores a genuinely different text as an override", () => {
    const plan = planDropImport(
      [row({ headingCs: "Tenhle je z Ratiboře" })],
      [item()],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.updates[0]?.data).toEqual({ headingCs: "Tenhle je z Ratiboře" });
    expect(plan.changes[0]).toMatchObject({
      findId: 30001,
      field: "Nadpis CZ",
      after: "Tenhle je z Ratiboře",
    });
  });

  it("clears an existing override back to inheriting", () => {
    const plan = planDropImport(
      [row({ headingCs: "" })],
      [item({ headingCs: "vlastní" })],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.updates[0]?.data).toEqual({ headingCs: null });
    expect(plan.report.cleared).toBe(1);
  });
});

describe("planDropImport — the stale-sheet guard", () => {
  const EDITED: PlanCampaign = {
    ...CAMPAIGN,
    bodyCs: "Nový text sady.",
    exportedDefaults: { bodyCs: "Je tvůj." },
  };

  it("does not push a superseded default back as an override", () => {
    // The sheet was exported when the campaign said "Je tvůj."; the admin
    // has since changed it. Applying the sheet's copy would silently undo
    // that edit on every card.
    const plan = planDropImport(
      [row({ bodyCs: "Je tvůj." })],
      [item()],
      EDITED,
      AREAS,
    );
    expect(plan.updates).toHaveLength(0);
    expect(plan.report.staleFields).toContain("Text CZ");
  });

  it("still accepts a real edit made in that same column", () => {
    const plan = planDropImport(
      [row({ bodyCs: "Tohle napsala Míša." })],
      [item()],
      EDITED,
      AREAS,
    );
    expect(plan.updates[0]?.data).toEqual({ bodyCs: "Tohle napsala Míša." });
    expect(plan.report.staleFields).toHaveLength(0);
  });

  it("accepts a cell matching the NEW default (as inheriting)", () => {
    const plan = planDropImport(
      [row({ bodyCs: "Nový text sady." })],
      [item({ bodyCs: "něco starého" })],
      EDITED,
      AREAS,
    );
    expect(plan.updates[0]?.data).toEqual({ bodyCs: null });
  });
});

describe("planDropImport — print size", () => {
  it("does not give every card an option bag just for showing the size", () => {
    const plan = planDropImport(
      [row({ sizeCm: 4.5 })],
      [item()],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.updates).toHaveLength(0);
  });

  it("stores a size that differs from the campaign's", () => {
    const plan = planDropImport([row({ sizeCm: 6 })], [item()], CAMPAIGN, AREAS);
    expect(plan.updates[0]?.data.qrOptions).toEqual({ sizeCm: 6 });
  });

  it("turns the title on when a title is typed", () => {
    // Otherwise the text lands in the database and the card looks
    // unchanged, with nothing to explain why.
    const plan = planDropImport(
      [row({ qrTitle: "Pro Pali" })],
      [item()],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.updates[0]?.data.qrOptions).toMatchObject({
      titleMode: "custom",
    });
  });
});

describe("planDropImport — the rest of a row", () => {
  it("reports a find that is not in the wave, and changes nothing", () => {
    const plan = planDropImport(
      [{ findId: 999999, values: { placedBy: "Míša" } }],
      [item()],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.report.unknownFinds).toEqual([999999]);
    expect(plan.updates).toHaveLength(0);
  });

  it("reports an unknown area and leaves the card where it was", () => {
    const plan = planDropImport(
      [row({ area: "Neexistuje" })],
      [item({ areaId: 7 })],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.report.unknownAreas).toEqual(["Neexistuje"]);
    expect(plan.updates).toHaveLength(0);
  });

  it("takes the crew's note as plain text — nothing to inherit", () => {
    const plan = planDropImport(
      [row({ note: "Za knihovnou, u třetí lavičky." })],
      [item()],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.updates[0]?.data).toEqual({
      teamNote: "Za knihovnou, u třetí lavičky.",
    });
    expect(plan.changes[0]?.field).toBe("Poznámka týmu");
  });

  it("clears the note when the cell is emptied", () => {
    const plan = planDropImport(
      [row({ note: "" })],
      [item({ teamNote: "staré" })],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.updates[0]?.data).toEqual({ teamNote: null });
  });

  it("saves a name outside the roster but flags it", () => {
    const plan = planDropImport(
      [row({ placedBy: "Neznámý Pepa" })],
      [item()],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.updates[0]?.data).toEqual({ placedBy: "Neznámý Pepa" });
    expect(plan.report.unknownPlacers).toEqual(["Neznámý Pepa"]);
  });

  it("ignores a coordinate that only differs below the exported precision", () => {
    const plan = planDropImport(
      [row({ lat: 49.226385, lng: 17.700267 })],
      [item({ lat: 49.22638454724804, lng: 17.700266689042376 })],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.updates).toHaveLength(0);
  });

  it("applies a real move", () => {
    const plan = planDropImport(
      [row({ lat: 49.2245, lng: 17.6711 })],
      [item({ lat: 49.226385, lng: 17.700267 })],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.updates[0]?.data).toMatchObject({ lat: 49.2245 });
    expect(plan.changes[0]?.field).toBe("GPS");
  });
});

describe("planDropImport — the chain follows the area", () => {
  // "Řetězec čtyřlístků" is an order WITHIN one area, so a card that moves
  // town has to leave its old chain behind. Otherwise a #4 from Zlín walks
  // into Ratiboř's hunt as its #4 — a bug nobody would spot until somebody
  // followed a clue to the wrong end of the country.
  const chained = () => item({ areaId: null, chainOrder: 4 } as never);

  it("clears the chain position when the card joins an area", () => {
    const plan = planDropImport([row({ area: "Zlín" })], [chained()], CAMPAIGN, AREAS);
    expect(plan.updates[0]?.data).toMatchObject({ areaId: 7, chainOrder: null });
  });

  it("clears it when the card leaves its area", () => {
    const plan = planDropImport(
      [row({ area: "" })],
      [item({ areaId: 7, chainOrder: 2 } as never)],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.updates[0]?.data).toMatchObject({ areaId: null, chainOrder: null });
  });

  it("leaves the chain alone when the area does not change", () => {
    const plan = planDropImport(
      [row({ area: "Zlín" })],
      [item({ areaId: 7, chainOrder: 2 } as never)],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.updates).toHaveLength(0);
  });
});

describe("planDropImport — status in a sheet-run wave", () => {
  // The rule the crew asked for: připravený / vytištěný / schovaný come
  // from the table and from nowhere else, so what they type is what they
  // see. "Nalezený" is the exception and goes the other way — a scan is
  // evidence, a cell is only an intention.
  const scanned = (over = {}) =>
    item({ status: "FOUND", foundAt: new Date("2026-08-01"), ...over });

  it("takes připravený / vytištěný / schovaný straight from the table", () => {
    for (const s of ["PREPARED", "PRINTED", "HIDDEN"] as const) {
      const plan = planDropImport(
        [row({ status: s })],
        [item({ status: "PREPARED" })],
        CAMPAIGN,
        AREAS,
      );
      if (s === "PREPARED") expect(plan.updates).toHaveLength(0);
      else expect(plan.updates[0]?.data).toEqual({ status: s });
    }
  });

  it("refuses to un-find a card somebody has scanned", () => {
    const plan = planDropImport([row({ status: "HIDDEN" })], [scanned()], CAMPAIGN, AREAS);
    expect(plan.updates).toHaveLength(0);
    expect(plan.report.foundKept).toEqual([30001]);
  });

  it("repairs a scanned card the table left as schovaný", () => {
    // Same evidence, but the database had drifted — say it out loud.
    const plan = planDropImport(
      [row({ status: "HIDDEN" })],
      [scanned({ status: "HIDDEN" })],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.updates[0]?.data).toEqual({ status: "FOUND" });
    expect(plan.report.foundKept).toEqual([30001]);
    expect(plan.changes[0]).toMatchObject({ field: "Stav", after: "Nalezený" });
  });

  it("honours a table that says found before anybody scanned", () => {
    const plan = planDropImport(
      [row({ status: "FOUND" })],
      [item({ status: "HIDDEN" })],
      CAMPAIGN,
      AREAS,
    );
    expect(plan.updates[0]?.data).toEqual({ status: "FOUND" });
    expect(plan.report.foundKept).toEqual([]);
  });

  it("leaves an untouched status column alone", () => {
    const plan = planDropImport([row({})], [item({ status: "HIDDEN" })], CAMPAIGN, AREAS);
    expect(plan.updates).toHaveLength(0);
  });
});
