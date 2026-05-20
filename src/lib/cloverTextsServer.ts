/**
 * Server-only runtime loader for the clover-texts data.
 *
 * Reads JSON from `${DATA_DIR}/meta/clover-texts.json` (CZ source of
 * truth) and `${DATA_DIR}/meta/clover-texts.en.json` (EN sidecar
 * keyed by numeric id). Pages await these helpers in server
 * components and pass the resulting plain objects down to client
 * components as props.
 *
 * **Do not import this module from a client component.** It uses
 * Node-only APIs (`node:fs`, `node:path`) which Webpack can't bundle
 * for the browser — Next.js will fail the build with
 * "Unhandled scheme node:fs". The pure types + `localizedClover()`
 * helper live in the sibling `./cloverTexts.ts` module, which IS
 * client-safe; that's where client components should import from.
 *
 * Caching: in-memory by absolute path. We stat the file on every
 * read and re-parse only when `mtime` has changed — typical hit is
 * a single stat call (sub-millisecond) and a returned reference, so
 * the runtime cost on the home page is essentially free.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { CloverEnEntry, CloverText } from "./cloverTexts";

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
 *  matching the JSON key type). Use `localizedClover` from
 *  `./cloverTexts` to apply a single translation; this raw accessor is
 *  exposed for the admin editor that needs the full map. */
export async function getCloverTranslations(): Promise<
  Readonly<Record<string, CloverEnEntry>>
> {
  const file = await readJsonCached<CloverTranslationsFile>(
    cloverTranslationsPath(),
  );
  return file.translations;
}
