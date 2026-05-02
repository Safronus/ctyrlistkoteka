import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** Atomic file write. Stages the payload to a sibling tempfile,
 *  fsyncs the data, then renames into place — so a reader either sees
 *  the old file or the complete new one, never a half-written
 *  intermediate. The temp filename includes pid + a 6-byte random
 *  suffix so concurrent writers don't collide. Parent directory must
 *  exist; this is a runtime invariant of the admin paths. */
export async function atomicWrite(
  targetPath: string,
  data: Buffer | string,
): Promise<void> {
  const dir = path.dirname(targetPath);
  const tmpName = `.${path.basename(targetPath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const tmpPath = path.join(dir, tmpName);
  const fh = await fs.open(tmpPath, "w");
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  // rename() is POSIX-atomic on the same filesystem. Both src/dst
  // live inside the same target dir, so we're safe.
  await fs.rename(tmpPath, targetPath);
}

/** Ensures a directory exists, creating it (and parents) when not.
 *  No-op when the directory is already there. Used before atomicWrite
 *  to set up nested admin trees (e.g. `data/.trash/<timestamp>/`). */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}
