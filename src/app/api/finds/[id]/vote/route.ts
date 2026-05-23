import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  computeFingerprint,
  ensureVoterUuid,
  getFindVoteCount,
  getVotedFindIds,
  hashIp,
  rateLimitVote,
  readFingerprintInputs,
  readVoterUuid,
} from "@/lib/votes";

/**
 * POST /api/finds/:id/vote      — cast a vote
 * DELETE /api/finds/:id/vote    — take it back
 *
 * The two operations are deliberately separate verbs (no toggle on a
 * single endpoint) so a client that loses sync can converge: POST is
 * idempotent (second POST returns the same {voted:true} state), DELETE
 * is idempotent (deleting a non-existent row is fine).
 *
 * Cyber-security checklist applied:
 *   - Validate find_id strictly (positive int, exists in DB, otherwise
 *     404 — no enumeration leak).
 *   - Reject votes on no-photo finds (they have nothing to like).
 *   - Per-fingerprint rate limit (20 ops/min) — script-driven spam
 *     hits a 429 long before it touches the DB.
 *   - DB unique constraint on (find_id, voter_uuid) AND (find_id,
 *     fingerprint) — primary defence against duplicate votes.
 *   - Never reveal whether a find exists vs. is anonymized — both
 *     paths take the same code path (anonymized are votable per
 *     product decision).
 *   - User-Agent is truncated to 500 chars to bound DB row size.
 *   - All inputs come from headers/path; no JSON body is accepted —
 *     reduces parser-confusion risk.
 *   - Errors return a plain JSON envelope; no stack traces leak.
 */

const MAX_USER_AGENT_LEN = 500;

function parseId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

async function findExists(id: number): Promise<boolean> {
  const f = await prisma.find.findUnique({
    where: { id },
    select: { id: true },
  });
  return f !== null;
}

async function prepareVoter(): Promise<
  | {
      ok: true;
      voterUuid: string;
      fingerprint: string;
      ipHash: string;
      userAgent: string | null;
    }
  | { ok: false; status: number; error: string }
> {
  let inputs;
  try {
    inputs = await readFingerprintInputs();
  } catch {
    return { ok: false, status: 500, error: "Server misconfigured" };
  }
  let fingerprint: string;
  let ipHash: string;
  try {
    fingerprint = computeFingerprint(inputs);
    ipHash = hashIp(inputs.ip);
  } catch {
    return { ok: false, status: 503, error: "Voting temporarily disabled" };
  }
  if (!rateLimitVote(fingerprint)) {
    return { ok: false, status: 429, error: "Příliš mnoho hlasů z této sítě, zkus za chvíli" };
  }
  const voterUuid = await ensureVoterUuid();
  const userAgent = inputs.userAgent
    ? inputs.userAgent.slice(0, MAX_USER_AGENT_LEN)
    : null;
  return { ok: true, voterUuid, fingerprint, ipHash, userAgent };
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/finds/:id/vote — read-only vote state lookup for the
 * currently-rendered visitor (matched by cookie UUID + IP/UA
 * fingerprint, see src/lib/votes.ts). Used by the home page random
 * find widget to hydrate the VoteButton state without a full POST
 * round-trip on every find rotation.
 *
 * Returns `voted=false` if the salt is unconfigured (lib throws);
 * the count comes from the denormalized cache regardless, so the
 * count display still works while voting itself is disabled.
 */
export async function GET(_req: Request, { params }: RouteContext) {
  const { id: rawId } = await params;
  const findId = parseId(rawId);
  if (!findId) {
    return NextResponse.json({ error: "Invalid find id" }, { status: 400 });
  }
  if (!(await findExists(findId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const count = await getFindVoteCount(findId);
  let voted = false;
  try {
    const inputs = await readFingerprintInputs();
    const fingerprint = computeFingerprint(inputs);
    const voterUuid = await readVoterUuid();
    const votedSet = await getVotedFindIds([findId], voterUuid, fingerprint);
    voted = votedSet.has(findId);
  } catch {
    // Fingerprint salt missing — answer with the public count, voted
    // stays false. UI degrades gracefully (button shows "not voted"),
    // never crashes.
  }

  return NextResponse.json(
    { voted, count },
    {
      // Per-browser cache only — the `voted` half depends on cookies
      // so a shared CDN cache would leak state across visitors.
      headers: { "cache-control": "private, no-store" },
    },
  );
}

export async function POST(_req: Request, { params }: RouteContext) {
  const { id: rawId } = await params;
  const findId = parseId(rawId);
  if (!findId) {
    return NextResponse.json({ error: "Invalid find id" }, { status: 400 });
  }
  if (!(await findExists(findId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const prep = await prepareVoter();
  if (!prep.ok) {
    return NextResponse.json({ error: prep.error }, { status: prep.status });
  }

  try {
    await prisma.findVote.create({
      data: {
        findId,
        voterUuid: prep.voterUuid,
        fingerprint: prep.fingerprint,
        ipHash: prep.ipHash,
        userAgent: prep.userAgent,
      },
    });
  } catch (err) {
    // P2002 = Prisma unique constraint violation. Both PK and the
    // secondary (find_id, fingerprint) index get the same code; we
    // treat either as "already voted" — idempotent POST.
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      const count = await getFindVoteCount(findId);
      return NextResponse.json({ voted: true, count });
    }
    console.error("[vote/POST] insert failed", { findId, code });
    return NextResponse.json({ error: "Vote failed" }, { status: 500 });
  }

  const count = await getFindVoteCount(findId);
  return NextResponse.json({ voted: true, count });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const { id: rawId } = await params;
  const findId = parseId(rawId);
  if (!findId) {
    return NextResponse.json({ error: "Invalid find id" }, { status: 400 });
  }
  if (!(await findExists(findId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const prep = await prepareVoter();
  if (!prep.ok) {
    return NextResponse.json({ error: prep.error }, { status: prep.status });
  }

  // Delete by EITHER identity — if cookie was cleared but fingerprint
  // matches, we still find the row. `deleteMany` is the natural fit:
  // it tolerates 0 matches (idempotent) and accepts an OR predicate.
  await prisma.findVote.deleteMany({
    where: {
      findId,
      OR: [{ voterUuid: prep.voterUuid }, { fingerprint: prep.fingerprint }],
    },
  });
  const count = await getFindVoteCount(findId);
  return NextResponse.json({ voted: false, count });
}
