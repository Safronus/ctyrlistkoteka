import { describe, expect, it } from "vitest";
import { duplicateFindFiles } from "./duplicateFindFiles";

const OLD = "31420+00149+CZ_ZLÍN_TRÁVNÍK_003+NORMÁLNÍ+NE+BezPoznámky.jpg";
const NEW = "31420+00149+CZ_ZLÍN_TRÁVNÍK_003+DAROVANÝ+NE+SPoznámkou.jpg";

describe("duplicateFindFiles", () => {
  it("reports a find with two photos and names the one sync uses (last sorted)", () => {
    const out = duplicateFindFiles(
      [NEW, "31421+00149+CZ_ZLÍN_TRÁVNÍK_003+NORMÁLNÍ+NE+BezPoznámky.jpg", OLD],
      { shortCropForm: false },
    );
    // "DAROVANÝ" < "NORMÁLNÍ" → the stale NORMÁLNÍ photo is the one in use.
    expect(out).toEqual([{ findId: 31420, files: [NEW, OLD], used: OLD }]);
  });

  it("is quiet when every find has a single file", () => {
    expect(
      duplicateFindFiles(
        [OLD, "31421+00149+CZ_ZLÍN_TRÁVNÍK_003+NORMÁLNÍ+NE+BezPoznámky.jpg"],
        { shortCropForm: false },
      ),
    ).toEqual([]);
  });

  it("counts the short crop form only where sync accepts it", () => {
    const names = ["31420.jpg", OLD];
    expect(duplicateFindFiles(names, { shortCropForm: false })).toEqual([]);
    expect(duplicateFindFiles(names, { shortCropForm: true })).toEqual([
      // "+" sorts before ".", so the long form is read first.
      { findId: 31420, files: [OLD, "31420.jpg"], used: "31420.jpg" },
    ]);
  });

  it("ignores names that don't parse and sorts the report by find id", () => {
    const b = "7+00001+RATIBOŘ_POLE001a+NORMÁLNÍ+NE+BezPoznámky.jpg";
    const b2 = "7+00001+RATIBOŘ_POLE001a+ZTRACENÝ+NE+BezPoznámky.jpg";
    const out = duplicateFindFiles([NEW, OLD, "notes.txt", "notes.txt", b2, b], {
      shortCropForm: true,
    });
    expect(out.map((d) => d.findId)).toEqual([7, 31420]);
  });
});
