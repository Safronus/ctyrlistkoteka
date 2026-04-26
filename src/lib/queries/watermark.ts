import { join } from "node:path";
import sharp from "sharp";

/**
 * SSR-time probe for the brand watermark PNG. The file lives in the
 * user's data tree (DATA_DIR), not in `public/`, so we can't rely on a
 * static path on the home page. Returning width/height lets the home
 * preview render with no CLS; returning null when the file is absent
 * (e.g. local dev without the data tree) lets the caller skip the
 * preview without a broken image icon.
 */

const watermarkPath = (): string => {
  const dataDir = process.env.DATA_DIR ?? "./data";
  return join(dataDir, "meta", "VODOZNAK_BezJmena.png");
};

export interface WatermarkMeta {
  /** Public URL the home page should render. The dedicated API route
   *  serves the bytes — a separate tree from `public/` keeps the binary
   *  out of the repo. */
  src: string;
  width: number;
  height: number;
}

export async function getWatermarkMeta(): Promise<WatermarkMeta | null> {
  try {
    const meta = await sharp(watermarkPath()).metadata();
    if (!meta.width || !meta.height) return null;
    return { src: "/api/watermark", width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}
