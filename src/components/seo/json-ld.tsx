/**
 * Renders a JSON-LD structured-data block. Invisible to users — a
 * `<script type="application/ld+json">` for search engines only, so it
 * has zero effect on layout / styling / behaviour.
 *
 * Security: `JSON.stringify` does NOT escape `</script>` or `<`, so a
 * stray `<` in any embedded string (e.g. a location description) could
 * break out of the script element. We escape `<` to its `<` JSON
 * form — valid JSON, and impossible to close the tag or inject markup.
 */
export function JsonLd({
  data,
}: {
  data: Record<string, unknown> | Record<string, unknown>[];
}) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
