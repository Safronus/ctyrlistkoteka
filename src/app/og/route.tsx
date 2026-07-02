import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * Brand social-share card (1200×630) for the section pages (home,
 * /sbirka, /lokality, /mapa, /statistiky), referenced from their
 * `openGraph.images`. Features the author's own hand-drawn clover
 * (already signed "SAFRONUS" on the stem, so no baked-in text / font is
 * needed) on the same soft-green gradient the rest of the site uses, with
 * the author's face doodle as a small signature in the corner. Detail
 * pages (find / location) keep their own real-photo OG image and never
 * hit this route.
 *
 * `nodejs` runtime so we can read the bundled `public/` assets from disk
 * and let sharp normalise them to PNG (Satori is picky about webp) before
 * embedding as data URLs.
 */

export const runtime = "nodejs";
export const revalidate = false;

const WIDTH = 1200;
const HEIGHT = 630;

/** Read a `public/` image, resize to fit, return a PNG data URL + its
 *  drawn dimensions (Satori needs explicit width/height on <img>). */
async function loadImage(
  relPath: string,
  fit: { width?: number; height?: number },
): Promise<{ url: string; width: number; height: number }> {
  const sharp = (await import("sharp")).default;
  const buf = await readFile(join(process.cwd(), "public", relPath));
  const out = await sharp(buf)
    .resize({ ...fit, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    url: `data:image/png;base64,${out.data.toString("base64")}`,
    width: out.info.width,
    height: out.info.height,
  };
}

export async function GET() {
  const [clover, face] = await Promise.all([
    loadImage("og-clover.png", { height: 520 }),
    loadImage("og-face.webp", { width: 150 }),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #eaf6ea 0%, #cfeccf 100%)",
          position: "relative",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={clover.url}
          width={clover.width}
          height={clover.height}
          alt=""
        />
        {/* Author's face doodle as a small signature, bottom-right. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={face.url}
          width={face.width}
          height={face.height}
          alt=""
          style={{ position: "absolute", right: 48, bottom: 40 }}
        />
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      headers: { "Cache-Control": "public, max-age=86400, immutable" },
    },
  );
}
