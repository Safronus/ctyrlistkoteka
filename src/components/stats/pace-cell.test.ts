import { describe, expect, it } from "vitest";
import { PaceCell } from "./pace-cell";

/**
 * The pace row is five tiles in `grid-cols-2` on a phone, so they wrap
 * 2 + 2 + 1 and the fifth sits alone — which read as a layout bug. `wide`
 * fills that row, and only below `sm`: from there the row is five across
 * and nothing wraps.
 *
 * Called as a plain function rather than rendered — a component IS one,
 * and the thing under test is the className it computes. No renderer, no
 * jsdom, and it runs under the existing `*.test.ts` include.
 */
function classOf(props: Parameters<typeof PaceCell>[0]): string {
  const el = PaceCell(props) as unknown as {
    props: { className: string };
  };
  return el.props.className;
}

describe("PaceCell", () => {
  it("spans both columns on a phone when wide", () => {
    expect(classOf({ label: "/ rok", value: "1 234", wide: true })).toContain(
      "col-span-2",
    );
  });

  it("gives the span back at sm, where the row is five across", () => {
    expect(classOf({ label: "/ rok", value: "1 234", wide: true })).toContain(
      "sm:col-span-1",
    );
  });

  it("stays one column by default", () => {
    expect(classOf({ label: "/ den", value: "12" })).not.toContain(
      "col-span-2",
    );
  });
});
