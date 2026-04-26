import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

/**
 * Streams the brand watermark PNG from DATA_DIR. The file lives in the
 * user's data tree (`/var/ctyrlistkoteka/data/meta/VODOZNAK_BezJmena.png`)
 * so the app server reads it directly rather than copying into the
 * checked-in `public/` tree. Cache-control is moderate so swapping the
 * file in place propagates within an hour.
 *
 * Returns 404 silently when the file isn't present — local dev without
 * a copy of the data tree just renders a home page without the
 * watermark preview.
 */
export const revalidate = 3600;

function watermarkPath(): string {
  const dataDir = process.env.DATA_DIR ?? "./data";
  return join(dataDir, "meta", "VODOZNAK_BezJmena.png");
}

export async function GET() {
  try {
    const buf = await readFile(watermarkPath());
    return new NextResponse(buf, {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
