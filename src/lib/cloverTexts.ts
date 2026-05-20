/**
 * Clover-texts loader.
 *
 * Texts are stored in `${DATA_DIR}/meta/clover-texts.json` (CZ source
 * of truth) and `${DATA_DIR}/meta/clover-texts.en.json` (sidecar EN
 * translations keyed by the same numeric `id`). The admin editor at
 * `/admin/clover-texts/` writes to both files atomically; this module
 * just reads them at runtime so server-rendered pages see the latest
 * content without a rebuild.
 *
 * Caching: in-memory by absolute path. We stat the file on every
 * read and re-parse only when `mtime` has changed — typical hit is
 * a single stat call (sub-millisecond) and a returned reference.
 *
 * The home-page rotator iterates by *array index*, not by id. EN
 * translations don't reorder anything; `localizedClover()` returns
 * a view over the same source entry with `title`/`text`/`kind`
 * swapped per locale.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export type CloverTextSource = "fact" | "lore" | "creative";

export type CloverTextVibe = "happy" | "demonic";

export interface CloverText {
  id: number;
  category: string;
  title: string;
  text: string;
  source_type: CloverTextSource;
  /** When true the entry is authored by the project owner; the home
   *  card swaps to a clover-themed paper variant with a BONUS badge.
   *  Optional — most entries are general lore/facts and omit it. */
  author?: boolean;
  /** Visible label for author entries (e.g. "Rada autora", "Báseň
   *  autora"). Ignored when `author` is falsy. */
  kind?: string;
  /** Optional theme override beyond the default "author" emerald
   *  treatment. "happy" → festive sun-tinted gradient (poem #111).
   *  "demonic" → dark/red gradient with hellish marker (#666). */
  vibe?: CloverTextVibe;
  /** When set, the whole paper card becomes a link to this URL.
   *  #666 uses this to deep-link to the matching find detail. */
  link?: string;
}

export interface CloverEnEntry {
  title: string;
  text: string;
  /** Author entries carry an EN `kind` translation here so the kind
   *  label can be swapped per-id rather than via the i18n KIND_KEYS
   *  map (which only maps a fixed set of CS strings — fine for the
   *  current data, but the per-id field future-proofs against new
   *  one-off kinds the author might add). */
  kind?: string;
}

/** Wire format on disk. We keep the wrapper object (rather than a
 *  bare array) so the file can carry metadata (last-edited, schema
 *  version, etc.) without breaking older readers. */
interface CloverTextsFile {
  texts: CloverText[];
}

interface CloverTranslationsFile {
  translations: Record<string, CloverEnEntry>;
}

function resolveDataDir(): string {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), "data");
}

function cloverTextsPath(): string {
  return path.join(resolveDataDir(), "meta", "clover-texts.json");
}

function cloverTranslationsPath(): string {
  return path.join(resolveDataDir(), "meta", "clover-texts.en.json");
}

interface Cached<T> {
  mtimeMs: number;
  data: T;
}

const cache = new Map<string, Cached<unknown>>();

/** Read + parse a JSON file with mtime-based memo. Returns the cached
 *  value when the file hasn't changed since the last successful read;
 *  otherwise re-parses. Errors propagate to the caller — there's no
 *  silent fallback because a missing clover-texts file means something
 *  is wrong with the deploy, not a normal state. */
async function readJsonCached<T>(filePath: string): Promise<T> {
  const stat = await fs.stat(filePath);
  const mtimeMs = stat.mtimeMs;
  const cached = cache.get(filePath) as Cached<T> | undefined;
  if (cached && cached.mtimeMs === mtimeMs) return cached.data;
  const raw = await fs.readFile(filePath, "utf8");
  const data = JSON.parse(raw) as T;
  cache.set(filePath, { mtimeMs, data });
  return data;
}

/** Returns all clover-text entries in canonical (file) order. The
 *  home-page rotator picks a random index from the result; the order
 *  on disk seeds the SSR-rendered initial frame. */
export async function getCloverTexts(): Promise<ReadonlyArray<CloverText>> {
  const file = await readJsonCached<CloverTextsFile>(cloverTextsPath());
  return file.texts;
}

/** Returns the EN translations table keyed by numeric id (as a string,
 *  matching the JSON key type). Use `localizedClover` to apply a single
 *  translation; this raw accessor is exposed for the admin editor. */
export async function getCloverTranslations(): Promise<
  Readonly<Record<string, CloverEnEntry>>
> {
  const file = await readJsonCached<CloverTranslationsFile>(
    cloverTranslationsPath(),
  );
  return file.translations;
}

/**
 * Returns a localised view of a clover entry. For `cs` (or any locale
 * we don't carry translations for) the original is returned untouched;
 * for `en` we look up the id in the sidecar file and substitute
 * `title`, `text`, and (if present) `kind`. Falls back to the CS source
 * when the id has no translation yet — the UI keeps rendering rather
 * than crashing on a missing entry.
 *
 * The second argument is the already-loaded translations map, passed
 * in by callers so we don't trigger a fresh fs read for every render.
 * Server components fetch the map once and reuse it across the page
 * tree.
 */
export function localizedClover(
  text: CloverText,
  locale: string,
  translations: Readonly<Record<string, CloverEnEntry>>,
): CloverText {
  if (locale === "cs") return text;
  const tr = translations[String(text.id)];
  if (!tr) return text;
  return {
    ...text,
    title: tr.title,
    text: tr.text,
    ...(tr.kind ? { kind: tr.kind } : {}),
  };
}
