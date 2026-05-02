/** Pretty-prints JSON with multi-line objects but inlines arrays of
 *  primitives onto a single line. Tuned for the
 *  LokaceStavyPoznamky.json source where each location's range list
 *  has 30+ entries — putting every range on its own line bloats the
 *  file 30× without making any of it more readable. Arrays of
 *  objects still get multi-line so a hypothetical structured array
 *  stays scannable.
 *
 *  Output is valid JSON (you can JSON.parse the result back). */
export function formatJsonCompactArrays(
  value: unknown,
  indent = 0,
): string {
  const sp = "  ".repeat(indent);
  const next = "  ".repeat(indent + 1);

  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    const allPrimitive = value.every(
      (v) => v === null || typeof v !== "object",
    );
    if (allPrimitive) return JSON.stringify(value);
    if (value.length === 0) return "[]";
    return (
      "[\n" +
      value
        .map((v) => next + formatJsonCompactArrays(v, indent + 1))
        .join(",\n") +
      "\n" +
      sp +
      "]"
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return (
    "{\n" +
    entries
      .map(
        ([k, v]) =>
          next +
          JSON.stringify(k) +
          ": " +
          formatJsonCompactArrays(v, indent + 1),
      )
      .join(",\n") +
    "\n" +
    sp +
    "}"
  );
}
