import { createHash, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";

/**
 * Server-side helpers for the public "thumbs up" voting feature on
 * /sbirka. The model has two independent identities per voter:
 *
 *   1. `voterUuid` — random UUIDv4 in an httpOnly cookie (~1 year),
 *      survives normal browser sessions, dies on cookie clear.
 *   2. `fingerprint` — sha1(ip + ua + accept-lang + serverový salt).
 *      Survives cookie clear, dies on IP change (mobile, VPN, etc).
 *
 * Both have unique constraints in `find_votes`, so a single visitor
 * cannot vote twice for the SAME find without changing BOTH identities
 * (clearing cookies *and* switching network/browser). For *different*
 * finds, the same visitor can vote unlimited times — that's the
 * intended product behaviour per the design discussion.
 */

const COOKIE_NAME = "vote_voter_uuid";
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365; // 1 year
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Reads the voter UUID from the cookie if present and well-formed.
 * Doesn't mint a new one — that's `ensureVoterUuid`'s job — so the
 * detail page can call this from RSC without setting any cookies
 * during render (a Next.js no-no for static-ish responses).
 */
export async function readVoterUuid(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw || !UUID_RE.test(raw)) return null;
  return raw;
}

/**
 * Read or mint a voter UUID. Used from server actions / route handlers
 * — those CAN set cookies in their response, unlike RSC pages.
 *
 * Important: this function MUST NOT be called from inside an RSC page
 * render path, or Next will throw "Cookies can only be modified in a
 * Server Action or Route Handler".
 */
export async function ensureVoterUuid(): Promise<string> {
  const existing = await readVoterUuid();
  if (existing) return existing;
  const fresh = randomUUID();
  const jar = await cookies();
  jar.set(COOKIE_NAME, fresh, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_S,
  });
  return fresh;
}

interface FingerprintInputs {
  ip: string;
  userAgent: string;
  acceptLanguage: string;
}

/**
 * Reads the inputs the fingerprint depends on from the request. Both
 * IP and Accept-Language fall back to "" rather than throwing so a
 * weird/forged request still gets a deterministic (if poor-quality)
 * fingerprint instead of crashing the action.
 */
export async function readFingerprintInputs(): Promise<FingerprintInputs> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]!.trim() : (h.get("x-real-ip") ?? "");
  const userAgent = h.get("user-agent") ?? "";
  const acceptLanguage = h.get("accept-language") ?? "";
  return { ip, userAgent, acceptLanguage };
}

/** Returns the salt or throws — voting is disabled if the operator
 *  hasn't set one, because a missing salt would let anyone reproduce
 *  the fingerprint locally. We deliberately fail loud, not silent. */
function requireSalt(): string {
  const salt = process.env.VOTE_FINGERPRINT_SALT;
  if (!salt || salt.length < 16) {
    throw new Error(
      "VOTE_FINGERPRINT_SALT is not configured (≥16 chars required)",
    );
  }
  return salt;
}

/**
 * Computes the 40-char sha1 fingerprint used as the secondary
 * uniqueness key in `find_votes`. Same inputs always produce the same
 * digest — `voted-or-not` lookups go through this on every render.
 */
export function computeFingerprint(inputs: FingerprintInputs): string {
  const salt = requireSalt();
  return createHash("sha1")
    .update(salt)
    .update("\x00")
    .update(inputs.ip)
    .update("\x00")
    .update(inputs.userAgent)
    .update("\x00")
    .update(inputs.acceptLanguage)
    .digest("hex");
}

/** Standalone sha1 for ip_hash (audit row). Deliberately a separate
 *  hash so the DB column doesn't reveal anything about the voter's
 *  full fingerprint — admin sees the IP-only hash, not the joined
 *  fingerprint. Same salt is fine, the inputs differ. */
export function hashIp(ip: string): string {
  const salt = requireSalt();
  return createHash("sha1").update(salt).update("\x00ip\x00").update(ip).digest(
    "hex",
  );
}

// ---------------------------------------------------------------
// In-memory rate limiter
// ---------------------------------------------------------------
//
// Pragmatic per-fingerprint sliding-window counter to soft-cap how
// fast one visitor can vote. Doesn't replace the DB unique constraint
// (which is the real anti-duplicate gate) but blunts script-driven
// spam by adding a small server-side cost per vote.
//
// In-memory keeps it simple — for the single-node OVH VPS this is
// fine. A second instance would have a stale view, but we don't run
// multiple Next nodes today. If we ever do, swap to Redis (the
// REDIS_URL env var already exists for stats cache).

interface RateBucket {
  count: number;
  firstAt: number;
}
const rateBuckets = new Map<string, RateBucket>();
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX_HITS = 20; // votes/min per fingerprint

/** Returns `true` if this fingerprint is within the per-minute budget,
 *  `false` if it should be throttled. Increments on success. */
export function rateLimitVote(fingerprint: string): boolean {
  const now = Date.now();
  const existing = rateBuckets.get(fingerprint);
  if (!existing || now - existing.firstAt > RATE_WINDOW_MS) {
    rateBuckets.set(fingerprint, { count: 1, firstAt: now });
    return true;
  }
  if (existing.count >= RATE_MAX_HITS) return false;
  existing.count += 1;
  return true;
}

// ---------------------------------------------------------------
// DB queries
// ---------------------------------------------------------------

/**
 * For a given list of find IDs, returns the subset the current voter
 * has voted for (matched by EITHER cookie UUID or fingerprint — both
 * sides count, so the UI shows "voted" even if e.g. the cookie was
 * cleared but the IP is the same).
 */
export async function getVotedFindIds(
  findIds: readonly number[],
  voterUuid: string | null,
  fingerprint: string,
): Promise<Set<number>> {
  if (findIds.length === 0) return new Set();
  const rows = await prisma.findVote.findMany({
    where: {
      findId: { in: [...findIds] },
      OR: voterUuid
        ? [{ voterUuid }, { fingerprint }]
        : [{ fingerprint }],
    },
    select: { findId: true },
  });
  return new Set(rows.map((r) => r.findId));
}

/** Per-find vote count (uses the denormalized `finds.vote_count` so
 *  the lookup is a single PK fetch). */
export async function getFindVoteCount(findId: number): Promise<number> {
  const r = await prisma.find.findUnique({
    where: { id: findId },
    select: { voteCount: true },
  });
  return r?.voteCount ?? 0;
}

/** Bulk variant of `getFindVoteCount` for /sbirka list rendering. */
export async function getFindVoteCounts(
  findIds: readonly number[],
): Promise<Map<number, number>> {
  if (findIds.length === 0) return new Map();
  const rows = await prisma.find.findMany({
    where: { id: { in: [...findIds] } },
    select: { id: true, voteCount: true },
  });
  return new Map(rows.map((r) => [r.id, r.voteCount]));
}

export interface TopFindEntry {
  findId: number;
  voteCount: number;
}

/**
 * Top N most-voted finds. `windowDays` set → only votes within the
 * last N days count (used for the "12 měsíců" leaderboard). When
 * unset, we use the cached `finds.vote_count` directly (all-time).
 * Both variants exclude finds with vote_count = 0.
 */
export async function getTopFinds(args: {
  limit: number;
  windowDays?: number;
}): Promise<TopFindEntry[]> {
  // Ties on vote_count break by the *sorted sequence of vote
  // timestamps* — the find that got its first vote earliest wins;
  // on identical first votes the second-vote time decides; and so
  // on. PostgreSQL compares arrays lexicographically, so a single
  // `ORDER BY array_agg(voted_at ORDER BY voted_at) ASC` clause
  // gives us the full waterfall in one go. In practice the
  // first-vote tiebreak resolves nearly all ties (millisecond-
  // resolution timestamps make collisions on the first vote
  // astronomically unlikely), but encoding the whole sequence
  // matches the user's spec exactly and costs nothing extra.
  //
  // The raw SQL replaces what used to be a plain
  // `find.findMany({ orderBy: { voteCount: 'desc' }})` because
  // Prisma's structured orderBy can't express "then by a sorted
  // aggregate of a related table's timestamps". Same shape goes
  // for the windowed variant.
  if (!args.windowDays) {
    const rows = await prisma.$queryRaw<
      Array<{ id: number; vote_count: number }>
    >`
      SELECT f.id, f.vote_count
      FROM finds f
      LEFT JOIN find_votes fv ON fv.find_id = f.id
      WHERE f.vote_count > 0
      GROUP BY f.id, f.vote_count
      ORDER BY f.vote_count DESC,
               ARRAY_AGG(fv.voted_at ORDER BY fv.voted_at) ASC NULLS LAST,
               f.id ASC
      LIMIT ${args.limit}
    `;
    return rows.map((r) => ({ findId: r.id, voteCount: r.vote_count }));
  }
  const cutoff = new Date(Date.now() - args.windowDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<
    Array<{ find_id: number; cnt: bigint }>
  >`
    SELECT fv.find_id, COUNT(*)::bigint AS cnt
    FROM find_votes fv
    WHERE fv.voted_at >= ${cutoff}
    GROUP BY fv.find_id
    ORDER BY COUNT(*) DESC,
             ARRAY_AGG(fv.voted_at ORDER BY fv.voted_at) ASC,
             fv.find_id ASC
    LIMIT ${args.limit}
  `;
  return rows.map((r) => ({ findId: r.find_id, voteCount: Number(r.cnt) }));
}

export interface TopFindRich {
  findId: number;
  voteCount: number;
  isAnonymized: boolean;
  /** Thumbnail URL of the primary image (if any). Anonymized finds
   *  may still surface a thumbnail because the user explicitly opted
   *  in to having them in the leaderboard ("voting is about the
   *  image, not the location"). */
  thumbUrl: string | null;
  /** EXIF DateTimeOriginal as ISO — null for finds without EXIF.
   *  Surfaced for the homepage tile so the visitor sees WHEN the
   *  winner was found, not just "find #18269". Anonymized finds keep
   *  the date (it doesn't identify the location). */
  foundAt: string | null;
  /** Display name + code of the find's location. NULL for anonymized
   *  finds — surfacing it would leak the place behind the privacy
   *  veil. The homepage tile renders an "anonymizovaný nález"
   *  placeholder in that case. */
  location: { id: number; code: string; displayName: string } | null;
  /** True when the find carries the DONATED state assignment in
   *  data/meta/LokaceStavyPoznamky.json. Anonymized finds force
   *  false so the state itself stays hidden — same privacy stance
   *  the jubilee tile uses. Surfaced as a small badge in the
   *  top/bottom-right corner of the tile depending on the call
   *  site. */
  isDonated: boolean;
}

/**
 * Same as `getTopFinds` but also fetches each entry's primary
 * thumbnail + minimal context (date, location name) in one batch.
 * Used by the homepage tile + /statistiky leaderboard so they don't
 * need to issue per-row queries.
 */
export async function getTopFindsWithThumbs(args: {
  limit: number;
  windowDays?: number;
}): Promise<TopFindRich[]> {
  const top = await getTopFinds(args);
  if (top.length === 0) return [];
  const findIds = top.map((t) => t.findId);
  // Pull every primary image for the top set in a single query, then
  // join in memory. `is_primary = true` filter keeps the result small.
  const [findRows, imageRows, donatedRows] = await Promise.all([
    prisma.find.findMany({
      where: { id: { in: findIds } },
      select: {
        id: true,
        isAnonymized: true,
        foundAt: true,
        location: {
          select: { id: true, code: true, displayName: true },
        },
      },
    }),
    prisma.findImage.findMany({
      where: { findId: { in: findIds }, isPrimary: true },
      select: { findId: true, thumbPath: true },
    }),
    // DONATED-state membership in one IN-list query. Builds a Set the
    // map step below treats as O(1) lookup. Same pattern the
    // JubileeFind row uses, just batched across multiple ids.
    prisma.findStateAssignment.findMany({
      where: { findId: { in: findIds }, state: "DONATED" },
      select: { findId: true },
    }),
  ]);
  const findById = new Map(findRows.map((r) => [r.id, r]));
  const thumbById = new Map(imageRows.map((r) => [r.findId, r.thumbPath]));
  const donatedSet = new Set(donatedRows.map((r) => r.findId));
  return top.map((t) => {
    const f = findById.get(t.findId);
    const isAnonymized = f?.isAnonymized ?? false;
    return {
      findId: t.findId,
      voteCount: t.voteCount,
      isAnonymized,
      thumbUrl: thumbById.get(t.findId) ?? null,
      foundAt: f?.foundAt ? f.foundAt.toISOString() : null,
      location: f && !f.isAnonymized ? f.location : null,
      // Anonymized winners hide the donated flag for the same
      // reason notes/GPS/location are hidden — the state itself
      // is part of the privacy contract.
      isDonated: !isAnonymized && donatedSet.has(t.findId),
    };
  });
}
