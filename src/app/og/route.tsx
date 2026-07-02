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
  // NOTE: the asset filenames are swapped relative to their content —
  // og-face.webp is actually the colourful clover, og-clover.png is the
  // face doodle. We map them by what they DEPICT: clover = hero,
  // face = corner signature.
  const [clover, face] = await Promise.all([
    loadImage("og-face.webp", { height: 520 }),
    loadImage("og-clover.png", { width: 150 }),
  ]);

  const aspect = clover.height / clover.width;
  // Scattered faint clovers for background texture — fixed specs (the card
  // is a static image, so no randomness needed): varied size, rotation,
  // position, all low-opacity and kept off dead-centre where the hero sits.
  const scatter: Array<{
    left: number;
    top: number;
    w: number;
    rot: number;
    op: number;
  }> = [
    { left: 3, top: 6, w: 135, rot: -18, op: 0.16 },
    { left: 83, top: 4, w: 105, rot: 24, op: 0.14 },
    { left: 70, top: 58, w: 150, rot: -30, op: 0.12 },
    { left: 8, top: 60, w: 115, rot: 34, op: 0.15 },
    { left: 42, top: -6, w: 80, rot: 12, op: 0.12 },
    { left: 91, top: 42, w: 95, rot: -12, op: 0.12 },
    { left: 1, top: 33, w: 90, rot: 28, op: 0.13 },
    { left: 52, top: 80, w: 100, rot: -22, op: 0.14 },
    { left: 26, top: 26, w: 70, rot: 42, op: 0.1 },
    { left: 79, top: 84, w: 125, rot: 8, op: 0.15 },
  ];

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
        {scatter.map((c, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={clover.url}
            width={c.w}
            height={Math.round(c.w * aspect)}
            alt=""
            style={{
              position: "absolute",
              left: `${c.left}%`,
              top: `${c.top}%`,
              opacity: c.op,
              transform: `rotate(${c.rot}deg)`,
            }}
          />
        ))}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={clover.url}
          width={clover.width}
          height={clover.height}
          alt=""
        />
        {/* Author's face doodle as a signature — tilted 45° clockwise and
            tucked to the right of the clover head, by the stem. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={face.url}
          width={face.width}
          height={face.height}
          alt=""
          style={{
            position: "absolute",
            left: "55%",
            top: "43%",
            transform: "rotate(45deg)",
          }}
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
