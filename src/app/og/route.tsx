import { ImageResponse } from "next/og";

/**
 * Brand social-share card (1200×630) for the section pages (home,
 * /sbirka, /lokality, /mapa, /statistiky), referenced explicitly from
 * their `openGraph.images`. Deliberately TEXT-FREE: Satori needs a bundled
 * font for any text, and the project self-hosts fonts / avoids external
 * font CDNs — so the card carries only vector art (no font dependency),
 * and the wording rides along in `og:title` / `og:description` which every
 * platform renders beside the image. Detail pages (find / location) keep
 * their own real-photo OG image and never hit this route.
 */

export const runtime = "nodejs";
// Static card — cache hard at the edge/proxy; it never changes per request.
export const revalidate = false;

const WIDTH = 1200;
const HEIGHT = 630;

/** One four-leaf clover as absolutely-positioned leaf + core divs (Satori
 *  renders divs + border-radius, not arbitrary SVG ellipses reliably). */
function Clover({
  size,
  color,
  core,
}: {
  size: number;
  color: string;
  core: string;
}) {
  const leaf = size * 0.46;
  const off = size * 0.27;
  const leafStyle = {
    position: "absolute" as const,
    width: leaf,
    height: leaf,
    background: color,
    borderRadius: "50% 50% 50% 0",
  };
  return (
    <div style={{ position: "relative", width: size, height: size, display: "flex" }}>
      <div style={{ ...leafStyle, top: 0, left: off, transform: "rotate(-45deg)" }} />
      <div style={{ ...leafStyle, top: off, left: size - leaf, transform: "rotate(45deg)" }} />
      <div style={{ ...leafStyle, top: size - leaf, left: size - leaf - off, transform: "rotate(135deg)" }} />
      <div style={{ ...leafStyle, top: size - leaf - off, left: 0, transform: "rotate(-135deg)" }} />
      <div
        style={{
          position: "absolute",
          top: size / 2 - size * 0.07,
          left: size / 2 - size * 0.07,
          width: size * 0.14,
          height: size * 0.14,
          background: core,
          borderRadius: "50%",
        }}
      />
    </div>
  );
}

export function GET() {
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
        {/* Faint scattered clovers in the corners for texture */}
        <div style={{ position: "absolute", top: 70, left: 90, opacity: 0.35, display: "flex" }}>
          <Clover size={110} color="#8fce8a" core="#6bb268" />
        </div>
        <div style={{ position: "absolute", bottom: 60, right: 110, opacity: 0.3, display: "flex" }}>
          <Clover size={150} color="#8fce8a" core="#6bb268" />
        </div>
        <div style={{ position: "absolute", top: 120, right: 220, opacity: 0.22, display: "flex" }}>
          <Clover size={70} color="#8fce8a" core="#6bb268" />
        </div>
        {/* Hero clover */}
        <Clover size={300} color="#4d9748" core="#0f6e34" />
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );
}
