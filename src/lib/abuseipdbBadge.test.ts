import { describe, expect, it } from "vitest";
import { parseReportedCount } from "./abuseipdbBadge";

describe("parseReportedCount", () => {
  it("extracts the reported-IP count from the real badge SVG shape", () => {
    // The count + label sit in separate <tspan>s with lots of whitespace,
    // e.g. "…8,925   IPs   Reported…".
    const svg =
      '<svg><text><tspan>AbuseIPDB Contributor</tspan></text>' +
      '<text><tspan>8,925</tspan><tspan>   IPs</tspan></text>' +
      '<text><tspan>Reported</tspan></text></svg>';
    expect(parseReportedCount(svg)).toBe(8925);
  });

  it("handles a count with no thousands separator", () => {
    expect(parseReportedCount("<svg><text>925 IPs Reported</text></svg>")).toBe(
      925,
    );
  });

  it("handles multiple comma groups", () => {
    expect(
      parseReportedCount("<svg><text>1,234,567 IPs</text></svg>"),
    ).toBe(1234567);
  });

  it("returns null when the shape changes / no count present", () => {
    expect(parseReportedCount("<svg><text>AbuseIPDB Contributor</text></svg>")).toBeNull();
    expect(parseReportedCount("")).toBeNull();
  });
});
